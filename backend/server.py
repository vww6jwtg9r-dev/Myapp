"""RideReserve backend - Vehicle Seat Reservation & Ride Sharing Platform."""
import os
import uuid
import hmac
import hashlib
import logging
import secrets
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import List, Optional, Literal

import httpx
import requests
from dotenv import load_dotenv
from fastapi import FastAPI, APIRouter, Depends, HTTPException, Header, UploadFile, File, Response, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field

try:
    import razorpay  # type: ignore
except Exception:  # pragma: no cover
    razorpay = None

import bcrypt

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

# Config
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY")
APP_NAME = os.environ.get("APP_NAME", "ride-reserve")
ADMIN_EMAILS = {e.strip().lower() for e in os.environ.get("ADMIN_EMAILS", "").split(",") if e.strip()}
COMMISSION_RATE = float(os.environ.get("PLATFORM_COMMISSION_RATE", "0.5"))
REFERRAL_BONUS = float(os.environ.get("REFERRAL_BONUS", "50"))
RAZORPAY_KEY_ID = os.environ.get("RAZORPAY_KEY_ID", "").strip()
RAZORPAY_KEY_SECRET = os.environ.get("RAZORPAY_KEY_SECRET", "").strip()
RAZORPAY_ENABLED = bool(RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET and razorpay)
rzp_client = razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET)) if RAZORPAY_ENABLED else None
OTP_DEV_MODE = os.environ.get("OTP_DEV_MODE", "false").strip().lower() in {"1", "true", "yes"}
PAYMENT_MOCK_ALLOWED = os.environ.get("PAYMENT_MOCK_ALLOWED", "false").strip().lower() in {"1", "true", "yes"}
CORS_ORIGINS = [o.strip() for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip()] or ["*"]
MAX_UPLOAD_BYTES = 5 * 1024 * 1024  # 5MB
ALLOWED_IMAGE_EXTS = {"jpg", "jpeg", "png", "webp", "heic", "heif"}
ALLOWED_IMAGE_MIME = {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"}
OTP_TTL_SECONDS = 5 * 60
OTP_MAX_ATTEMPTS = 5
OTP_SEND_WINDOW_SECONDS = 60 * 60
OTP_SEND_MAX_PER_WINDOW = 5

STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI()
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ride-reserve")

# ---------- Storage helpers ----------
storage_key: Optional[str] = None


def init_storage() -> str:
    global storage_key
    if storage_key:
        return storage_key
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_LLM_KEY}, timeout=30)
    resp.raise_for_status()
    storage_key = resp.json()["storage_key"]
    return storage_key


def put_object(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    resp = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data,
        timeout=120,
    )
    resp.raise_for_status()
    return resp.json()


def get_object(path: str) -> tuple[bytes, str]:
    key = init_storage()
    resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


# ---------- Models ----------
class User(BaseModel):
    user_id: str
    email: Optional[str] = None
    phone: Optional[str] = None
    name: str
    picture: Optional[str] = None
    emergency_contact: Optional[str] = None
    active_role: Literal["passenger", "driver", "admin"] = "passenger"
    is_admin: bool = False
    wallet_balance: float = 0.0
    created_at: datetime


class SessionExchangeIn(BaseModel):
    session_id: str


class OtpSendIn(BaseModel):
    phone: str


class OtpVerifyIn(BaseModel):
    phone: str
    code: str
    name: Optional[str] = None


class ProfileUpdateIn(BaseModel):
    name: Optional[str] = None
    picture: Optional[str] = None
    emergency_contact: Optional[str] = None
    active_role: Optional[Literal["passenger", "driver", "admin"]] = None


class VehicleIn(BaseModel):
    vehicle_type: Literal["car", "tempo", "bus"]
    model: str
    number_plate: str
    total_seats: int
    from_location: str
    to_location: str
    fare_per_seat: float
    departure_time: str  # HH:MM
    photo: Optional[str] = None


class Vehicle(VehicleIn):
    vehicle_id: str
    driver_id: str
    driver_name: str
    driver_picture: Optional[str] = None
    driver_phone: Optional[str] = None
    rating: float = 4.7
    status: Literal["pending", "approved", "rejected"] = "pending"
    created_at: datetime


class BookingCreateIn(BaseModel):
    vehicle_id: str
    travel_date: str  # YYYY-MM-DD
    seat_numbers: List[int] = Field(min_length=1, max_length=40)


class Booking(BaseModel):
    booking_id: str
    vehicle_id: str
    passenger_id: str
    passenger_name: str
    passenger_phone: Optional[str] = None
    travel_date: str
    seat_numbers: List[int]
    seat_count: int
    total_amount: float
    driver_earning: float
    platform_commission: float
    status: Literal["pending", "paid", "cancelled"] = "pending"
    payment_method: Optional[str] = None
    created_at: datetime
    paid_at: Optional[datetime] = None


class PayIn(BaseModel):
    method: Literal["gpay", "phonepe", "upi", "razorpay"] = "gpay"


class VerifyPayIn(BaseModel):
    booking_id: str
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str


class WithdrawIn(BaseModel):
    amount: float = Field(gt=0, le=1_000_000)
    upi_id: str = Field(min_length=3, max_length=100)


class ReviewIn(BaseModel):
    booking_id: str
    stars: int = Field(ge=1, le=5)
    comment: Optional[str] = None


class ApplyReferralIn(BaseModel):
    code: str


# ---------- Utils ----------
def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def scrub(doc: dict) -> dict:
    doc.pop("_id", None)
    return doc


async def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.split(" ", 1)[1].strip()
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    exp = session["expires_at"]
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if exp < now_utc():
        raise HTTPException(status_code=401, detail="Session expired")
    user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


async def require_admin(user=Depends(get_current_user)) -> dict:
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin only")
    return user


async def upsert_user(email: Optional[str], phone: Optional[str], name: str, picture: Optional[str]) -> dict:
    query = {}
    if email:
        query["email"] = email.lower()
    elif phone:
        query["phone"] = phone
    else:
        raise HTTPException(status_code=400, detail="email or phone required")

    existing = await db.users.find_one(query, {"_id": 0})
    if existing:
        return existing
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    is_admin = bool(email and email.lower() in ADMIN_EMAILS)
    ref_code = _make_ref_code()
    doc = {
        "user_id": user_id,
        "email": email.lower() if email else None,
        "phone": phone,
        "name": name,
        "picture": picture,
        "emergency_contact": None,
        "active_role": "admin" if is_admin else "passenger",
        "is_admin": is_admin,
        "wallet_balance": 0.0,
        "referral_code": ref_code,
        "referred_by": None,
        "referral_paid": False,
        "created_at": now_utc(),
    }
    await db.users.insert_one(doc)
    return scrub(doc)


def _make_ref_code() -> str:
    return "RR" + secrets.token_hex(3).upper()


async def create_session(user_id: str) -> str:
    token = f"st_{uuid.uuid4().hex}{uuid.uuid4().hex}"
    await db.user_sessions.insert_one({
        "session_token": token,
        "user_id": user_id,
        "expires_at": now_utc() + timedelta(days=7),
        "created_at": now_utc(),
    })
    return token


# ---------- Auth: Emergent Google ----------
@api.post("/auth/session")
async def auth_session(payload: SessionExchangeIn):
    async with httpx.AsyncClient(timeout=30) as h:
        r = await h.get(
            "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
            headers={"X-Session-ID": payload.session_id},
        )
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid session_id")
    data = r.json()
    email = data.get("email")
    name = data.get("name") or (email.split("@")[0] if email else "User")
    picture = data.get("picture")
    session_token = data.get("session_token") or f"st_{uuid.uuid4().hex}{uuid.uuid4().hex}"

    user = await upsert_user(email=email, phone=None, name=name, picture=picture)
    await db.user_sessions.insert_one({
        "session_token": session_token,
        "user_id": user["user_id"],
        "expires_at": now_utc() + timedelta(days=7),
        "created_at": now_utc(),
    })
    return {"session_token": session_token, "user": user}


# ---------- Auth: Phone OTP ----------
def _normalize_phone(p: str) -> str:
    return "".join(ch for ch in (p or "").strip() if ch.isdigit() or ch == "+")


def _hash_otp(code: str) -> str:
    return bcrypt.hashpw(code.encode(), bcrypt.gensalt(rounds=8)).decode()


def _verify_otp_hash(code: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(code.encode(), hashed.encode())
    except Exception:
        return False


@api.post("/auth/otp/send")
async def otp_send(payload: OtpSendIn):
    phone = _normalize_phone(payload.phone)
    if len(phone) < 8 or len(phone) > 16:
        raise HTTPException(status_code=400, detail="Invalid phone")

    # Rate limit: count sends in the last window
    since = now_utc() - timedelta(seconds=OTP_SEND_WINDOW_SECONDS)
    recent = await db.otp_codes.count_documents({"phone": phone, "created_at": {"$gte": since}})
    if recent >= OTP_SEND_MAX_PER_WINDOW:
        raise HTTPException(status_code=429, detail="Too many OTP requests. Try later.")

    code = f"{secrets.randbelow(1_000_000):06d}"
    await db.otp_codes.insert_one({
        "phone": phone,
        "code_hash": _hash_otp(code),
        "expires_at": now_utc() + timedelta(seconds=OTP_TTL_SECONDS),
        "attempts": 0,
        "consumed": False,
        "created_at": now_utc(),
    })
    resp: dict = {"ok": True, "message": "OTP sent to your phone"}
    if OTP_DEV_MODE:
        resp["dev_code"] = code
        resp["message"] = f"OTP sent (DEV mode: use {code})"
    return resp


@api.post("/auth/otp/verify")
async def otp_verify(payload: OtpVerifyIn):
    phone = _normalize_phone(payload.phone)
    code = (payload.code or "").strip()
    if not code.isdigit() or len(code) != 6:
        raise HTTPException(status_code=400, detail="Invalid OTP format")

    # Block OTP path for admins — force them to use Google auth
    existing_admin = await db.users.find_one({"phone": phone, "is_admin": True}, {"_id": 0, "user_id": 1})
    if existing_admin:
        raise HTTPException(status_code=403, detail="Admin accounts must sign in with Google")

    otp_doc = await db.otp_codes.find_one({"phone": phone, "consumed": False}, sort=[("created_at", -1)])
    if not otp_doc:
        raise HTTPException(status_code=401, detail="OTP not found or already used. Request a new code.")
    exp = otp_doc["expires_at"]
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if exp < now_utc():
        raise HTTPException(status_code=401, detail="OTP expired. Request a new code.")
    if otp_doc.get("attempts", 0) >= OTP_MAX_ATTEMPTS:
        await db.otp_codes.update_one({"_id": otp_doc["_id"]}, {"$set": {"consumed": True}})
        raise HTTPException(status_code=429, detail="Too many attempts. Request a new code.")

    if not _verify_otp_hash(code, otp_doc["code_hash"]):
        await db.otp_codes.update_one({"_id": otp_doc["_id"]}, {"$inc": {"attempts": 1}})
        raise HTTPException(status_code=401, detail="Invalid OTP")

    await db.otp_codes.update_one({"_id": otp_doc["_id"]}, {"$set": {"consumed": True}})

    name = (payload.name or "").strip() or f"User {phone[-4:]}"
    user = await upsert_user(email=None, phone=phone, name=name, picture=None)
    # Do not allow escalation via phone login even if somehow flagged admin later
    if user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin accounts must sign in with Google")
    token = await create_session(user["user_id"])
    return {"session_token": token, "user": user}


@api.get("/auth/me")
async def auth_me(user=Depends(get_current_user)):
    return user


@api.post("/auth/logout")
async def auth_logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1].strip()
        await db.user_sessions.delete_one({"session_token": token})
    return {"ok": True}


# ---------- Profile ----------
@api.patch("/users/me")
async def update_me(payload: ProfileUpdateIn, user=Depends(get_current_user)):
    updates = {k: v for k, v in payload.dict().items() if v is not None}
    if payload.active_role == "admin" and not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Not admin")
    if updates:
        await db.users.update_one({"user_id": user["user_id"]}, {"$set": updates})
    updated = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    return updated


# ---------- Upload ----------
@api.post("/upload")
async def upload_file(file: UploadFile = File(...), user=Depends(get_current_user)):
    ext = (file.filename or "bin").rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else "jpg"
    if ext not in ALLOWED_IMAGE_EXTS:
        ext = "jpg"
    # SEC-005: force safe content-type by extension; ignore client-supplied Content-Type
    ext_to_mime = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp", "heic": "image/heic", "heif": "image/heif"}
    content_type = ext_to_mime.get(ext, "image/jpeg")
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"File too large (max {MAX_UPLOAD_BYTES // 1024 // 1024} MB)")
    if len(data) < 8:
        raise HTTPException(status_code=400, detail="Empty file")
    path = f"{APP_NAME}/uploads/{user['user_id']}/{uuid.uuid4().hex}.{ext}"
    await run_in_threadpool(put_object, path, data, content_type)
    await db.files.insert_one({
        "path": path,
        "owner_id": user["user_id"],
        "content_type": content_type,
        "size": len(data),
        "created_at": now_utc(),
    })
    url = f"/api/files/{path}"
    return {"path": path, "url": url}


@api.get("/files/{path:path}")
async def get_file(path: str):
    # Public read for images. SEC-005: only serve if we recorded it, and never as HTML.
    meta = await db.files.find_one({"path": path}, {"_id": 0})
    if not meta:
        raise HTTPException(status_code=404, detail="Not found")
    ctype = meta.get("content_type") or "application/octet-stream"
    if ctype not in ALLOWED_IMAGE_MIME:
        ctype = "application/octet-stream"
    content, _srv_ct = await run_in_threadpool(get_object, path)
    return Response(
        content=content,
        media_type=ctype,
        headers={
            "X-Content-Type-Options": "nosniff",
            "Content-Disposition": "inline",
            "Cache-Control": "public, max-age=3600",
        },
    )


# ---------- Vehicles ----------
@api.post("/vehicles")
async def register_vehicle(payload: VehicleIn, user=Depends(get_current_user)):
    vid = f"veh_{uuid.uuid4().hex[:12]}"
    doc = {
        "vehicle_id": vid,
        "driver_id": user["user_id"],
        "driver_name": user["name"],
        "driver_picture": user.get("picture"),
        "driver_phone": user.get("phone"),
        "rating": 4.7,
        "status": "pending",
        "created_at": now_utc(),
        **payload.dict(),
    }
    await db.vehicles.insert_one(doc)
    return scrub(doc)


@api.get("/vehicles/mine")
async def my_vehicles(user=Depends(get_current_user)):
    items = await db.vehicles.find({"driver_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return items


@api.get("/vehicles/search")
async def search_vehicles(
    from_location: Optional[str] = Query(None, alias="from"),
    to_location: Optional[str] = Query(None, alias="to"),
    vehicle_type: Optional[str] = Query(None),
    travel_date: Optional[str] = Query(None),
):
    q: dict = {"status": "approved"}
    if from_location:
        q["from_location"] = {"$regex": from_location, "$options": "i"}
    if to_location:
        q["to_location"] = {"$regex": to_location, "$options": "i"}
    if vehicle_type and vehicle_type != "all":
        q["vehicle_type"] = vehicle_type
    items = await db.vehicles.find(q, {"_id": 0}).to_list(200)
    if travel_date and items:
        vids = [v["vehicle_id"] for v in items]
        # Single batched query instead of N+1
        pipeline = [
            {"$match": {"vehicle_id": {"$in": vids}, "travel_date": travel_date, "status": "paid"}},
            {"$unwind": "$seat_numbers"},
            {"$group": {"_id": "$vehicle_id", "taken": {"$sum": 1}}},
        ]
        taken_map = {r["_id"]: r["taken"] async for r in db.bookings.aggregate(pipeline)}
        for v in items:
            v["seats_available"] = max(0, v["total_seats"] - taken_map.get(v["vehicle_id"], 0))
    else:
        for v in items:
            v["seats_available"] = v["total_seats"]
    return items


@api.get("/vehicles/{vehicle_id}")
async def get_vehicle(vehicle_id: str):
    v = await db.vehicles.find_one({"vehicle_id": vehicle_id}, {"_id": 0})
    if not v:
        raise HTTPException(status_code=404, detail="Not found")
    return v


@api.get("/vehicles/{vehicle_id}/seats")
async def vehicle_seats(vehicle_id: str, travel_date: str):
    v = await db.vehicles.find_one({"vehicle_id": vehicle_id}, {"_id": 0})
    if not v:
        raise HTTPException(status_code=404, detail="Not found")
    booked = await db.bookings.find(
        {"vehicle_id": vehicle_id, "travel_date": travel_date, "status": "paid"},
        {"_id": 0, "seat_numbers": 1},
    ).to_list(500)
    taken: List[int] = []
    for b in booked:
        taken.extend(b["seat_numbers"])
    return {
        "vehicle_id": vehicle_id,
        "total_seats": v["total_seats"],
        "vehicle_type": v["vehicle_type"],
        "booked_seats": sorted(set(taken)),
    }


# ---------- Bookings ----------
@api.post("/bookings")
async def create_booking(payload: BookingCreateIn, user=Depends(get_current_user)):
    v = await db.vehicles.find_one({"vehicle_id": payload.vehicle_id}, {"_id": 0})
    if not v:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    if v["status"] != "approved":
        raise HTTPException(status_code=400, detail="Vehicle not approved")

    # Validate seat numbers: unique, positive, within capacity
    seats = list(dict.fromkeys(payload.seat_numbers))  # de-dupe preserving order
    if len(seats) != len(payload.seat_numbers):
        raise HTTPException(status_code=400, detail="Duplicate seat numbers")
    for s in seats:
        if not isinstance(s, int) or s < 1 or s > v["total_seats"]:
            raise HTTPException(status_code=400, detail=f"Invalid seat number: {s}")

    # Validate travel_date (YYYY-MM-DD) and not in past
    try:
        d = datetime.strptime(payload.travel_date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format")
    if d < datetime.now(timezone.utc).date():
        raise HTTPException(status_code=400, detail="Travel date in the past")

    # Check seat conflicts
    booked = await db.bookings.find(
        {"vehicle_id": payload.vehicle_id, "travel_date": payload.travel_date, "status": "paid"},
        {"_id": 0, "seat_numbers": 1},
    ).to_list(500)
    taken = {s for b in booked for s in b["seat_numbers"]}
    conflict = [s for s in seats if s in taken]
    if conflict:
        raise HTTPException(status_code=409, detail=f"Seats already booked: {conflict}")

    total = v["fare_per_seat"] * len(seats)
    commission = round(total * COMMISSION_RATE, 2)
    driver_earn = round(total - commission, 2)

    bid = f"bk_{uuid.uuid4().hex[:12]}"
    doc = {
        "booking_id": bid,
        "vehicle_id": payload.vehicle_id,
        "passenger_id": user["user_id"],
        "passenger_name": user["name"],
        "passenger_phone": user.get("phone"),
        "travel_date": payload.travel_date,
        "seat_numbers": seats,
        "seat_count": len(seats),
        "total_amount": total,
        "driver_earning": driver_earn,
        "platform_commission": commission,
        "status": "pending",
        "payment_method": None,
        "created_at": now_utc(),
        "paid_at": None,
    }
    await db.bookings.insert_one(doc)
    return scrub(doc)


async def _fulfill_paid_booking(booking_id: str, payment_method: str) -> dict:
    """Mark booking paid, credit driver 50%, record platform commission, apply referral bonus on referee's first paid booking."""
    b = await db.bookings.find_one({"booking_id": booking_id}, {"_id": 0})
    if not b:
        raise HTTPException(status_code=404, detail="Booking not found")
    if b["status"] == "paid":
        return b

    await db.bookings.update_one(
        {"booking_id": booking_id},
        {"$set": {"status": "paid", "payment_method": payment_method, "paid_at": now_utc()}},
    )

    v = await db.vehicles.find_one({"vehicle_id": b["vehicle_id"]}, {"_id": 0})
    if v:
        await db.users.update_one(
            {"user_id": v["driver_id"]}, {"$inc": {"wallet_balance": b["driver_earning"]}}
        )
        await db.transactions.insert_one({
            "txn_id": f"tx_{uuid.uuid4().hex[:12]}",
            "user_id": v["driver_id"],
            "booking_id": booking_id,
            "type": "credit",
            "amount": b["driver_earning"],
            "note": f"Earning from booking {booking_id}",
            "created_at": now_utc(),
        })
        await db.transactions.insert_one({
            "txn_id": f"tx_{uuid.uuid4().hex[:12]}",
            "user_id": "PLATFORM",
            "booking_id": booking_id,
            "type": "commission",
            "amount": b["platform_commission"],
            "note": f"Platform 50% commission on {booking_id}",
            "created_at": now_utc(),
        })

    # Referral bonus on first paid booking
    passenger = await db.users.find_one({"user_id": b["passenger_id"]}, {"_id": 0})
    if passenger and passenger.get("referred_by") and not passenger.get("referral_paid"):
        referrer_code = passenger["referred_by"]
        referrer = await db.users.find_one({"referral_code": referrer_code}, {"_id": 0})
        if referrer:
            bonus = REFERRAL_BONUS
            await db.users.update_one({"user_id": referrer["user_id"]}, {"$inc": {"wallet_balance": bonus}})
            await db.users.update_one({"user_id": passenger["user_id"]}, {"$inc": {"wallet_balance": bonus}, "$set": {"referral_paid": True}})
            await db.transactions.insert_many([
                {"txn_id": f"tx_{uuid.uuid4().hex[:12]}", "user_id": referrer["user_id"], "type": "credit", "amount": bonus, "note": f"Referral bonus for {passenger['name']}", "created_at": now_utc()},
                {"txn_id": f"tx_{uuid.uuid4().hex[:12]}", "user_id": passenger["user_id"], "type": "credit", "amount": bonus, "note": f"Welcome bonus (referred by {referrer['name']})", "created_at": now_utc()},
            ])

    return await db.bookings.find_one({"booking_id": booking_id}, {"_id": 0})


@api.post("/bookings/{booking_id}/pay")
async def pay_booking(booking_id: str, payload: PayIn, user=Depends(get_current_user)):
    b = await db.bookings.find_one({"booking_id": booking_id}, {"_id": 0})
    if not b or b["passenger_id"] != user["user_id"]:
        raise HTTPException(status_code=404, detail="Booking not found")
    if b["status"] == "paid":
        return b

    # Razorpay flow: create order and return checkout config; client must call /verify after payment
    if payload.method == "razorpay" and RAZORPAY_ENABLED:
        try:
            order = await run_in_threadpool(
                rzp_client.order.create,
                {"amount": int(b["total_amount"] * 100), "currency": "INR", "receipt": booking_id, "notes": {"booking_id": booking_id, "user_id": user["user_id"]}},
            )
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Razorpay error: {e}")
        await db.bookings.update_one({"booking_id": booking_id}, {"$set": {"razorpay_order_id": order["id"]}})
        return {
            "requires_action": "razorpay",
            "key_id": RAZORPAY_KEY_ID,
            "order_id": order["id"],
            "amount": int(b["total_amount"] * 100),
            "currency": "INR",
            "booking_id": booking_id,
            "prefill": {"name": user["name"], "email": user.get("email") or "", "contact": user.get("phone") or ""},
        }

    # SEC-003: mock path only allowed when explicitly enabled or Razorpay not configured
    if RAZORPAY_ENABLED and payload.method != "razorpay":
        raise HTTPException(status_code=400, detail="Razorpay checkout required. Use method='razorpay'.")
    if not PAYMENT_MOCK_ALLOWED:
        raise HTTPException(status_code=503, detail="Payment gateway not configured")

    # Mock flow (GPay/PhonePe/UPI) — DEV/preview only
    return await _fulfill_paid_booking(booking_id, payload.method)


@api.post("/bookings/verify-payment")
async def verify_razorpay_payment(payload: VerifyPayIn, user=Depends(get_current_user)):
    if not RAZORPAY_ENABLED:
        raise HTTPException(status_code=400, detail="Razorpay not configured")
    b = await db.bookings.find_one({"booking_id": payload.booking_id}, {"_id": 0})
    if not b or b["passenger_id"] != user["user_id"]:
        raise HTTPException(status_code=404, detail="Booking not found")
    expected = hmac.new(
        RAZORPAY_KEY_SECRET.encode(),
        f"{payload.razorpay_order_id}|{payload.razorpay_payment_id}".encode(),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected, payload.razorpay_signature):
        raise HTTPException(status_code=400, detail="Invalid payment signature")
    return await _fulfill_paid_booking(payload.booking_id, "razorpay")


@api.get("/bookings/mine")
async def my_bookings(user=Depends(get_current_user)):
    items = await db.bookings.find({"passenger_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
    if not items:
        return items
    vids = list({b["vehicle_id"] for b in items})
    vmap = {v["vehicle_id"]: v async for v in db.vehicles.find({"vehicle_id": {"$in": vids}}, {"_id": 0})}
    for b in items:
        v = vmap.get(b["vehicle_id"])
        if v:
            b["vehicle"] = {
                "model": v["model"],
                "vehicle_type": v["vehicle_type"],
                "from_location": v["from_location"],
                "to_location": v["to_location"],
                "departure_time": v["departure_time"],
                "driver_name": v["driver_name"],
                "driver_phone": v.get("driver_phone"),
                "driver_picture": v.get("driver_picture"),
                "number_plate": v["number_plate"],
            }
    return items


@api.get("/bookings/{booking_id}")
async def get_booking(booking_id: str, user=Depends(get_current_user)):
    b = await db.bookings.find_one({"booking_id": booking_id}, {"_id": 0})
    if not b:
        raise HTTPException(status_code=404, detail="Not found")
    # SEC-002: only passenger or the vehicle's driver can read the booking
    is_passenger = b["passenger_id"] == user["user_id"]
    v = await db.vehicles.find_one({"vehicle_id": b["vehicle_id"]}, {"_id": 0})
    is_driver = bool(v and v.get("driver_id") == user["user_id"])
    if not (is_passenger or is_driver or user.get("is_admin")):
        raise HTTPException(status_code=404, detail="Not found")
    if v:
        b["vehicle"] = {
            "model": v["model"],
            "vehicle_type": v["vehicle_type"],
            "from_location": v["from_location"],
            "to_location": v["to_location"],
            "departure_time": v["departure_time"],
            "driver_name": v["driver_name"],
            "driver_phone": v.get("driver_phone") if b["status"] == "paid" else None,
            "driver_picture": v.get("driver_picture"),
            "number_plate": v["number_plate"],
        }
    return b


@api.get("/bookings/driver/list")
async def driver_bookings(user=Depends(get_current_user)):
    my_veh = await db.vehicles.find({"driver_id": user["user_id"]}, {"_id": 0}).to_list(200)
    if not my_veh:
        return []
    vmap = {v["vehicle_id"]: v for v in my_veh}
    items = await db.bookings.find(
        {"vehicle_id": {"$in": list(vmap.keys())}, "status": "paid"}, {"_id": 0}
    ).sort("travel_date", 1).to_list(500)
    for b in items:
        v = vmap.get(b["vehicle_id"])
        if v:
            b["vehicle_model"] = v["model"]
            b["route"] = f"{v['from_location']} → {v['to_location']}"
    return items


@api.post("/bookings/{booking_id}/cancel")
async def cancel_booking(booking_id: str, user=Depends(get_current_user)):
    b = await db.bookings.find_one({"booking_id": booking_id}, {"_id": 0})
    if not b or b["passenger_id"] != user["user_id"]:
        raise HTTPException(status_code=404, detail="Booking not found")
    if b["status"] == "cancelled":
        return b

    # SEC-003 hardening: cannot cancel after departure time (prevents free-ride attack)
    v = await db.vehicles.find_one({"vehicle_id": b["vehicle_id"]}, {"_id": 0})
    if v:
        try:
            Y, M, D = [int(x) for x in b["travel_date"].split("-")]
            h, m = [int(x) for x in (v.get("departure_time") or "00:00").split(":")]
            departure = datetime(Y, M, D, h, m, tzinfo=timezone.utc)
            if now_utc() >= departure:
                raise HTTPException(status_code=400, detail="Cannot cancel after departure time")
        except ValueError:
            pass

    if b["status"] == "paid" and v:
        await db.users.update_one({"user_id": v["driver_id"]}, {"$inc": {"wallet_balance": -b["driver_earning"]}})
        await db.transactions.insert_one({
            "txn_id": f"tx_{uuid.uuid4().hex[:12]}",
            "user_id": v["driver_id"],
            "booking_id": booking_id,
            "type": "debit",
            "amount": b["driver_earning"],
            "note": f"Refund for cancelled booking {booking_id}",
            "created_at": now_utc(),
        })
    await db.bookings.update_one(
        {"booking_id": booking_id},
        {"$set": {"status": "cancelled", "cancelled_at": now_utc()}},
    )
    return await db.bookings.find_one({"booking_id": booking_id}, {"_id": 0})


# ---------- Wallet ----------
@api.get("/wallet/me")
async def wallet_me(user=Depends(get_current_user)):
    txns = await db.transactions.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
    fresh = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0, "wallet_balance": 1})
    return {"balance": (fresh or {}).get("wallet_balance", 0.0), "transactions": txns}


@api.post("/wallet/withdraw")
async def withdraw(payload: WithdrawIn, user=Depends(get_current_user)):
    # SEC-004: atomic conditional decrement (prevents race + defense-in-depth against negatives)
    result = await db.users.find_one_and_update(
        {"user_id": user["user_id"], "wallet_balance": {"$gte": payload.amount}},
        {"$inc": {"wallet_balance": -payload.amount}},
        projection={"_id": 0, "wallet_balance": 1},
        return_document=True,
    )
    if not result:
        raise HTTPException(status_code=400, detail="Insufficient balance")
    await db.transactions.insert_one({
        "txn_id": f"tx_{uuid.uuid4().hex[:12]}",
        "user_id": user["user_id"],
        "type": "debit",
        "amount": payload.amount,
        "note": f"Withdrawn to UPI {payload.upi_id}",
        "created_at": now_utc(),
    })
    return {"ok": True, "message": "Withdrawal initiated", "balance": result.get("wallet_balance", 0)}


# ---------- Admin ----------
@api.get("/admin/stats")
async def admin_stats(user=Depends(require_admin)):
    total_bookings = await db.bookings.count_documents({"status": "paid"})
    active_drivers = await db.vehicles.distinct("driver_id", {"status": "approved"})
    pipeline = [
        {"$match": {"status": "paid"}},
        {"$group": {"_id": None, "revenue": {"$sum": "$total_amount"}, "commission": {"$sum": "$platform_commission"}}},
    ]
    agg = await db.bookings.aggregate(pipeline).to_list(1)
    revenue = agg[0]["revenue"] if agg else 0
    commission = agg[0]["commission"] if agg else 0
    pending = await db.vehicles.count_documents({"status": "pending"})
    return {
        "total_revenue": revenue,
        "platform_commission": commission,
        "active_drivers": len(active_drivers),
        "total_bookings": total_bookings,
        "pending_approvals": pending,
    }


@api.get("/admin/vehicles/pending")
async def admin_pending_vehicles(user=Depends(require_admin)):
    return await db.vehicles.find({"status": "pending"}, {"_id": 0}).sort("created_at", -1).to_list(200)


@api.get("/admin/vehicles/all")
async def admin_all_vehicles(user=Depends(require_admin)):
    return await db.vehicles.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)


@api.post("/admin/vehicles/{vehicle_id}/approve")
async def approve_vehicle(vehicle_id: str, user=Depends(require_admin)):
    await db.vehicles.update_one({"vehicle_id": vehicle_id}, {"$set": {"status": "approved"}})
    return {"ok": True}


@api.post("/admin/vehicles/{vehicle_id}/reject")
async def reject_vehicle(vehicle_id: str, user=Depends(require_admin)):
    await db.vehicles.update_one({"vehicle_id": vehicle_id}, {"$set": {"status": "rejected"}})
    return {"ok": True}


@api.get("/admin/commissions")
async def admin_commissions(user=Depends(require_admin)):
    return await db.transactions.find({"user_id": "PLATFORM"}, {"_id": 0}).sort("created_at", -1).to_list(300)


# ---------- Reviews ----------
async def _recompute_vehicle_rating(vehicle_id: str) -> None:
    pipeline = [
        {"$match": {"vehicle_id": vehicle_id}},
        {"$group": {"_id": None, "avg": {"$avg": "$stars"}, "count": {"$sum": 1}}},
    ]
    agg = await db.reviews.aggregate(pipeline).to_list(1)
    if agg:
        await db.vehicles.update_one(
            {"vehicle_id": vehicle_id},
            {"$set": {"rating": round(agg[0]["avg"], 2), "review_count": agg[0]["count"]}},
        )


async def _recompute_driver_verification(driver_id: str) -> None:
    """A driver becomes 'verified' after receiving 5+ five-star reviews across all their vehicles."""
    my_vids = await db.vehicles.distinct("vehicle_id", {"driver_id": driver_id})
    if not my_vids:
        return
    count = await db.reviews.count_documents({"vehicle_id": {"$in": my_vids}, "stars": 5})
    is_verified = count >= 5
    await db.vehicles.update_many(
        {"driver_id": driver_id},
        {"$set": {"driver_verified": is_verified, "driver_five_star_count": count}},
    )
    await db.users.update_one(
        {"user_id": driver_id},
        {"$set": {"driver_verified": is_verified, "driver_five_star_count": count}},
    )


@api.post("/reviews")
async def create_review(payload: ReviewIn, user=Depends(get_current_user)):
    b = await db.bookings.find_one({"booking_id": payload.booking_id}, {"_id": 0})
    if not b or b["passenger_id"] != user["user_id"]:
        raise HTTPException(status_code=404, detail="Booking not found")
    if b["status"] != "paid":
        raise HTTPException(status_code=400, detail="Can only rate paid bookings")
    existing = await db.reviews.find_one({"booking_id": payload.booking_id}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=409, detail="Already reviewed")
    doc = {
        "review_id": f"rv_{uuid.uuid4().hex[:12]}",
        "booking_id": payload.booking_id,
        "vehicle_id": b["vehicle_id"],
        "passenger_id": user["user_id"],
        "passenger_name": user["name"],
        "stars": payload.stars,
        "comment": (payload.comment or "").strip(),
        "created_at": now_utc(),
    }
    await db.reviews.insert_one(doc)
    await _recompute_vehicle_rating(b["vehicle_id"])
    v = await db.vehicles.find_one({"vehicle_id": b["vehicle_id"]}, {"_id": 0, "driver_id": 1})
    if v:
        await _recompute_driver_verification(v["driver_id"])
    return scrub(doc)


@api.get("/reviews/vehicle/{vehicle_id}")
async def list_vehicle_reviews(vehicle_id: str):
    items = await db.reviews.find({"vehicle_id": vehicle_id}, {"_id": 0}).sort("created_at", -1).to_list(50)
    return items


@api.get("/reviews/mine")
async def my_reviews(user=Depends(get_current_user)):
    items = await db.reviews.find({"passenger_id": user["user_id"]}, {"_id": 0}).to_list(200)
    return items


# ---------- Referrals ----------
@api.get("/referrals/me")
async def my_referral(user=Depends(get_current_user)):
    fresh = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    if not fresh:
        raise HTTPException(status_code=404, detail="not found")
    if not fresh.get("referral_code"):
        code = _make_ref_code()
        await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"referral_code": code}})
        fresh["referral_code"] = code
    invited = await db.users.count_documents({"referred_by": fresh["referral_code"]})
    earned = 0.0
    async for t in db.transactions.find({"user_id": user["user_id"], "note": {"$regex": "^Referral bonus"}}, {"_id": 0, "amount": 1}):
        earned += float(t.get("amount", 0))
    return {
        "referral_code": fresh["referral_code"],
        "referred_by": fresh.get("referred_by"),
        "invited": invited,
        "earned": earned,
        "bonus": REFERRAL_BONUS,
    }


@api.post("/referrals/apply")
async def apply_referral(payload: ApplyReferralIn, user=Depends(get_current_user)):
    fresh = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    if not fresh:
        raise HTTPException(status_code=404, detail="not found")
    if fresh.get("referred_by"):
        raise HTTPException(status_code=409, detail="Referral already applied")
    code = payload.code.strip().upper()
    if code == fresh.get("referral_code"):
        raise HTTPException(status_code=400, detail="Cannot use your own code")
    referrer = await db.users.find_one({"referral_code": code}, {"_id": 0})
    if not referrer:
        raise HTTPException(status_code=404, detail="Invalid code")
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"referred_by": code}})
    return {"ok": True, "message": f"Applied. You + {referrer['name']} earn ₹{REFERRAL_BONUS:.0f} after your first paid ride."}


# ---------- Config (public) ----------
@api.get("/config")
async def config():
    return {
        "razorpay_enabled": RAZORPAY_ENABLED,
        "razorpay_key_id": RAZORPAY_KEY_ID if RAZORPAY_ENABLED else None,
        "referral_bonus": REFERRAL_BONUS,
    }


# ---------- Geocoding for map preview ----------
# Static coords for common Indian cities. Extensible; falls back to Nominatim if configured later.
CITY_COORDS = {
    "bangalore": (12.9716, 77.5946), "bengaluru": (12.9716, 77.5946),
    "mysore": (12.2958, 76.6394), "mysuru": (12.2958, 76.6394),
    "chennai": (13.0827, 80.2707), "coorg": (12.3375, 75.8069), "madikeri": (12.4244, 75.7382),
    "mumbai": (19.0760, 72.8777), "pune": (18.5204, 73.8567), "delhi": (28.6139, 77.2090),
    "new delhi": (28.6139, 77.2090), "hyderabad": (17.3850, 78.4867),
    "kolkata": (22.5726, 88.3639), "ahmedabad": (23.0225, 72.5714),
    "goa": (15.2993, 74.1240), "panaji": (15.4909, 73.8278),
    "jaipur": (26.9124, 75.7873), "lucknow": (26.8467, 80.9462),
    "kochi": (9.9312, 76.2673), "kozhikode": (11.2588, 75.7804), "thiruvananthapuram": (8.5241, 76.9366),
    "manipal": (13.3467, 74.7869), "udupi": (13.3409, 74.7421), "mangalore": (12.9141, 74.856),
    "chikmagalur": (13.3161, 75.7720), "hampi": (15.3350, 76.4600), "ooty": (11.4064, 76.6932),
}


@api.get("/geocode")
async def geocode(q: str = Query(...)):
    key = q.strip().lower()
    if key in CITY_COORDS:
        lat, lon = CITY_COORDS[key]
        return {"query": q, "lat": lat, "lon": lon, "source": "static"}
    # fuzzy contains
    for city, (lat, lon) in CITY_COORDS.items():
        if city in key or key in city:
            return {"query": q, "lat": lat, "lon": lon, "source": "fuzzy"}
    raise HTTPException(status_code=404, detail="Unknown city. Try Bangalore, Mysore, Chennai, Coorg, Mumbai, Delhi, etc.")


@api.get("/")
async def root():
    return {"service": "RideReserve API", "version": "1.1"}


app.include_router(api)

# CORS: mobile apps don't send Origin. Bearer tokens (not cookies) → credentials must be False for wildcard.
app.add_middleware(
    CORSMiddleware,
    allow_credentials=CORS_ORIGINS != ["*"],
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------- Seeding & indexes ----------
async def seed():
    await db.users.create_index("user_id", unique=True)
    await db.users.create_index("email", sparse=True)
    await db.users.create_index("phone", sparse=True)
    await db.user_sessions.create_index("session_token", unique=True)
    await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
    await db.vehicles.create_index("vehicle_id", unique=True)
    await db.bookings.create_index("booking_id", unique=True)
    await db.reviews.create_index("booking_id", unique=True)
    await db.reviews.create_index("vehicle_id")
    await db.users.create_index("referral_code", sparse=True)
    await db.otp_codes.create_index("phone")
    await db.otp_codes.create_index("expires_at", expireAfterSeconds=0)

    # Seed admin
    admin_email = "admin@ridereserve.app"
    if not await db.users.find_one({"email": admin_email}):
        await db.users.insert_one({
            "user_id": "user_admin_seed",
            "email": admin_email,
            "phone": "+911111111111",
            "name": "Admin",
            "picture": None,
            "emergency_contact": None,
            "active_role": "admin",
            "is_admin": True,
            "wallet_balance": 0.0,
            "created_at": now_utc(),
        })

    # Seed a demo driver + vehicles if none
    if await db.vehicles.count_documents({}) == 0:
        driver_id = "user_demo_driver"
        if not await db.users.find_one({"user_id": driver_id}):
            await db.users.insert_one({
                "user_id": driver_id,
                "email": None,
                "phone": "+919000000001",
                "name": "Ravi Kumar",
                "picture": None,
                "emergency_contact": "+919000000099",
                "active_role": "driver",
                "is_admin": False,
                "wallet_balance": 0.0,
                "created_at": now_utc(),
            })
        vehicles = [
            {
                "vehicle_id": "veh_demo_car_01",
                "driver_id": driver_id,
                "driver_name": "Ravi Kumar",
                "driver_picture": None,
                "driver_phone": "+919000000001",
                "rating": 4.8,
                "status": "approved",
                "vehicle_type": "car",
                "model": "Honda Amaze",
                "number_plate": "KA01AB1234",
                "total_seats": 4,
                "from_location": "Bangalore",
                "to_location": "Mysore",
                "fare_per_seat": 450,
                "departure_time": "07:30",
                "photo": None,
                "created_at": now_utc(),
            },
            {
                "vehicle_id": "veh_demo_tempo_01",
                "driver_id": driver_id,
                "driver_name": "Ravi Kumar",
                "driver_picture": None,
                "driver_phone": "+919000000001",
                "rating": 4.6,
                "status": "approved",
                "vehicle_type": "tempo",
                "model": "Force Traveller",
                "number_plate": "KA02CD5678",
                "total_seats": 12,
                "from_location": "Bangalore",
                "to_location": "Coorg",
                "fare_per_seat": 700,
                "departure_time": "06:00",
                "photo": None,
                "created_at": now_utc(),
            },
            {
                "vehicle_id": "veh_demo_bus_01",
                "driver_id": driver_id,
                "driver_name": "Ravi Kumar",
                "driver_picture": None,
                "driver_phone": "+919000000001",
                "rating": 4.7,
                "status": "approved",
                "vehicle_type": "bus",
                "model": "Volvo Multi-Axle",
                "number_plate": "KA03EF9012",
                "total_seats": 32,
                "from_location": "Bangalore",
                "to_location": "Chennai",
                "fare_per_seat": 950,
                "departure_time": "22:00",
                "photo": None,
                "created_at": now_utc(),
            },
        ]
        await db.vehicles.insert_many(vehicles)


@app.on_event("startup")
async def startup():
    try:
        await seed()
    except Exception as e:
        logger.error("seed error: %s", e)
    try:
        init_storage()
    except Exception as e:
        logger.warning("storage init deferred: %s", e)


@app.on_event("shutdown")
async def shutdown():
    client.close()

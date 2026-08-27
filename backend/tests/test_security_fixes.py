"""Backend tests for security fixes SEC-001..SEC-005.

Covers:
- SEC-001: real OTP (hashed, random-per-request, single-use, per-code attempt cap 5, per-phone send cap 5/hr, admin block on OTP path)
- SEC-002: booking read owner/driver-only access
- SEC-003: mock payment gated by PAYMENT_MOCK_ALLOWED, cancel after departure blocked
- SEC-004: withdraw negative-amount rejection (Pydantic gt=0) + atomic decrement
- SEC-005: upload force-maps MIME by extension, size cap, /files response headers
- Booking input validation: duplicate seats, out-of-range seats, past date, invalid format
"""
import concurrent.futures
import io
import os
import uuid
from datetime import date, timedelta

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://mobility-reserve-3.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "ride_reserve_db")


def auth_h(token):
    return {"Authorization": f"Bearer {token}"}


def _fresh_phone(prefix="+9196"):
    # Use digits only — `_normalize_phone` strips non-digits so hex letters would shrink the string.
    return f"{prefix}{uuid.uuid4().int % 10**8:08d}"


def _send_and_verify(sess, phone, name="TEST Sec"):
    rs = sess.post(f"{API}/auth/otp/send", json={"phone": phone})
    assert rs.status_code == 200, rs.text
    code = rs.json()["dev_code"]
    rv = sess.post(f"{API}/auth/otp/verify", json={"phone": phone, "code": code, "name": name})
    return code, rv


def _login(sess, name="TEST Sec User"):
    phone = _fresh_phone()
    _, rv = _send_and_verify(sess, phone, name)
    assert rv.status_code == 200, rv.text
    d = rv.json()
    return {"token": d["session_token"], "user": d["user"], "phone": phone}


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


@pytest.fixture(scope="module")
def mongo():
    return MongoClient(MONGO_URL)[DB_NAME]


# =========================================================================
# SEC-001: OTP real, hashed, rate-limited, single-use, admin-blocked
# =========================================================================
class TestSEC001_OTP:
    def test_send_returns_random_dev_code_each_call(self, s):
        phone = _fresh_phone()
        r1 = s.post(f"{API}/auth/otp/send", json={"phone": phone})
        r2 = s.post(f"{API}/auth/otp/send", json={"phone": phone})
        assert r1.status_code == 200 and r2.status_code == 200
        c1, c2 = r1.json()["dev_code"], r2.json()["dev_code"]
        assert c1 != c2, f"OTP not random: got {c1} twice"
        assert c1.isdigit() and len(c1) == 6

    def test_verify_wrong_code_401(self, s):
        phone = _fresh_phone()
        s.post(f"{API}/auth/otp/send", json={"phone": phone})
        r = s.post(f"{API}/auth/otp/verify", json={"phone": phone, "code": "000000"})
        assert r.status_code == 401

    def test_verify_old_static_123456_rejected(self, s):
        phone = _fresh_phone()
        # Latest OTP is a fresh random one, not '123456'.
        s.post(f"{API}/auth/otp/send", json={"phone": phone})
        r = s.post(f"{API}/auth/otp/verify", json={"phone": phone, "code": "123456"})
        assert r.status_code == 401

    def test_correct_code_once_then_single_use(self, s):
        phone = _fresh_phone()
        code, rv1 = _send_and_verify(s, phone, "Once")
        assert rv1.status_code == 200
        # Second verify with the SAME code must fail (consumed=True)
        rv2 = s.post(f"{API}/auth/otp/verify", json={"phone": phone, "code": code})
        assert rv2.status_code == 401

    def test_five_wrong_attempts_locks_code_429(self, s):
        phone = _fresh_phone()
        s.post(f"{API}/auth/otp/send", json={"phone": phone})
        # 5 wrong attempts trip the per-code attempt cap
        for _ in range(5):
            r = s.post(f"{API}/auth/otp/verify", json={"phone": phone, "code": "000000"})
            assert r.status_code == 401
        r6 = s.post(f"{API}/auth/otp/verify", json={"phone": phone, "code": "000000"})
        assert r6.status_code == 429, f"expected 429 after 5 attempts, got {r6.status_code} {r6.text}"

    def test_send_rate_limit_6_per_hour(self, s):
        phone = _fresh_phone()
        oks = 0
        got_429 = False
        # Attempt more than the allowed 5 per hour
        for _ in range(6):
            r = s.post(f"{API}/auth/otp/send", json={"phone": phone})
            if r.status_code == 200:
                oks += 1
            elif r.status_code == 429:
                got_429 = True
                break
        assert oks == 5 and got_429, f"expected 5x200 + 429 on 6th; oks={oks} got_429={got_429}"

    def test_admin_phone_cannot_login_via_otp(self, s, mongo):
        admin_phone = "+911111111111"
        # Clear any prior OTP records for stable rerun
        mongo.otp_codes.delete_many({"phone": admin_phone})
        # Seed an admin with this phone if not present
        mongo.users.update_one(
            {"phone": admin_phone},
            {"$setOnInsert": {
                "user_id": f"user_admin_test_{uuid.uuid4().hex[:8]}",
                "phone": admin_phone,
                "name": "TEST Admin OTP-block",
                "wallet_balance": 0.0,
                "created_at": __import__("datetime").datetime.utcnow(),
            }, "$set": {"is_admin": True, "active_role": "admin"}},
            upsert=True,
        )
        # Send should still return 200 (avoid enumeration)
        rs = s.post(f"{API}/auth/otp/send", json={"phone": admin_phone})
        assert rs.status_code == 200
        code = rs.json()["dev_code"]
        rv = s.post(f"{API}/auth/otp/verify", json={"phone": admin_phone, "code": code})
        assert rv.status_code == 403
        assert "google" in rv.text.lower()


# =========================================================================
# SEC-002: booking-read owner/driver check
# =========================================================================
class TestSEC002_BookingRead:
    def test_stranger_cannot_read_others_booking(self, s, mongo):
        passenger = _login(s, "SEC002 Passenger")
        # Book seeded car
        td = (date.today() + timedelta(days=45 + int(uuid.uuid4().int) % 200)).isoformat()
        seat = (int(uuid.uuid4().int) % 4) + 1
        r = s.post(
            f"{API}/bookings",
            json={"vehicle_id": "veh_demo_car_01", "travel_date": td, "seat_numbers": [seat]},
            headers=auth_h(passenger["token"]),
        )
        while r.status_code == 409:
            td = (date.today() + timedelta(days=45 + int(uuid.uuid4().int) % 500)).isoformat()
            r = s.post(
                f"{API}/bookings",
                json={"vehicle_id": "veh_demo_car_01", "travel_date": td, "seat_numbers": [seat]},
                headers=auth_h(passenger["token"]),
            )
        assert r.status_code == 200, r.text
        bid = r.json()["booking_id"]

        # Stranger reads -> 404
        stranger = _login(s, "SEC002 Stranger")
        rs = s.get(f"{API}/bookings/{bid}", headers=auth_h(stranger["token"]))
        assert rs.status_code == 404

        # Passenger reads -> 200
        rp = s.get(f"{API}/bookings/{bid}", headers=auth_h(passenger["token"]))
        assert rp.status_code == 200

        # Vehicle's driver reads -> 200 (seeded driver is user_demo_driver +919000000001)
        # Use conftest helper which clears OTP window to avoid rate-limit collisions.
        from conftest import otp_login as _otp_login
        drv_login = _otp_login(s, "+919000000001")
        drv_token = drv_login.json()["session_token"]
        rd = s.get(f"{API}/bookings/{bid}", headers=auth_h(drv_token))
        assert rd.status_code == 200


# =========================================================================
# SEC-003: payment mock gating + cancel-after-departure
# =========================================================================
class TestSEC003_Payment:
    def test_gpay_succeeds_when_mock_allowed(self, s):
        u = _login(s, "SEC003 Gpay")
        td = (date.today() + timedelta(days=120 + int(uuid.uuid4().int) % 400)).isoformat()
        seat = (int(uuid.uuid4().int) % 4) + 1
        r = s.post(f"{API}/bookings",
                   json={"vehicle_id": "veh_demo_car_01", "travel_date": td, "seat_numbers": [seat]},
                   headers=auth_h(u["token"]))
        while r.status_code == 409:
            td = (date.today() + timedelta(days=120 + int(uuid.uuid4().int) % 500)).isoformat()
            r = s.post(f"{API}/bookings",
                       json={"vehicle_id": "veh_demo_car_01", "travel_date": td, "seat_numbers": [seat]},
                       headers=auth_h(u["token"]))
        assert r.status_code == 200
        bid = r.json()["booking_id"]
        rp = s.post(f"{API}/bookings/{bid}/pay", json={"method": "gpay"}, headers=auth_h(u["token"]))
        # PAYMENT_MOCK_ALLOWED=true in current .env
        assert rp.status_code == 200
        assert rp.json()["status"] == "paid"

    def test_cancel_after_departure_returns_400(self, s, mongo):
        """Create a booking, force travel_date/status to be in the past, then attempt cancel."""
        u = _login(s, "SEC003 CancelPast")
        # Create in future first (validation blocks past dates on create)
        td = (date.today() + timedelta(days=200 + int(uuid.uuid4().int) % 300)).isoformat()
        seat = (int(uuid.uuid4().int) % 4) + 1
        r = s.post(f"{API}/bookings",
                   json={"vehicle_id": "veh_demo_car_01", "travel_date": td, "seat_numbers": [seat]},
                   headers=auth_h(u["token"]))
        while r.status_code == 409:
            td = (date.today() + timedelta(days=200 + int(uuid.uuid4().int) % 500)).isoformat()
            r = s.post(f"{API}/bookings",
                       json={"vehicle_id": "veh_demo_car_01", "travel_date": td, "seat_numbers": [seat]},
                       headers=auth_h(u["token"]))
        assert r.status_code == 200
        bid = r.json()["booking_id"]
        s.post(f"{API}/bookings/{bid}/pay", json={"method": "gpay"}, headers=auth_h(u["token"]))

        # Force the booking's travel_date into the past to simulate post-departure cancel
        past = (date.today() - timedelta(days=2)).isoformat()
        mongo.bookings.update_one({"booking_id": bid}, {"$set": {"travel_date": past}})

        rc = s.post(f"{API}/bookings/{bid}/cancel", headers=auth_h(u["token"]))
        assert rc.status_code == 400, rc.text
        assert "departure" in rc.text.lower()


# =========================================================================
# SEC-004: withdraw validation + atomicity
# =========================================================================
class TestSEC004_Withdraw:
    def test_negative_amount_422(self, s):
        u = _login(s, "SEC004 Neg")
        r = s.post(f"{API}/wallet/withdraw",
                   json={"amount": -100, "upi_id": "test@upi"},
                   headers=auth_h(u["token"]))
        assert r.status_code == 422

    def test_zero_amount_422(self, s):
        u = _login(s, "SEC004 Zero")
        r = s.post(f"{API}/wallet/withdraw",
                   json={"amount": 0, "upi_id": "test@upi"},
                   headers=auth_h(u["token"]))
        assert r.status_code == 422

    def test_concurrent_withdraws_atomic_only_one_succeeds(self, s, mongo):
        u = _login(s, "SEC004 Race")
        # Seed 100 balance
        mongo.users.update_one({"user_id": u["user"]["user_id"]}, {"$set": {"wallet_balance": 100.0}})

        def _withdraw():
            sess = requests.Session()
            sess.headers.update({"Content-Type": "application/json", "Authorization": f"Bearer {u['token']}"})
            return sess.post(f"{API}/wallet/withdraw", json={"amount": 100, "upi_id": "test@upi"})

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
            results = list(ex.map(lambda _: _withdraw(), range(2)))

        codes = sorted(r.status_code for r in results)
        assert codes == [200, 400], f"expected exactly one 200 and one 400, got {codes} bodies={[r.text for r in results]}"
        # Post-condition: balance is 0 (not negative)
        bal = mongo.users.find_one({"user_id": u["user"]["user_id"]})["wallet_balance"]
        assert bal == 0.0, f"balance leaked negative: {bal}"


# =========================================================================
# SEC-005: upload MIME force + response headers
# =========================================================================
class TestSEC005_Upload:
    def test_html_content_type_forced_to_image(self, s):
        u = _login(s, "SEC005 MIME")
        # A tiny valid-ish JPEG magic bytes payload (SOI marker + junk)
        payload = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00" + b"a" * 200
        files = {"file": ("evil.jpg", io.BytesIO(payload), "text/html")}
        r = requests.post(f"{API}/upload", files=files, headers={"Authorization": f"Bearer {u['token']}"})
        assert r.status_code == 200, r.text
        stored_path = r.json()["path"]
        # Fetch back and check headers
        get_r = requests.get(f"{BASE_URL}/api/files/{stored_path}")
        assert get_r.status_code == 200
        assert get_r.headers.get("X-Content-Type-Options", "").lower() == "nosniff"
        ct = get_r.headers.get("Content-Type", "")
        assert ct.startswith("image/"), f"Content-Type should be image/*, got {ct}"

    def test_large_file_413(self, s):
        u = _login(s, "SEC005 Large")
        big = b"\xff\xd8" + b"x" * (6 * 1024 * 1024)
        files = {"file": ("big.jpg", io.BytesIO(big), "image/jpeg")}
        r = requests.post(f"{API}/upload", files=files, headers={"Authorization": f"Bearer {u['token']}"})
        assert r.status_code == 413, f"expected 413, got {r.status_code} {r.text[:200]}"


# =========================================================================
# Booking input validation
# =========================================================================
class TestBookingValidation:
    def test_duplicate_seats_400(self, s):
        u = _login(s, "Val Dup")
        td = (date.today() + timedelta(days=400)).isoformat()
        r = s.post(f"{API}/bookings",
                   json={"vehicle_id": "veh_demo_car_01", "travel_date": td, "seat_numbers": [1, 1]},
                   headers=auth_h(u["token"]))
        assert r.status_code == 400

    def test_seat_out_of_range_400(self, s):
        u = _login(s, "Val OOR")
        td = (date.today() + timedelta(days=401)).isoformat()
        r = s.post(f"{API}/bookings",
                   json={"vehicle_id": "veh_demo_car_01", "travel_date": td, "seat_numbers": [999]},
                   headers=auth_h(u["token"]))
        assert r.status_code == 400

    def test_past_date_400(self, s):
        u = _login(s, "Val Past")
        past = (date.today() - timedelta(days=1)).isoformat()
        r = s.post(f"{API}/bookings",
                   json={"vehicle_id": "veh_demo_car_01", "travel_date": past, "seat_numbers": [1]},
                   headers=auth_h(u["token"]))
        assert r.status_code == 400

    def test_invalid_date_format_400(self, s):
        u = _login(s, "Val Fmt")
        r = s.post(f"{API}/bookings",
                   json={"vehicle_id": "veh_demo_car_01", "travel_date": "31-12-2027", "seat_numbers": [1]},
                   headers=auth_h(u["token"]))
        assert r.status_code == 400

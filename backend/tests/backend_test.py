"""RideReserve backend API tests."""
import os
import uuid
from datetime import date, timedelta

import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient

from conftest import otp_login  # noqa: E402

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://mobility-reserve-3.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "ride_reserve_db")


# ---------- Fixtures ----------
@pytest.fixture(scope="session")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


@pytest.fixture(scope="session")
def passenger_auth(s):
    phone = f"+9199{uuid.uuid4().int % 10**8:08d}"
    r = otp_login(s, phone, name="TEST Passenger")
    assert r.status_code == 200, r.text
    data = r.json()
    return {"token": data["session_token"], "user": data["user"], "phone": phone}


@pytest.fixture(scope="session")
def driver_auth(s):
    phone = f"+9199{uuid.uuid4().int % 10**8:08d}"
    r = otp_login(s, phone, name="TEST Driver")
    data = r.json()
    token = data["session_token"]
    # switch role
    s.patch(f"{API}/users/me", json={"active_role": "driver"}, headers={"Authorization": f"Bearer {token}"})
    return {"token": token, "user": data["user"], "phone": phone}


@pytest.fixture(scope="session")
def admin_auth(s):
    """Promote a new phone user to admin via direct Mongo write (sync pymongo)."""
    from pymongo import MongoClient
    phone = f"+9199{uuid.uuid4().int % 10**8:08d}"
    r = otp_login(s, phone, name="TEST Admin")
    data = r.json()
    token = data["session_token"]
    uid = data["user"]["user_id"]
    c = MongoClient(MONGO_URL)
    c[DB_NAME].users.update_one({"user_id": uid}, {"$set": {"is_admin": True, "active_role": "admin"}})
    c.close()
    return {"token": token, "user_id": uid}


def auth_h(token):
    return {"Authorization": f"Bearer {token}"}


# ---------- Auth ----------
class TestAuth:
    def test_otp_send(self, s):
        phone = "+919999111222"
        # Clear rate-limit window so rerun is stable
        from pymongo import MongoClient
        MongoClient(MONGO_URL)[DB_NAME].otp_codes.delete_many({"phone": phone})
        r = s.post(f"{API}/auth/otp/send", json={"phone": phone})
        assert r.status_code == 200
        code = r.json().get("dev_code")
        assert code and code.isdigit() and len(code) == 6

    def test_otp_send_returns_new_code_each_time(self, s):
        phone = f"+9199{uuid.uuid4().int % 10**8:08d}"
        r1 = s.post(f"{API}/auth/otp/send", json={"phone": phone})
        r2 = s.post(f"{API}/auth/otp/send", json={"phone": phone})
        assert r1.status_code == 200 and r2.status_code == 200
        # Random 6-digit codes should differ (collision prob 1e-6)
        assert r1.json()["dev_code"] != r2.json()["dev_code"]

    def test_otp_verify_bad_code(self, s):
        phone = f"+9199{uuid.uuid4().int % 10**8:08d}"
        s.post(f"{API}/auth/otp/send", json={"phone": phone})
        r = s.post(f"{API}/auth/otp/verify", json={"phone": phone, "code": "000000"})
        assert r.status_code == 401

    def test_otp_verify_good(self, s):
        phone = "+919999111444"
        from pymongo import MongoClient
        MongoClient(MONGO_URL)[DB_NAME].otp_codes.delete_many({"phone": phone})
        r_send = s.post(f"{API}/auth/otp/send", json={"phone": phone})
        code = r_send.json()["dev_code"]
        r = s.post(f"{API}/auth/otp/verify", json={"phone": phone, "code": code, "name": "T"})
        assert r.status_code == 200
        assert "session_token" in r.json()
        assert r.json()["user"]["phone"] == phone

    def test_auth_me(self, s, passenger_auth):
        r = s.get(f"{API}/auth/me", headers=auth_h(passenger_auth["token"]))
        assert r.status_code == 200
        assert r.json()["user_id"] == passenger_auth["user"]["user_id"]

    def test_auth_me_no_token(self, s):
        r = s.get(f"{API}/auth/me")
        assert r.status_code == 401


# ---------- Profile ----------
class TestProfile:
    def test_update_profile(self, s, passenger_auth):
        r = s.patch(
            f"{API}/users/me",
            json={"name": "TEST Updated", "emergency_contact": "+919000000099", "active_role": "passenger"},
            headers=auth_h(passenger_auth["token"]),
        )
        assert r.status_code == 200
        assert r.json()["name"] == "TEST Updated"
        assert r.json()["emergency_contact"] == "+919000000099"

    def test_non_admin_cannot_switch_admin(self, s, passenger_auth):
        r = s.patch(f"{API}/users/me", json={"active_role": "admin"}, headers=auth_h(passenger_auth["token"]))
        assert r.status_code == 403


# ---------- Vehicles ----------
class TestVehicles:
    def test_search_returns_seeded(self, s):
        r = s.get(f"{API}/vehicles/search")
        assert r.status_code == 200
        items = r.json()
        assert len(items) >= 3
        types = {v["vehicle_type"] for v in items}
        assert {"car", "tempo", "bus"}.issubset(types)

    def test_search_filter_by_type(self, s):
        r = s.get(f"{API}/vehicles/search", params={"vehicle_type": "car"})
        assert r.status_code == 200
        for v in r.json():
            assert v["vehicle_type"] == "car"

    def test_vehicle_seats(self, s):
        travel_date = (date.today() + timedelta(days=1)).isoformat()
        r = s.get(f"{API}/vehicles/veh_demo_car_01/seats", params={"travel_date": travel_date})
        assert r.status_code == 200
        data = r.json()
        assert data["vehicle_id"] == "veh_demo_car_01"
        assert "booked_seats" in data
        assert isinstance(data["booked_seats"], list)

    def test_driver_registers_vehicle(self, s, driver_auth):
        payload = {
            "vehicle_type": "car",
            "model": "TEST Toyota",
            "number_plate": f"TEST{uuid.uuid4().hex[:6].upper()}",
            "total_seats": 4,
            "from_location": "Testville",
            "to_location": "Testburg",
            "fare_per_seat": 300,
            "departure_time": "09:00",
        }
        r = s.post(f"{API}/vehicles", json=payload, headers=auth_h(driver_auth["token"]))
        assert r.status_code == 200
        assert r.json()["status"] == "pending"

        r2 = s.get(f"{API}/vehicles/mine", headers=auth_h(driver_auth["token"]))
        assert r2.status_code == 200
        assert any(v["model"] == "TEST Toyota" for v in r2.json())


# ---------- Bookings ----------
class TestBookings:
    def test_create_pay_and_persist(self, s, passenger_auth):
        travel_date = (date.today() + timedelta(days=5)).isoformat()
        # Car has 4 seats. Pick 2 unique seats within [1..4].
        seats = [1, 2]
        payload = {"vehicle_id": "veh_demo_car_01", "travel_date": travel_date, "seat_numbers": seats}
        r = s.post(f"{API}/bookings", json=payload, headers=auth_h(passenger_auth["token"]))
        if r.status_code == 409:
            # fresh unique date
            travel_date = (date.today() + timedelta(days=365 + (int(uuid.uuid4().int) % 500))).isoformat()
            payload["travel_date"] = travel_date
            r = s.post(f"{API}/bookings", json=payload, headers=auth_h(passenger_auth["token"]))
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["total_amount"] == 450 * 2
        assert b["driver_earning"] == 450.0
        assert b["platform_commission"] == 450.0
        assert b["status"] == "pending"
        bid = b["booking_id"]

        # Driver phone NOT revealed pre-payment
        rg = s.get(f"{API}/bookings/{bid}", headers=auth_h(passenger_auth["token"]))
        assert rg.status_code == 200
        assert rg.json()["vehicle"]["driver_phone"] is None

        # Pay
        rp = s.post(f"{API}/bookings/{bid}/pay", json={"method": "gpay"}, headers=auth_h(passenger_auth["token"]))
        assert rp.status_code == 200
        assert rp.json()["status"] == "paid"

        # Driver phone revealed post-payment
        rg2 = s.get(f"{API}/bookings/{bid}", headers=auth_h(passenger_auth["token"]))
        assert rg2.json()["vehicle"]["driver_phone"] is not None

    def test_seat_conflict(self, s, passenger_auth):
        travel_date = (date.today() + timedelta(days=800 + (int(uuid.uuid4().int) % 500))).isoformat()
        seat = (int(uuid.uuid4().int) % 30) + 1
        p = {"vehicle_id": "veh_demo_bus_01", "travel_date": travel_date, "seat_numbers": [seat]}
        r1 = s.post(f"{API}/bookings", json=p, headers=auth_h(passenger_auth["token"]))
        assert r1.status_code == 200
        bid = r1.json()["booking_id"]
        s.post(f"{API}/bookings/{bid}/pay", json={"method": "gpay"}, headers=auth_h(passenger_auth["token"]))

        # Try again same seat
        r2 = s.post(f"{API}/bookings", json=p, headers=auth_h(passenger_auth["token"]))
        assert r2.status_code == 409

    def test_my_bookings(self, s, passenger_auth):
        r = s.get(f"{API}/bookings/mine", headers=auth_h(passenger_auth["token"]))
        assert r.status_code == 200
        items = r.json()
        assert len(items) >= 1
        assert "vehicle" in items[0]

    def test_bookings_unauth(self, s):
        r = s.get(f"{API}/bookings/mine")
        assert r.status_code == 401


# ---------- Wallet ----------
class TestWallet:
    def test_driver_wallet_after_payment(self, s, demo_driver_token):
        """Seeded demo driver should have wallet balance credited after passenger payments above."""
        token = demo_driver_token
        rw = s.get(f"{API}/wallet/me", headers=auth_h(token))
        assert rw.status_code == 200
        data = rw.json()
        assert "balance" in data
        assert "transactions" in data
        assert data["balance"] >= 450.0  # driver_earning from car booking above

    def test_withdraw_insufficient(self, s, passenger_auth):
        r = s.post(f"{API}/wallet/withdraw", json={"amount": 99999, "upi_id": "test@upi"},
                   headers=auth_h(passenger_auth["token"]))
        assert r.status_code == 400

    def test_withdraw_ok(self, s, demo_driver_token):
        token = demo_driver_token
        # Get current balance
        w = s.get(f"{API}/wallet/me", headers=auth_h(token)).json()
        if w["balance"] >= 100:
            rw = s.post(f"{API}/wallet/withdraw", json={"amount": 100, "upi_id": "test@upi"},
                        headers=auth_h(token))
            assert rw.status_code == 200


# ---------- Driver bookings ----------
class TestDriverBookings:
    def test_driver_list(self, s, demo_driver_token):
        token = demo_driver_token
        rb = s.get(f"{API}/bookings/driver/list", headers=auth_h(token))
        assert rb.status_code == 200
        assert isinstance(rb.json(), list)


# ---------- Admin ----------
class TestAdmin:
    def test_non_admin_forbidden(self, s, passenger_auth):
        r = s.get(f"{API}/admin/stats", headers=auth_h(passenger_auth["token"]))
        assert r.status_code == 403

    def test_admin_stats(self, s, admin_auth):
        r = s.get(f"{API}/admin/stats", headers=auth_h(admin_auth["token"]))
        assert r.status_code == 200
        d = r.json()
        for k in ("total_revenue", "platform_commission", "active_drivers", "total_bookings", "pending_approvals"):
            assert k in d

    def test_admin_pending_and_approve_reject(self, s, admin_auth, driver_auth):
        # driver registers a new vehicle => pending
        payload = {
            "vehicle_type": "tempo",
            "model": "TEST Pending Tempo",
            "number_plate": f"TP{uuid.uuid4().hex[:6].upper()}",
            "total_seats": 10,
            "from_location": "A",
            "to_location": "B",
            "fare_per_seat": 200,
            "departure_time": "10:00",
        }
        rv = s.post(f"{API}/vehicles", json=payload, headers=auth_h(driver_auth["token"]))
        vid = rv.json()["vehicle_id"]

        rp = s.get(f"{API}/admin/vehicles/pending", headers=auth_h(admin_auth["token"]))
        assert rp.status_code == 200
        assert any(v["vehicle_id"] == vid for v in rp.json())

        ra = s.post(f"{API}/admin/vehicles/{vid}/approve", headers=auth_h(admin_auth["token"]))
        assert ra.status_code == 200

        # create another and reject
        payload["number_plate"] = f"TR{uuid.uuid4().hex[:6].upper()}"
        rv2 = s.post(f"{API}/vehicles", json=payload, headers=auth_h(driver_auth["token"]))
        vid2 = rv2.json()["vehicle_id"]
        rr = s.post(f"{API}/admin/vehicles/{vid2}/reject", headers=auth_h(admin_auth["token"]))
        assert rr.status_code == 200

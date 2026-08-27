"""RideReserve backend tests for v3 features:
- Verified Driver Badge (5+ five-star reviews across driver's vehicles)
- Cancel Booking endpoint (owner-only, seat release, refund, idempotency)
- Perf: /vehicles/search aggregation returning seats_available (correctness + latency)
- Regression: OTP auth, seat 409 conflict, payment 50/50 split, review creation, referral apply, admin approvals, /config, /geocode
"""
import os
import time
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


def _login_new(sess, name="TEST V3 User"):
    phone = f"+9197{uuid.uuid4().int % 10**8:08d}"
    rs = sess.post(f"{API}/auth/otp/send", json={"phone": phone})
    assert rs.status_code == 200, rs.text
    code = rs.json()["dev_code"]
    r = sess.post(f"{API}/auth/otp/verify", json={"phone": phone, "code": code, "name": name})
    assert r.status_code == 200, r.text
    d = r.json()
    return {"token": d["session_token"], "user": d["user"], "phone": phone}


def _future_date(offset_days=None):
    if offset_days is None:
        offset_days = 200 + int(uuid.uuid4().int) % 800
    return (date.today() + timedelta(days=offset_days)).isoformat()


def _book(sess, token, vehicle_id, travel_date, seats):
    return sess.post(
        f"{API}/bookings",
        json={"vehicle_id": vehicle_id, "travel_date": travel_date, "seat_numbers": seats},
        headers=auth_h(token),
    )


def _book_and_pay(sess, token, vehicle_id, travel_date=None, seats=None, method="gpay"):
    if travel_date is None:
        travel_date = _future_date()
    if seats is None:
        # Keep within car's 4-seat cap (also safe for tempo/bus).
        seats = [(int(uuid.uuid4().int) % 4) + 1]
    r = _book(sess, token, vehicle_id, travel_date, seats)
    tries = 0
    while r.status_code == 409 and tries < 5:
        travel_date = _future_date()
        seats = [(int(uuid.uuid4().int) % 4) + 1]
        r = _book(sess, token, vehicle_id, travel_date, seats)
        tries += 1
    assert r.status_code == 200, r.text
    bid = r.json()["booking_id"]
    rp = sess.post(f"{API}/bookings/{bid}/pay", json={"method": method}, headers=auth_h(token))
    assert rp.status_code == 200, rp.text
    return bid, travel_date, seats, rp.json()


@pytest.fixture(scope="session")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


@pytest.fixture(scope="session")
def mongo():
    c = MongoClient(MONGO_URL)
    return c[DB_NAME]


# ---------- Verified Driver Badge ----------
class TestVerifiedDriverBadge:
    def _create_driver_with_two_vehicles(self, s, mongo, tag):
        """Create a fresh driver + 2 approved vehicles owned by them."""
        driver = _login_new(s, f"TEST DriverBadge {tag}")
        # Register 2 vehicles (they will be 'pending'); mark approved directly in DB.
        veh_ids = []
        for i, (vtype, seats) in enumerate([("car", 4), ("tempo", 12)]):
            r = s.post(
                f"{API}/vehicles",
                json={
                    "vehicle_type": vtype,
                    "model": f"TESTV3 {tag} {i}",
                    "number_plate": f"TS{tag}{i}{uuid.uuid4().hex[:4].upper()}",
                    "total_seats": seats,
                    "from_location": "Bangalore",
                    "to_location": "Mysore",
                    "fare_per_seat": 300 + i,
                    "departure_time": "08:00",
                },
                headers=auth_h(driver["token"]),
            )
            assert r.status_code == 200, r.text
            vid = r.json()["vehicle_id"]
            mongo.vehicles.update_one({"vehicle_id": vid}, {"$set": {"status": "approved"}})
            veh_ids.append(vid)
        return driver, veh_ids

    def _leave_review(self, s, mongo, vehicle_id, stars=5):
        """Create a new passenger, book+pay a unique seat/date, and post a review."""
        passenger = _login_new(s, "TEST BadgeReviewer")
        # Use a far-out unique date to avoid collisions
        td = _future_date(1500 + int(uuid.uuid4().int) % 5000)
        seat = (int(uuid.uuid4().int) % 4) + 1
        # Book (retry with new date if collision)
        r = _book(s, passenger["token"], vehicle_id, td, [seat])
        while r.status_code == 409:
            td = _future_date(1500 + int(uuid.uuid4().int) % 5000)
            r = _book(s, passenger["token"], vehicle_id, td, [seat])
        assert r.status_code == 200, r.text
        bid = r.json()["booking_id"]
        rp = s.post(f"{API}/bookings/{bid}/pay", json={"method": "gpay"}, headers=auth_h(passenger["token"]))
        assert rp.status_code == 200
        rr = s.post(f"{API}/reviews", json={"booking_id": bid, "stars": stars}, headers=auth_h(passenger["token"]))
        assert rr.status_code == 200, rr.text

    def test_badge_flips_at_5_five_stars_across_vehicles(self, s, mongo):
        driver, veh_ids = self._create_driver_with_two_vehicles(s, mongo, "A")
        v1, v2 = veh_ids

        # 4 five-star reviews split across both vehicles -> below threshold
        self._leave_review(s, mongo, v1, 5)
        self._leave_review(s, mongo, v1, 5)
        self._leave_review(s, mongo, v2, 5)
        self._leave_review(s, mongo, v2, 5)

        for vid in veh_ids:
            r = s.get(f"{API}/vehicles/{vid}")
            assert r.status_code == 200
            d = r.json()
            # Below 5 => driver_verified should be false or missing
            assert not d.get("driver_verified", False), f"veh {vid} should NOT be verified at 4 stars: {d}"
            assert d.get("driver_five_star_count", 0) == 4

        # 5th five-star review on second vehicle -> should verify
        self._leave_review(s, mongo, v2, 5)

        for vid in veh_ids:
            r = s.get(f"{API}/vehicles/{vid}")
            assert r.status_code == 200
            d = r.json()
            assert d.get("driver_verified") is True, f"veh {vid} MUST be verified after 5 five-star reviews: {d}"
            assert d.get("driver_five_star_count", 0) >= 5

        # Also assert /vehicles/search includes flag for approved vehicles
        r = s.get(f"{API}/vehicles/search", params={"from": "Bangalore", "to": "Mysore"})
        assert r.status_code == 200
        found = [v for v in r.json() if v["vehicle_id"] in veh_ids]
        assert found, "search should return the driver's approved vehicles"
        for v in found:
            assert v.get("driver_verified") is True
            assert v.get("driver_five_star_count", 0) >= 5

    def test_reviews_on_other_drivers_do_not_verify(self, s, mongo):
        driverA, vidsA = self._create_driver_with_two_vehicles(s, mongo, "B")
        driverB, vidsB = self._create_driver_with_two_vehicles(s, mongo, "C")
        # 5 five-star reviews for driverB's vehicles
        for _ in range(5):
            self._leave_review(s, mongo, vidsB[0], 5)
        # driverA should NOT be verified
        for vid in vidsA:
            r = s.get(f"{API}/vehicles/{vid}")
            assert r.status_code == 200
            d = r.json()
            assert not d.get("driver_verified", False), f"driverA veh {vid} must NOT be verified: {d}"
        # driverB should be verified
        r = s.get(f"{API}/vehicles/{vidsB[0]}")
        assert r.json().get("driver_verified") is True

    def test_low_stars_do_not_count(self, s, mongo):
        driver, veh_ids = self._create_driver_with_two_vehicles(s, mongo, "D")
        # 5 four-star reviews -> should NOT verify
        for _ in range(5):
            self._leave_review(s, mongo, veh_ids[0], 4)
        r = s.get(f"{API}/vehicles/{veh_ids[0]}")
        d = r.json()
        assert not d.get("driver_verified", False)
        assert d.get("driver_five_star_count", 0) == 0


# ---------- Cancel Booking ----------
class TestCancelBooking:
    def test_cancel_paid_booking_refunds_and_releases_seats(self, s, mongo):
        # Fresh driver + vehicle to isolate wallet math
        driver = _login_new(s, "TEST CancelDriver")
        r = s.post(
            f"{API}/vehicles",
            json={
                "vehicle_type": "car", "model": "TESTV3 Cancel", "number_plate": f"CNCL{uuid.uuid4().hex[:6].upper()}",
                "total_seats": 4, "from_location": "Bangalore", "to_location": "Mysore",
                "fare_per_seat": 500, "departure_time": "09:00",
            },
            headers=auth_h(driver["token"]),
        )
        assert r.status_code == 200
        vid = r.json()["vehicle_id"]
        mongo.vehicles.update_one({"vehicle_id": vid}, {"$set": {"status": "approved"}})

        passenger = _login_new(s, "TEST CancelPassenger")
        td = _future_date()
        seats = [2, 3]
        br = _book(s, passenger["token"], vid, td, seats)
        assert br.status_code == 200, br.text
        bid = br.json()["booking_id"]
        rp = s.post(f"{API}/bookings/{bid}/pay", json={"method": "gpay"}, headers=auth_h(passenger["token"]))
        assert rp.status_code == 200 and rp.json()["status"] == "paid"

        # Driver wallet before cancel
        driver_uid = driver["user"]["user_id"]
        wallet_pre = mongo.users.find_one({"user_id": driver_uid}, {"_id": 0, "wallet_balance": 1})["wallet_balance"]
        # Expected driver earning = 500*2 * 0.5 = 500
        expected_earning = round(500 * 2 * 0.5, 2)

        # Confirm seats booked shows the seats
        rs = s.get(f"{API}/vehicles/{vid}/seats", params={"travel_date": td})
        assert rs.status_code == 200
        assert set(seats).issubset(set(rs.json()["booked_seats"]))

        # Cancel
        rc = s.post(f"{API}/bookings/{bid}/cancel", headers=auth_h(passenger["token"]))
        assert rc.status_code == 200, rc.text
        assert rc.json()["status"] == "cancelled"

        # Seats released
        rs2 = s.get(f"{API}/vehicles/{vid}/seats", params={"travel_date": td})
        assert rs2.status_code == 200
        for sn in seats:
            assert sn not in rs2.json()["booked_seats"], f"seat {sn} should be released after cancel"

        # Driver wallet decremented by earning
        wallet_post = mongo.users.find_one({"user_id": driver_uid}, {"_id": 0, "wallet_balance": 1})["wallet_balance"]
        assert round(wallet_pre - wallet_post, 2) == expected_earning, f"wallet delta {wallet_pre-wallet_post} != {expected_earning}"

        # Negative/debit transaction recorded for the driver referencing booking
        txn = mongo.transactions.find_one({"user_id": driver_uid, "booking_id": bid, "type": "debit"})
        assert txn is not None, "expected a debit transaction for the refund"
        assert round(float(txn["amount"]), 2) == expected_earning

    def test_cancel_idempotent(self, s, mongo):
        passenger = _login_new(s, "TEST CancelIdem")
        bid, td, seats, _ = _book_and_pay(s, passenger["token"], "veh_demo_bus_01")
        r1 = s.post(f"{API}/bookings/{bid}/cancel", headers=auth_h(passenger["token"]))
        assert r1.status_code == 200
        assert r1.json()["status"] == "cancelled"
        r2 = s.post(f"{API}/bookings/{bid}/cancel", headers=auth_h(passenger["token"]))
        assert r2.status_code == 200
        assert r2.json()["status"] == "cancelled"
        # 2nd cancel should NOT create a second debit txn for the same booking
        driver_id = "user_demo_driver"
        debits = list(mongo.transactions.find({"user_id": driver_id, "booking_id": bid, "type": "debit"}))
        assert len(debits) == 1, f"expected exactly 1 debit txn, got {len(debits)}"

    def test_cancel_by_non_owner_returns_404(self, s):
        owner = _login_new(s, "TEST CancelOwner")
        bid, _, _, _ = _book_and_pay(s, owner["token"], "veh_demo_tempo_01")
        stranger = _login_new(s, "TEST CancelStranger")
        r = s.post(f"{API}/bookings/{bid}/cancel", headers=auth_h(stranger["token"]))
        assert r.status_code == 404

    def test_cancel_unpaid_booking_no_refund(self, s, mongo):
        passenger = _login_new(s, "TEST CancelUnpaid")
        td = _future_date()
        seats = [(int(uuid.uuid4().int) % 4) + 1]
        r = _book(s, passenger["token"], "veh_demo_car_01", td, seats)
        while r.status_code == 409:
            td = _future_date()
            r = _book(s, passenger["token"], "veh_demo_car_01", td, seats)
        assert r.status_code == 200
        bid = r.json()["booking_id"]
        # DO NOT pay. Cancel directly.
        rc = s.post(f"{API}/bookings/{bid}/cancel", headers=auth_h(passenger["token"]))
        assert rc.status_code == 200
        assert rc.json()["status"] == "cancelled"
        # No debit txn should exist for this booking
        assert mongo.transactions.find_one({"booking_id": bid, "type": "debit"}) is None


# ---------- Perf / Aggregation-based search ----------
class TestVehicleSearchAggregation:
    def test_search_returns_seats_available_no_bookings(self, s):
        r = s.get(f"{API}/vehicles/search", params={"from": "Bangalore", "to": "Mysore", "travel_date": _future_date(9000)})
        assert r.status_code == 200
        items = r.json()
        assert len(items) >= 1
        for v in items:
            assert "seats_available" in v
            assert v["seats_available"] == v["total_seats"]

    def test_search_seats_available_after_bookings(self, s):
        vid = "veh_demo_car_01"
        # Pick a totally fresh travel_date
        td = _future_date(8000 + int(uuid.uuid4().int) % 500)
        passenger = _login_new(s, "TEST AggSearch")
        # Book 2 of 4 seats
        r = _book(s, passenger["token"], vid, td, [1, 2])
        while r.status_code == 409:
            td = _future_date(8000 + int(uuid.uuid4().int) % 500)
            r = _book(s, passenger["token"], vid, td, [1, 2])
        assert r.status_code == 200
        bid = r.json()["booking_id"]
        rp = s.post(f"{API}/bookings/{bid}/pay", json={"method": "gpay"}, headers=auth_h(passenger["token"]))
        assert rp.status_code == 200

        # Search for the same date
        rs = s.get(f"{API}/vehicles/search", params={"from": "Bangalore", "to": "Mysore", "travel_date": td})
        assert rs.status_code == 200
        matches = [v for v in rs.json() if v["vehicle_id"] == vid]
        assert matches, "expected demo car in search results"
        v = matches[0]
        assert v["seats_available"] == v["total_seats"] - 2

        # Different date -> full seats available
        rs2 = s.get(f"{API}/vehicles/search", params={"from": "Bangalore", "to": "Mysore", "travel_date": _future_date(20000)})
        m2 = [v for v in rs2.json() if v["vehicle_id"] == vid]
        assert m2 and m2[0]["seats_available"] == m2[0]["total_seats"]

    def test_search_latency(self, s):
        t0 = time.perf_counter()
        r = s.get(f"{API}/vehicles/search", params={"from": "Bangalore", "travel_date": _future_date(9500)})
        elapsed_ms = (time.perf_counter() - t0) * 1000
        assert r.status_code == 200
        # Not strict (network overhead varies), but should be well under 1s.
        # Spec requests <100ms internally; over public preview URL we allow generous headroom.
        assert elapsed_ms < 2000, f"search took {elapsed_ms:.0f}ms"
        print(f"search latency: {elapsed_ms:.0f}ms")


# ---------- Regression ----------
class TestRegression:
    def test_otp_auth(self, s):
        u = _login_new(s, "TEST RegOTP")
        me = s.get(f"{API}/auth/me", headers=auth_h(u["token"]))
        assert me.status_code == 200
        assert me.json()["user_id"] == u["user"]["user_id"]

    def test_seat_conflict_409(self, s):
        vid = "veh_demo_car_01"
        td = _future_date(30000 + int(uuid.uuid4().int) % 500)
        seat = (int(uuid.uuid4().int) % 4) + 1
        u1 = _login_new(s, "TEST Reg409A")
        u2 = _login_new(s, "TEST Reg409B")
        r1 = _book(s, u1["token"], vid, td, [seat])
        while r1.status_code == 409:
            td = _future_date(30000 + int(uuid.uuid4().int) % 500)
            r1 = _book(s, u1["token"], vid, td, [seat])
        assert r1.status_code == 200
        bid = r1.json()["booking_id"]
        pay = s.post(f"{API}/bookings/{bid}/pay", json={"method": "gpay"}, headers=auth_h(u1["token"]))
        assert pay.status_code == 200
        r2 = _book(s, u2["token"], vid, td, [seat])
        assert r2.status_code == 409

    def test_payment_50_50_split(self, s, mongo):
        driver_id = "user_demo_driver"
        before = mongo.users.find_one({"user_id": driver_id}, {"_id": 0, "wallet_balance": 1})["wallet_balance"]
        u = _login_new(s, "TEST Reg5050")
        bid, td, seats, _ = _book_and_pay(s, u["token"], "veh_demo_car_01", seats=[(int(uuid.uuid4().int) % 4) + 1])
        # fare 450 per seat, 1 seat -> 450 total, 50% driver = 225
        after = mongo.users.find_one({"user_id": driver_id}, {"_id": 0, "wallet_balance": 1})["wallet_balance"]
        assert round(after - before, 2) == 225.0, f"expected +225, got {after-before}"

    def test_review_creation(self, s):
        u = _login_new(s, "TEST RegReview")
        bid, _, _, _ = _book_and_pay(s, u["token"], "veh_demo_tempo_01")
        r = s.post(f"{API}/reviews", json={"booking_id": bid, "stars": 4, "comment": "ok"}, headers=auth_h(u["token"]))
        assert r.status_code == 200

    def test_referral_apply(self, s):
        a = _login_new(s, "TEST RegRefA")
        b = _login_new(s, "TEST RegRefB")
        code_a = s.get(f"{API}/referrals/me", headers=auth_h(a["token"])).json()["referral_code"]
        r = s.post(f"{API}/referrals/apply", json={"code": code_a}, headers=auth_h(b["token"]))
        assert r.status_code == 200

    def test_admin_approvals(self, s, mongo):
        # Promote a fresh user to admin via DB (per playbook)
        u = _login_new(s, "TEST RegAdmin")
        mongo.users.update_one({"user_id": u["user"]["user_id"]}, {"$set": {"is_admin": True, "active_role": "admin"}})
        # Create a pending vehicle owned by another driver
        driver = _login_new(s, "TEST RegAdminDriver")
        r = s.post(
            f"{API}/vehicles",
            json={
                "vehicle_type": "car", "model": "REG Admin", "number_plate": f"RGA{uuid.uuid4().hex[:6].upper()}",
                "total_seats": 4, "from_location": "Bangalore", "to_location": "Mysore",
                "fare_per_seat": 100, "departure_time": "10:00",
            },
            headers=auth_h(driver["token"]),
        )
        assert r.status_code == 200
        vid = r.json()["vehicle_id"]
        # Admin approves
        ra = s.post(f"{API}/admin/vehicles/{vid}/approve", headers=auth_h(u["token"]))
        assert ra.status_code == 200
        rv = s.get(f"{API}/vehicles/{vid}")
        assert rv.json()["status"] == "approved"

    def test_config_and_geocode(self, s):
        c = s.get(f"{API}/config")
        assert c.status_code == 200 and "razorpay_enabled" in c.json()
        g = s.get(f"{API}/geocode", params={"q": "Bangalore"})
        assert g.status_code == 200 and "lat" in g.json()

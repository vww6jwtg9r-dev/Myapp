"""RideReserve backend tests for follow-up features (config, geocode, reviews, referrals, razorpay fallback)."""
import os
import uuid
from datetime import date, timedelta

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://mobility-reserve-3.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


def auth_h(token):
    return {"Authorization": f"Bearer {token}"}


def _login_new(sess, name="TEST User"):
    phone = f"+9198{uuid.uuid4().int % 10**8:08d}"
    rs = sess.post(f"{API}/auth/otp/send", json={"phone": phone})
    assert rs.status_code == 200, rs.text
    code = rs.json()["dev_code"]
    r = sess.post(f"{API}/auth/otp/verify", json={"phone": phone, "code": code, "name": name})
    assert r.status_code == 200, r.text
    d = r.json()
    return {"token": d["session_token"], "user": d["user"], "phone": phone}


def _book_and_pay(sess, token, vehicle_id="veh_demo_car_01", travel_date=None, seats=None, method="gpay"):
    if travel_date is None:
        travel_date = (date.today() + timedelta(days=30 + int(uuid.uuid4().int % 100))).isoformat()
    if seats is None:
        seats = [(int(uuid.uuid4().int) % 4) + 1]
    r = sess.post(
        f"{API}/bookings",
        json={"vehicle_id": vehicle_id, "travel_date": travel_date, "seat_numbers": seats},
        headers=auth_h(token),
    )
    # Retry once with a different date if unlucky seat collision
    if r.status_code == 409:
        travel_date2 = (date.today() + timedelta(days=1000 + int(uuid.uuid4().int) % 500)).isoformat()
        r = sess.post(
            f"{API}/bookings",
            json={"vehicle_id": vehicle_id, "travel_date": travel_date2, "seat_numbers": seats},
            headers=auth_h(token),
        )
    assert r.status_code == 200, r.text
    bid = r.json()["booking_id"]
    rp = sess.post(f"{API}/bookings/{bid}/pay", json={"method": method}, headers=auth_h(token))
    return bid, rp


@pytest.fixture(scope="session")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


# ---------- Config ----------
class TestConfig:
    def test_config_shape(self, s):
        r = s.get(f"{API}/config")
        assert r.status_code == 200
        d = r.json()
        assert "razorpay_enabled" in d
        assert isinstance(d["razorpay_enabled"], bool)
        # Keys blank in .env => should be False
        assert d["razorpay_enabled"] is False
        assert "referral_bonus" in d
        assert float(d["referral_bonus"]) == 50.0


# ---------- Geocode ----------
class TestGeocode:
    def test_geocode_known(self, s):
        r = s.get(f"{API}/geocode", params={"q": "Bangalore"})
        assert r.status_code == 200
        d = r.json()
        assert "lat" in d and "lon" in d
        assert abs(d["lat"] - 12.9716) < 0.01
        assert abs(d["lon"] - 77.5946) < 0.01

    def test_geocode_case_insensitive(self, s):
        r = s.get(f"{API}/geocode", params={"q": "MYSORE"})
        assert r.status_code == 200
        assert abs(r.json()["lat"] - 12.2958) < 0.01

    def test_geocode_unknown_404(self, s):
        r = s.get(f"{API}/geocode", params={"q": "ZzzUnknownCityXyz"})
        assert r.status_code == 404


# ---------- Reviews ----------
class TestReviews:
    def test_review_flow_two_users_avg(self, s):
        # Two independent users, each book+pay same vehicle on different dates, then review with different stars.
        u1 = _login_new(s, "TEST Reviewer1")
        u2 = _login_new(s, "TEST Reviewer2")

        vid = "veh_demo_tempo_01"
        bid1, rp1 = _book_and_pay(s, u1["token"], vehicle_id=vid, seats=[11])
        assert rp1.status_code == 200 and rp1.json()["status"] == "paid"
        bid2, rp2 = _book_and_pay(s, u2["token"], vehicle_id=vid, seats=[12])
        assert rp2.status_code == 200 and rp2.json()["status"] == "paid"

        rr1 = s.post(f"{API}/reviews", json={"booking_id": bid1, "stars": 5, "comment": "Great"}, headers=auth_h(u1["token"]))
        assert rr1.status_code == 200, rr1.text
        rr2 = s.post(f"{API}/reviews", json={"booking_id": bid2, "stars": 3, "comment": "Okay"}, headers=auth_h(u2["token"]))
        assert rr2.status_code == 200

        # Duplicate should 409
        rdup = s.post(f"{API}/reviews", json={"booking_id": bid1, "stars": 4}, headers=auth_h(u1["token"]))
        assert rdup.status_code == 409

        # Vehicle rating recomputed as avg (contains 5 and 3 from these two, could include prior reviews too)
        rv = s.get(f"{API}/vehicles/{vid}")
        assert rv.status_code == 200
        rating = rv.json()["rating"]
        assert 1.0 <= rating <= 5.0

        # Vehicle reviews list contains both
        rvr = s.get(f"{API}/reviews/vehicle/{vid}")
        assert rvr.status_code == 200
        ids = {rev["booking_id"] for rev in rvr.json()}
        assert bid1 in ids and bid2 in ids

        # /reviews/mine
        rmine = s.get(f"{API}/reviews/mine", headers=auth_h(u1["token"]))
        assert rmine.status_code == 200
        assert any(r["booking_id"] == bid1 for r in rmine.json())

    def test_review_only_paid_booking(self, s):
        u = _login_new(s, "TEST NotPaidReviewer")
        travel_date = (date.today() + timedelta(days=45)).isoformat()
        r = s.post(
            f"{API}/bookings",
            json={"vehicle_id": "veh_demo_car_01", "travel_date": travel_date, "seat_numbers": [3]},
            headers=auth_h(u["token"]),
        )
        assert r.status_code == 200
        bid = r.json()["booking_id"]
        # Do NOT pay. Review must be rejected with 400.
        rr = s.post(f"{API}/reviews", json={"booking_id": bid, "stars": 4}, headers=auth_h(u["token"]))
        assert rr.status_code == 400

    def test_review_not_owner(self, s):
        u1 = _login_new(s, "TEST Owner")
        u2 = _login_new(s, "TEST Stranger")
        bid, rp = _book_and_pay(s, u1["token"], vehicle_id="veh_demo_bus_01", seats=[21])
        assert rp.status_code == 200
        # Stranger tries to review u1's booking
        rr = s.post(f"{API}/reviews", json={"booking_id": bid, "stars": 5}, headers=auth_h(u2["token"]))
        assert rr.status_code == 404


# ---------- Referrals ----------
class TestReferrals:
    def test_referral_me_shape(self, s):
        u = _login_new(s, "TEST RefMe")
        r = s.get(f"{API}/referrals/me", headers=auth_h(u["token"]))
        assert r.status_code == 200
        d = r.json()
        assert d["referral_code"].startswith("RR") and len(d["referral_code"]) >= 6
        assert d["invited"] == 0
        assert d["earned"] == 0.0
        assert float(d["bonus"]) == 50.0

    def test_apply_own_code_400(self, s):
        u = _login_new(s, "TEST OwnCode")
        me = s.get(f"{API}/referrals/me", headers=auth_h(u["token"])).json()
        r = s.post(f"{API}/referrals/apply", json={"code": me["referral_code"]}, headers=auth_h(u["token"]))
        assert r.status_code == 400

    def test_apply_invalid_code_404(self, s):
        u = _login_new(s, "TEST InvalidCode")
        r = s.post(f"{API}/referrals/apply", json={"code": "RRZZZZZZ"}, headers=auth_h(u["token"]))
        assert r.status_code == 404

    def test_apply_twice_409(self, s):
        a = _login_new(s, "TEST RefA_twice")
        b = _login_new(s, "TEST RefB_twice")
        code_a = s.get(f"{API}/referrals/me", headers=auth_h(a["token"])).json()["referral_code"]
        r1 = s.post(f"{API}/referrals/apply", json={"code": code_a}, headers=auth_h(b["token"]))
        assert r1.status_code == 200
        r2 = s.post(f"{API}/referrals/apply", json={"code": code_a}, headers=auth_h(b["token"]))
        assert r2.status_code == 409

    def test_referral_bonus_credited_first_paid_only(self, s):
        a = _login_new(s, "TEST RefA_bonus")
        b = _login_new(s, "TEST RefB_bonus")
        code_a = s.get(f"{API}/referrals/me", headers=auth_h(a["token"])).json()["referral_code"]
        assert s.post(f"{API}/referrals/apply", json={"code": code_a}, headers=auth_h(b["token"])).status_code == 200

        # baseline wallet balances
        wa0 = s.get(f"{API}/wallet/me", headers=auth_h(a["token"])).json()["balance"]
        wb0 = s.get(f"{API}/wallet/me", headers=auth_h(b["token"])).json()["balance"]

        # B books + pays first ride
        bid1, rp1 = _book_and_pay(s, b["token"], vehicle_id="veh_demo_car_01")
        assert rp1.status_code == 200, rp1.text

        wa1 = s.get(f"{API}/wallet/me", headers=auth_h(a["token"])).json()["balance"]
        wb1 = s.get(f"{API}/wallet/me", headers=auth_h(b["token"])).json()["balance"]

        assert round(wa1 - wa0, 2) == 50.0, f"referrer A should be +50 (got {wa1-wa0})"
        assert round(wb1 - wb0, 2) == 50.0, f"referee B should be +50 (got {wb1-wb0})"

        # referral_paid flipped
        me_b = s.get(f"{API}/referrals/me", headers=auth_h(b["token"])).json()
        # earned should include bonus for A too
        me_a = s.get(f"{API}/referrals/me", headers=auth_h(a["token"])).json()
        assert me_a["earned"] >= 50.0
        assert me_a["invited"] >= 1

        # B's 2nd paid booking should NOT credit again
        bid2, rp2 = _book_and_pay(s, b["token"], vehicle_id="veh_demo_car_01")
        assert rp2.status_code == 200
        wa2 = s.get(f"{API}/wallet/me", headers=auth_h(a["token"])).json()["balance"]
        wb2 = s.get(f"{API}/wallet/me", headers=auth_h(b["token"])).json()["balance"]
        assert round(wa2 - wa1, 2) == 0.0, "referrer A must NOT be credited again"
        # B gets no referral bonus again (only driver earning goes to driver, not passenger)
        assert round(wb2 - wb1, 2) == 0.0, "referee B must NOT be credited referral again"


# ---------- Razorpay fallback ----------
class TestRazorpayFallback:
    def test_pay_razorpay_falls_back_to_mock_when_disabled(self, s):
        """With RAZORPAY_KEY_ID/SECRET blank, method='razorpay' should fall through to mock fulfilment."""
        u = _login_new(s, "TEST RzpFallback")
        # Use a fresh future date each run to avoid seat collisions across suite reruns
        travel_date = (date.today() + timedelta(days=60 + int(uuid.uuid4().int) % 3000)).isoformat()
        seat = (int(uuid.uuid4().int) % 28) + 1  # bus has 32 seats
        r = s.post(
            f"{API}/bookings",
            json={"vehicle_id": "veh_demo_bus_01", "travel_date": travel_date, "seat_numbers": [seat]},
            headers=auth_h(u["token"]),
        )
        # Retry with a new date+seat combo on collision (bounded)
        tries = 0
        while r.status_code == 409 and tries < 5:
            travel_date = (date.today() + timedelta(days=60 + int(uuid.uuid4().int) % 3000)).isoformat()
            seat = (int(uuid.uuid4().int) % 28) + 1
            r = s.post(
                f"{API}/bookings",
                json={"vehicle_id": "veh_demo_bus_01", "travel_date": travel_date, "seat_numbers": [seat]},
                headers=auth_h(u["token"]),
            )
            tries += 1
        assert r.status_code == 200, r.text
        bid = r.json()["booking_id"]
        rp = s.post(f"{API}/bookings/{bid}/pay", json={"method": "razorpay"}, headers=auth_h(u["token"]))
        # Backend design: when RAZORPAY_ENABLED is False, code falls through to _fulfill_paid_booking(mock).
        assert rp.status_code == 200, rp.text
        body = rp.json()
        assert body.get("status") == "paid", f"expected paid, got {body}"

    def test_verify_payment_400_when_disabled(self, s):
        u = _login_new(s, "TEST RzpVerify")
        r = s.post(
            f"{API}/bookings/verify-payment",
            json={
                "booking_id": "bk_dummy",
                "razorpay_order_id": "order_x",
                "razorpay_payment_id": "pay_x",
                "razorpay_signature": "sig_x",
            },
            headers=auth_h(u["token"]),
        )
        assert r.status_code == 400
        assert "not configured" in r.text.lower()

    def test_pay_gpay_still_works(self, s):
        u = _login_new(s, "TEST GpayStill")
        bid, rp = _book_and_pay(s, u["token"], vehicle_id="veh_demo_car_01", seats=[4], method="gpay")
        assert rp.status_code == 200
        assert rp.json()["status"] == "paid"

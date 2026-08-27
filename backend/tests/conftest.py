"""Shared helpers for tests. Provides dynamic OTP login (post-SEC-001)."""
import os
import time

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://mobility-reserve-3.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "ride_reserve_db")


def _clear_otp_window(phone: str):
    """Best-effort: drop recent OTP send records so rate-limit does not trip in tests."""
    try:
        MongoClient(MONGO_URL)[DB_NAME].otp_codes.delete_many({"phone": phone})
    except Exception:
        pass


def otp_login(sess, phone: str, name: str = "TEST User"):
    """Send OTP, read dev_code, verify. Returns verify response object.
    Clears the per-phone OTP send window first to keep the test suite stable.
    """
    _clear_otp_window(phone)
    r = sess.post(f"{API}/auth/otp/send", json={"phone": phone})
    if r.status_code == 429:
        # Second-chance: hard-clear then retry once
        _clear_otp_window(phone)
        time.sleep(0.2)
        r = sess.post(f"{API}/auth/otp/send", json={"phone": phone})
    assert r.status_code == 200, f"otp/send failed: {r.status_code} {r.text}"
    code = r.json().get("dev_code")
    assert code, f"dev_code missing (OTP_DEV_MODE must be true). resp={r.json()}"
    body = {"phone": phone, "code": code}
    if name:
        body["name"] = name
    return sess.post(f"{API}/auth/otp/verify", json=body)


@pytest.fixture(scope="session")
def demo_driver_token():
    """One-shot login for the seeded demo driver (+919000000001) reused across tests."""
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    r = otp_login(sess, "+919000000001")
    assert r.status_code == 200, r.text
    return r.json()["session_token"]

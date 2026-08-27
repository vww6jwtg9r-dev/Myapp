# RideReserve — Product Requirements

Mobile-first Vehicle Seat Reservation & Ride Sharing platform (Cars, Tempos, Buses) with dual roles, 50/50 commission split, QR ticketing, ratings, referrals, verified drivers, trip reminders, and route maps.

## Tech
- Expo Router SDK 54, TypeScript, safe-area-context, expo-image-picker, react-native-qrcode-svg, react-native-webview, Leaflet + OpenStreetMap
- FastAPI + MongoDB (motor), razorpay SDK
- Auth: Emergent Managed Google + Phone OTP (mocked — OTP = `123456`)
- Uploads: Emergent Managed Object Storage
- Payments: Razorpay (test mode) with mocked GPay/PhonePe fallback

## Feature Set (latest)
- Login + Onboarding, Home search + filter chips
- Vehicle detail with **Route Preview (OSM)** + **Verified Driver shield** + Reviews list
- Interactive seat grid (Car 4 / Tempo 12 / Bus 32)
- Checkout: Razorpay WebView OR mocked GPay/PhonePe/UPI
- Digital QR ticket + Call Driver
- **My Bookings with Upcoming/Completed/Cancelled tabs, per-status counters, Pay Now for pending, Cancel with refund**
- **In-app Trip Reminder banner on Home when a paid ride is < 60 min from departure**
- Rate trip (1–5 stars + optional comment) — auto-updates avg rating and driver verified badge
- Refer & Earn: `RR-XXXXXX` code, share sheet, apply code, ₹50 to each after referee's first paid ride
- Wallet/Earnings + UPI withdraw
- Profile with role switch (Passenger / Driver / Admin)
- Driver: Register vehicle + list; Admin: revenue, approvals

## Performance
- `/vehicles/search` uses a single aggregation for seat availability (was N+1)
- `/bookings/mine` and `/bookings/driver/list` batch vehicle lookups
- `/config` cached in-memory on client
- Search results < 10 ms server-side

## Feature Flags (env)
- `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` — blank falls back to mock; add for live UPI/Cards
- `REFERRAL_BONUS` = 50
- `PLATFORM_COMMISSION_RATE` = 0.5

# RideReserve — Product Requirements

Mobile-first Vehicle Seat Reservation & Ride Sharing platform (Cars, Tempos, Buses) with dual roles (Passenger / Driver / Admin), 50/50 commission split, QR ticketing, ratings, referrals, and route maps.

## Tech
- Expo Router SDK 54, TypeScript, safe-area-context, expo-image-picker, react-native-qrcode-svg, react-native-webview, Leaflet + OpenStreetMap
- FastAPI + MongoDB (motor), razorpay SDK
- Auth: Emergent Managed Google + Phone OTP (mocked — OTP = `123456`)
- Uploads: Emergent Managed Object Storage
- Payments: Razorpay (test mode, live UPI + cards) with mocked GPay/PhonePe fallback

## Core Screens
1. Login (Google + Phone OTP)
2. Onboarding (name, photo, emergency contact)
3. Home/Search (from, to, date, type pills)
4. Vehicle Detail: **Route Preview map (OSM/Leaflet)**, seat grid, reviews list
5. Checkout with Razorpay + mocked GPay/PhonePe/UPI methods
6. Razorpay WebView checkout screen
7. Digital Ticket (QR + Call Driver post-payment)
8. My Bookings + **"Rate this Trip" button** on paid rides
9. Rate Trip: 1–5 stars + optional comment
10. Wallet/Earnings + Withdraw
11. Profile with role switch + **Refer & Earn link**
12. Refer & Earn: share code, apply friend's code
13. Driver: Vehicle Registration + Listing
14. Admin: Revenue, Approvals, Drivers

## Key APIs
Auth: `/api/auth/session`, `/api/auth/otp/send|verify`, `/api/auth/me`
Users: `/api/users/me`, `/api/upload`, `/api/files/{path}`
Vehicles: `/api/vehicles`, `/api/vehicles/mine`, `/api/vehicles/search`, `/api/vehicles/{id}`, `/api/vehicles/{id}/seats`
Bookings: `/api/bookings`, `/api/bookings/{id}/pay`, `/api/bookings/verify-payment`, `/api/bookings/mine`, `/api/bookings/driver/list`, `/api/bookings/{id}`
Wallet: `/api/wallet/me`, `/api/wallet/withdraw`
Reviews: `/api/reviews`, `/api/reviews/vehicle/{id}`, `/api/reviews/mine`
Referrals: `/api/referrals/me`, `/api/referrals/apply`
Geo: `/api/geocode?q=...`
Config: `/api/config`
Admin: `/api/admin/stats`, `/api/admin/vehicles/*`, `/api/admin/commissions`

## Feature Flags (env)
- `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` — leave blank to fall back to mocked payment; add for live Razorpay UPI/Cards
- `REFERRAL_BONUS` = 50 (₹ per referrer + referee)
- `PLATFORM_COMMISSION_RATE` = 0.5

## How to enable live Razorpay (later)
1. Go to dashboard.razorpay.com → Test Mode → Account Settings → API Keys → Generate.
2. Paste `Key ID` (rzp_test_...) and `Secret` into `/app/backend/.env`.
3. Restart backend. The checkout screen will surface a "Razorpay (UPI + Cards)" option and route through the WebView flow with server-side signature verification.

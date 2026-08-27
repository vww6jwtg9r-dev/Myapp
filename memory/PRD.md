# RideReserve — Product Requirements

Mobile-first Vehicle Seat Reservation & Ride Sharing platform (Cars, Tempos, Buses) with dual roles (Passenger / Driver / Admin), 50/50 commission split, and QR ticketing.

## Tech
- Expo Router (SDK 54), TypeScript, react-native-safe-area-context, expo-image-picker, react-native-qrcode-svg
- FastAPI + MongoDB (motor)
- Auth: Emergent Managed Google + Phone OTP (mocked — OTP = `123456`)
- Uploads: Emergent Managed Object Storage
- Payments: Google Pay / PhonePe / UPI (mocked)

## Core Screens
1. Login (Google + Phone OTP)
2. Onboarding (name, photo, emergency contact)
3. Home/Search (from, to, date, type pills)
4. Vehicle Detail + Seat Selection Grid (car 4 / tempo 12 / bus 32)
5. Checkout (fare breakdown + GPay/PhonePe/UPI)
6. Digital Ticket (QR code + Call Driver post-payment)
7. My Bookings, Wallet/Earnings (withdraw), Profile (role switch)
8. Driver: Vehicle Registration + Listing
9. Admin: Revenue, Approvals, Drivers

## Key APIs
`/api/auth/session`, `/api/auth/otp/send`, `/api/auth/otp/verify`, `/api/auth/me`
`/api/users/me`, `/api/upload`, `/api/files/{path}`
`/api/vehicles`, `/api/vehicles/mine`, `/api/vehicles/search`, `/api/vehicles/{id}`, `/api/vehicles/{id}/seats`
`/api/bookings`, `/api/bookings/{id}/pay`, `/api/bookings/mine`, `/api/bookings/driver/list`, `/api/bookings/{id}`
`/api/wallet/me`, `/api/wallet/withdraw`
`/api/admin/stats`, `/api/admin/vehicles/pending`, `/api/admin/vehicles/{id}/approve|reject`, `/api/admin/commissions`

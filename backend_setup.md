# Backend Local Dev Setup

Complete guide for running and testing the QuinckleCrew backend locally.

---

## What runs where

| Service | Local dev | Production |
|---|---|---|
| API server | `localhost:3000` | `https://quinckle-user-app-backend.onrender.com` |
| PostgreSQL | Local Docker (`localhost:5432`) | Neon (see `quinckle-user-app-backend.env`) |
| Redis | Local Docker (`localhost:6379`) | Render Redis (see `quinckle-user-app-backend.env`) |
| Ably | Real key (real-time works locally) | Same key |
| Message Central | Mocked locally (OTP = `123456`) | Real SMS sent |
| Razorpay | Test mode keys | Same test keys |

The Expo app automatically points to `localhost:3000` when running in dev mode (`__DEV__ = true`) and to the production URL when built for release.

---

## First-time setup (run once)

### 1. Start Docker Desktop
Open Docker Desktop from the Start menu. Wait for the whale icon in the taskbar to stop animating.

### 2. Start local infrastructure (PostgreSQL + Redis)
```bash
cd backend
docker compose -f docker-compose.dev.yml up -d
```

Verify both are healthy:
```bash
docker compose -f docker-compose.dev.yml ps
```
Both `postgres` and `redis` should show **running**.

### 3. Generate Prisma client
```bash
cd backend
npx prisma generate
```

### 4. Run database migrations
```bash
cd backend
npx prisma migrate dev --name init
```
If prompted about drift or reset, type `y` — it's safe, this only affects your local Docker database.

### 5. Seed test data
```bash
cd backend
npm run prisma:seed
```
This creates 2 restaurants, 20 tables, 29 menu items, 9 staff members, 37 sessions, 104 orders, and payment records.

### 6. Start the backend server
```bash
cd backend
npm run dev
```

You should see:
```
Server listening at http://0.0.0.0:3000
Redis connected
⚠ Dev routes enabled — /api/dev/* is active
```

---

## Every time after first setup

Docker data is preserved between restarts. All you need is:

```bash
cd backend
docker compose -f docker-compose.dev.yml up -d   # start Docker services
npm run dev                                        # start API server
```

---

## Seeded staff accounts

| Name | Phone (enter in app) | Role | App view |
|---|---|---|---|
| Rahul Sharma | `9876512345` | STEWARD | Staff dashboard |
| Priya Singh | `9123498765` | STEWARD | Staff dashboard |
| Amit Kumar | `9345678901` | CHEF | Cook dashboard |
| Ankit Verma | `9567890123` | CASHIER | Staff dashboard |

Real OTP sent via Message Central SMS to the registered phone number.

---

## Login options

### Option A — OTP flow (full end-to-end test)
1. Open app → tap **Get Started**
2. Enter a seeded phone number (e.g. `9876512345`)
3. Tap **Send Code** — a real OTP SMS is sent via Message Central to that phone
4. Enter the OTP received → logged in as that staff member

> **Note:** The seeded phone numbers (`9876512345`, `9345678901`, etc.) are fake numbers — they won't receive SMS. To test real OTP delivery, add your own phone number as a staff member in the local DB (see below), or use the Test Access bypass.

### Option B — Test Access button (fastest)
Tap **Test Access** on the login screen:
- **Steward** → logs in as Rahul Sharma (STEWARD) with real token from DB
- **Kitchen Staff** → logs in as Amit Kumar (CHEF) with real token from DB

### Option C — Dev bypass API (from PowerShell)
```powershell
# Get all seeded staff with tokens
Invoke-WebRequest -Uri http://localhost:3000/api/dev/state | Select-Object -ExpandProperty Content

# Login as a specific staff member by phone
Invoke-WebRequest -Method POST `
  -Uri http://localhost:3000/api/dev/crew-login-bypass `
  -ContentType "application/json" `
  -Body '{"phone": "9345678901"}'
```

---

## Test everything locally — checklist

### Backend health
```powershell
Invoke-WebRequest -Uri http://localhost:3000/api/v1/health | Select-Object -ExpandProperty Content
Invoke-WebRequest -Uri http://localhost:3000/api/v1/health/deep | Select-Object -ExpandProperty Content
```
Both should return `"status":"ok"`.

### Cook view (login as Chef — phone `9345678901`, OTP `123456`)
- [ ] Kitchen tickets appear from real DB
- [ ] Tap item checkbox → marks as done, status changes to Preparing
- [ ] Tick all items in a ticket → status shows Ready, swipe hint appears
- [ ] Swipe right → ticket disappears, undo bar appears (15s window)
- [ ] Tap Undo within 15s → ticket comes back
- [ ] Swipe again, don't undo → ticket moves to Completed tab
- [ ] Search bar filters tickets
- [ ] Profile → shows real name (Amit Kumar) and restaurant name

### Staff view (login as Steward — phone `9876512345`, OTP `123456`)
- [ ] Real tables appear (20 tables from seed)
- [ ] Tap available table → confirm → session starts → table shows as occupied
- [ ] Tap occupied table → opens table detail with real order items
- [ ] Tap Ready item in table detail → marks as served
- [ ] Expand bill → shows real totals → Collect Cash → marks session paid
- [ ] Three-dot menu → End Session → table goes back to available
- [ ] Orders tab → shows READY orders from kitchen
- [ ] Menu tab → shows real menu items from DB
- [ ] Profile → shows real name and restaurant name

### Cross-role flow
1. Login as Chef on emulator
2. Use Test Access → Steward on another device (or log in/out)
3. Chef marks items done and bumps a ticket
4. Steward's Orders tab should show the ready order (pull to refresh or wait 15s for poll)

---

## Add your real phone number for OTP testing

The seeded phone numbers are fake. To receive a real OTP on your phone:

**Step 1** — Get the restaurant ID:
```powershell
Invoke-WebRequest -Uri http://localhost:3000/api/dev/state | Select-Object -ExpandProperty Content
```
Copy the `restaurantId` from the response.

**Step 2** — Open Prisma Studio (visual DB editor):
```bash
cd backend
npx prisma studio
```
Opens at `http://localhost:5555` in your browser.

**Step 3** — In Prisma Studio, go to **StaffMember** → **Add record**:
- `restaurantId` → paste the restaurant ID from Step 1
- `name` → your name
- `phone` → your 10-digit number (without +91, e.g. `9999999999`)
- `role` → `STEWARD` or `CHEF`
- `isActive` → `true`

Now in the app, enter your phone number → real OTP arrives on your phone.

---

## Re-seed (reset test data)
If you want fresh data:
```bash
cd backend
# Option 1: Just re-run seed (adds on top of existing)
npm run prisma:seed

# Option 2: Wipe everything and start clean
docker compose -f docker-compose.dev.yml down -v    # deletes all data
docker compose -f docker-compose.dev.yml up -d      # fresh containers
npx prisma migrate dev --name init                  # recreate tables
npm run prisma:seed                                  # reseed
```

---

## Stopping everything
```bash
# Stop API server: Ctrl+C

# Stop Docker (data preserved)
docker compose -f docker-compose.dev.yml down

# Stop Docker AND delete all local DB data
docker compose -f docker-compose.dev.yml down -v
```

---

## Environment files

| File | Purpose |
|---|---|
| `backend/.env` | Local dev — uses Docker DB + Docker Redis + real API keys |
| `quinckle-user-app-backend.env` | Production reference — uses Neon + Render Redis. Never rename this to .env |

---

## Production deployment checklist

Before deploying the backend to Render:
- [ ] Use `quinckle-user-app-backend.env` values on Render (never commit it)
- [ ] Run `npx prisma migrate deploy` on production DB after any schema changes
- [ ] Dev routes (`/api/dev/*`) are blocked automatically in production (`NODE_ENV=production`)
- [ ] Confirm `PROD_HOST` in `constants/env.ts` (frontend) matches the Render URL

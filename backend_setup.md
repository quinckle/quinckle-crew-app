# Backend Setup — Local Dev Guide

This document records every change made for local development and explains why each decision was made.

---

## What This Backend Is

The `backend/` folder is the **complete Quinckle platform backend** built with **Fastify + Prisma + TypeScript**. It contains everything the QuinckleCrew app needs:

| Feature | Exists |
|---|---|
| Crew OTP auth (`/api/crew/auth/otp/request`, `/otp/verify`) | ✅ |
| Kitchen ticket queue (`/api/kitchen/orders`) | ✅ |
| Staff tables (`/api/crew/tables`) | ✅ |
| Dev seed/state/bypass (`/api/dev/...`) | ✅ |
| Partner dashboard, payments, reviews, bookings | ✅ |
| Real-time via Ably | ✅ |

---

## Files Created

| File | Why |
|---|---|
| `backend/.env` | Local dev env vars — local PostgreSQL, local Redis, dummy Message Central values |
| `backend/docker-compose.dev.yml` | Runs PostgreSQL 15 + Redis 7 locally (no cloud accounts needed) |

## Frontend Files Updated

| File | What Changed | Why |
|---|---|---|
| `constants/env.ts` | Removed `/api/v1` from base URL | Backend uses `/api/crew/...` not `/api/v1/crew/...` |
| `services/api.ts` | Updated all paths + response type mapping | Backend returns `token`/`user.restaurant_id` (snake_case); normalized to camelCase for the app |

---

## Key Differences From the API Guide

The `Quinckle-API-Integration-Guide.docx` described these crew paths:
- `POST /crew/auth/send-otp`
- `POST /crew/auth/verify-otp`

The **actual backend** uses:
- `POST /api/crew/auth/otp/request`
- `POST /api/crew/auth/otp/verify`

The frontend `services/api.ts` has been updated to call the correct paths.

The verify response also uses different field names:
- Guide says: `{ crewToken, staff: { restaurantId, restaurantName } }`
- Backend returns: `{ token, user: { restaurant_id, restaurant_name } }`

`services/api.ts` normalizes these to camelCase so the rest of the app is unaffected.

---

## OTP in Dev Mode

The crew auth service **always calls Message Central** — there is no dev-mode SMS bypass in the auth flow. This means the real OTP flow won't work locally unless you have real Message Central credentials.

**For local testing: always use the dev bypass endpoint instead of OTP.**

---

## How to Run Locally — Step by Step

### Prerequisites
- Docker Desktop installed and running
- Node.js 20+
- Run all backend commands from inside the `backend/` folder

---

### Step 1 — Start Docker services

```bash
cd backend
docker compose -f docker-compose.dev.yml up -d
```

Starts PostgreSQL on port 5432 and Redis on port 6379. Verify they're healthy:

```bash
docker compose -f docker-compose.dev.yml ps
```

Both should show status **running**.

---

### Step 2 — Generate Prisma client

```bash
cd backend
npx prisma generate
```

---

### Step 3 — Run migrations

Creates all database tables from the Prisma schema:

```bash
cd backend
npx prisma migrate dev --name init
```

---

### Step 4 — Seed the database

Populates the database with two full restaurants, staff members, menu items, tables, sessions, and orders:

```bash
cd backend
npm run prisma:seed
```

---

### Step 5 — Start the backend

```bash
cd backend
npm run dev
```

You should see:
```
Server listening at http://0.0.0.0:3000
```

---

### Step 6 — Verify it's working

In PowerShell:

```powershell
Invoke-WebRequest -Uri http://localhost:3000/health | Select-Object -ExpandProperty Content
```

Should return `{"status":"ok"}` or similar.

---

### Step 7 — Get dev state (see what was seeded)

```powershell
Invoke-WebRequest -Uri http://localhost:3000/api/dev/state | Select-Object -ExpandProperty Content
```

Returns all staff members with their pre-generated tokens and phone numbers.

---

## Seeded Staff Accounts (for testing)

From `prisma/seed.ts` — these are the staff members created:

| Phone (enter in app) | Role | App view |
|---|---|---|
| `9876512345` | STEWARD | Staff dashboard |
| `9123498765` | STEWARD | Staff dashboard |
| `9345678901` | CHEF | Cook dashboard |
| `9234567890` | CHEF | Cook dashboard |

> Run `/api/dev/state` to get the full list with tokens.

---

## Testing Login in the App (Bypass OTP)

Since Message Central SMS won't work without real credentials, use the **dev bypass** endpoint directly. In PowerShell:

```powershell
Invoke-WebRequest -Method POST `
  -Uri http://localhost:3000/api/dev/crew-login-bypass `
  -ContentType "application/json" `
  -Body '{"phone": "9345678901"}'
```

This returns a `crewToken` you can inspect. The **app itself** hits this bypass automatically when the real OTP fails — check `credential.tsx` fallback logic.

Alternatively, enter any seeded staff phone number in the app and the flow will:
1. Call `POST /api/crew/auth/otp/request` — this will fail silently (Message Central has dummy creds)
2. Move to OTP entry screen anyway
3. On OTP submit, the real verify call fails → falls back to mock credentials in `credential.tsx`

**Cleanest local test flow:** enter `1234567890` (mock staff) or `0987654321` (mock cook) — these bypass the API entirely via the hardcoded mock in `credential.tsx`.

---

## Stopping Everything

```bash
# Stop the backend server: Ctrl+C

# Stop Docker (data preserved)
cd backend
docker compose -f docker-compose.dev.yml down

# Stop Docker AND delete all data (fresh start)
docker compose -f docker-compose.dev.yml down -v
```

---

## What Still Needs to Be Done Before Full Integration

| Task | Notes |
|---|---|
| Real Message Central credentials | Add to `.env` — then real OTP flow works |
| Wire kitchen orders into cook dashboard | `kitchen.getOrders()` exists in `services/api.ts` but cook screen still uses mock data |
| Wire crew tables into staff dashboard | `crewTables.list()` exists but staff screen still uses mock data |
| Token refresh in the app | Crew token is 12h — no refresh logic in app yet |

---

## Production Checklist (before pushing backend changes)

- [ ] Never commit `.env` — it has local-only values
- [ ] Run `npx prisma migrate deploy` on the production database after any schema changes
- [ ] Dev routes (`/api/dev/*`) are automatically disabled when `NODE_ENV=production`
- [ ] Add real `MESSAGE_CENTRAL_AUTH_TOKEN` and `MESSAGE_CENTRAL_CUSTOMER_ID` to production env

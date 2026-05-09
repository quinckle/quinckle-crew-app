# QuinckleCrew — Backend API Specification

**What this is:** QuinckleCrew is the internal restaurant staff app for the Quinckle platform. It is used exclusively by restaurant employees — **Staff** (front-of-house) and **Cooks** (kitchen). It is not a diner-facing product.

This document is the complete API contract your backend needs to serve for the QuinckleCrew React Native app.

---

## How It Fits in the Quinckle Platform

The Quinckle backend (Node.js + Fastify + PostgreSQL + Redis) already serves the QR dine-in system for diners. QuinckleCrew connects to the **same backend** and extends it with staff-specific routes. The app has no separate server — it shares the auth system, the order data, and the WebSocket channels already defined in the QR dine-in spec.

```
Diner scans QR → places order via Quinckle QR flow → order lands in PostgreSQL
                                                              ↓
                                          QuinckleCrew (this app) reads it
                                          Cook marks it preparing / ready
                                          Staff sees status, serves, bills
```

---

## Tech Stack (inherit from Quinckle backend)

| Layer | Technology |
|---|---|
| Runtime | Node.js v20 LTS |
| HTTP server | Fastify v4 |
| Auth | `@fastify/jwt` — HS256 JWT |
| OTP | MSG91 |
| Database | PostgreSQL 15 via Prisma ORM |
| Cache | Redis 7 |
| Real-time | `@fastify/websocket` |
| Background jobs | BullMQ |

All QuinckleCrew routes are under the same Fastify server. Add them as a new plugin/prefix, not a new server.

---

## Role System

Every JWT issued to a crew member contains:

```json
{
  "user_id": "usr_abc123",
  "role": "staff | cook",
  "restaurant_id": "rest_8f3a2b",
  "exp": 1234567890
}
```

- `role` determines what the app renders (Staff dashboard vs Cook dashboard).
- `restaurant_id` scopes all queries — a crew member can only read and write data for their own restaurant. Enforce this on every route.
- The app reads `role` from the JWT after login and routes the user to the correct screen. No separate role-check endpoint is needed.

---

## 1. Authentication — `/api/crew/auth`

### POST `/api/crew/auth/otp/request`

Sends an OTP to the crew member's phone. The frontend collects the restaurant ID and phone number on the credential screen.

**Request:**
```json
{
  "restaurant_id": "rest_8f3a2b",
  "phone": "+919876543210"
}
```

**Response 200:**
```json
{ "message": "OTP sent" }
```

**Response 404:**
```json
{ "error": "No crew member found with this phone for this restaurant" }
```

**Notes:**
- Validate that a `crew_member` record exists with this `phone` + `restaurant_id` before sending OTP.
- Send via MSG91. Store OTP hash + expiry (5 min) in Redis: `otp:{phone}` → `{ hash, expiresAt }`.
- Rate limit: max 5 OTP requests per phone per hour via Cloudflare rule.

---

### POST `/api/crew/auth/otp/verify`

Verifies the OTP and returns a JWT.

**Request:**
```json
{
  "restaurant_id": "rest_8f3a2b",
  "phone": "+919876543210",
  "otp": "482910"
}
```

**Response 200:**
```json
{
  "token": "eyJhbGci...",
  "user_id": "usr_abc123",
  "role": "staff",
  "restaurant_id": "rest_8f3a2b",
  "name": "Riya"
}
```

**Response 401:**
```json
{ "error": "Invalid or expired OTP" }
```

**Notes:**
- JWT expiry: 12 hours (crew members log in at shift start).
- On verify: delete the OTP key from Redis immediately to prevent reuse.
- The `name` field is shown on the app's header.

---

## 2. Tables — `/api/crew/tables`

These routes power the Staff dashboard: the floor plan grid showing all tables with their current status.

### GET `/api/crew/tables`

Returns all tables for the authenticated crew member's restaurant.

**Headers:** `Authorization: Bearer <token>`

**Response 200:**
```json
{
  "tables": [
    {
      "table_id": "tbl_001",
      "table_number": 7,
      "capacity": 4,
      "status": "occupied",
      "session_id": "sess_abc123",
      "occupied_since": "2026-05-10T18:32:00Z"
    },
    {
      "table_id": "tbl_002",
      "table_number": 8,
      "capacity": 2,
      "status": "available",
      "session_id": null,
      "occupied_since": null
    }
  ]
}
```

**Status values:** `available | occupied | reserved`

**Notes:**
- Staff filters tables by status on the dashboard (the filter tabs in the app). This filtering happens on the frontend — return all tables, not filtered.
- Cache table list in Redis for 30s: `tables:{restaurant_id}`. Invalidate when any table status changes.

---

### PATCH `/api/crew/tables/{table_id}/status`

Allows staff to manually change a table's status (e.g., mark reserved, clear a table).

**Request:**
```json
{ "status": "available | reserved" }
```

**Response 200:**
```json
{ "table_id": "tbl_001", "status": "reserved" }
```

**Notes:**
- Staff cannot manually set a table to `occupied` — that happens automatically when a session starts (`POST /api/crew/sessions`).
- On status change, emit WebSocket event `table:status-update` to the restaurant's staff channel.

---

## 3. Sessions — `/api/crew/sessions`

A session represents one group of diners at a table from sit-down to checkout. All orders belong to a session.

### POST `/api/crew/sessions`

Staff starts a new session when guests are seated. This marks the table as occupied.

**Request:**
```json
{ "table_id": "tbl_001" }
```

**Response 201:**
```json
{
  "session_id": "sess_abc123",
  "table_id": "tbl_001",
  "table_number": 7,
  "started_at": "2026-05-10T18:32:00Z"
}
```

**Response 409:**
```json
{ "error": "Table 7 already has an active session" }
```

**Notes:**
- Automatically sets the table's status to `occupied`.
- Emit `table:status-update` WebSocket event.

---

### DELETE `/api/crew/sessions/{session_id}`

Ends a session (checkout). Marks the table as available again.

**Response 200:**
```json
{
  "session_id": "sess_abc123",
  "ended_at": "2026-05-10T20:14:00Z",
  "final_total": 847
}
```

**Notes:**
- Only allowed if session status is `paid`. If not paid, return 409: `"Cannot close session — payment pending"`.
- Sets the table status back to `available`.
- Emits `table:status-update` WebSocket event.

---

### GET `/api/crew/sessions/{session_id}/bill`

Returns all orders in the session and the running bill total. Used on the Table Detail screen.

**Response 200:**
```json
{
  "session_id": "sess_abc123",
  "table_number": 7,
  "status": "active",
  "orders": [
    {
      "order_id": "ord_xyz789",
      "placed_at": "2026-05-10T18:45:00Z",
      "status": "preparing",
      "items": [
        {
          "item_id": "item_001",
          "name": "Mutton Chop",
          "qty": 2,
          "price": 180,
          "item_status": "preparing",
          "served": false
        },
        {
          "item_id": "item_045",
          "name": "Dal Makhani",
          "qty": 1,
          "price": 220,
          "item_status": "ready",
          "served": false
        }
      ],
      "order_total": 580
    }
  ],
  "session_total": 580
}
```

**Notes:**
- `item_status` mirrors the cook's per-item checkbox state.
- `served` is set by staff after the cook marks the item ready.
- This is the data source for the "running bill total" displayed at the bottom of the Table Detail screen.

---

## 4. Orders (Staff-Placed) — `/api/crew/orders`

Staff can place orders on behalf of diners when the diner cannot or does not want to use the QR flow.

### POST `/api/crew/orders`

**Request:**
```json
{
  "session_id": "sess_abc123",
  "items": [
    { "item_id": "item_001", "qty": 2, "note": "less spicy" },
    { "item_id": "item_045", "qty": 1, "note": "" }
  ]
}
```

**Response 201:**
```json
{
  "order_id": "ord_xyz789",
  "status": "received",
  "total": 580,
  "items": [
    { "item_id": "item_001", "name": "Mutton Chop", "qty": 2, "price": 180 },
    { "item_id": "item_045", "name": "Dal Makhani", "qty": 1, "price": 220 }
  ]
}
```

**Response 409:**
```json
{ "error": "Mutton Chop is currently unavailable" }
```

**Notes:**
- This goes into the same `Order` table as QR-placed orders. The cook's kitchen queue shows all orders from both sources.
- Validate that every `item_id` belongs to the same `restaurant_id` as the session. Reject cross-restaurant item injection.
- Emit `order:new` WebSocket event to the kitchen channel immediately.

---

### PATCH `/api/crew/orders/{order_id}/items/{item_id}/serve`

Staff marks an individual item as served after the cook signals it is ready.

**Request:**
```json
{ "served": true }
```

**Response 200:**
```json
{ "item_id": "item_001", "served": true }
```

**Notes:**
- Only allowed if `item_status` is `ready`. Return 409 if the cook has not marked it ready yet.
- Emit `order:item-served` WebSocket event to the staff channel so all logged-in staff see the update.

---

### GET `/api/crew/orders/active`

Returns all active orders across all tables for the restaurant. Used by staff to monitor which table ordered what.

**Response 200:**
```json
{
  "orders": [
    {
      "order_id": "ord_xyz789",
      "table_number": 7,
      "session_id": "sess_abc123",
      "status": "preparing",
      "placed_at": "2026-05-10T18:45:00Z",
      "items": [...]
    }
  ]
}
```

---

## 5. Kitchen — `/api/kitchen`

These routes power the Cook dashboard: the ticket queue the cook sees and works through.

### GET `/api/kitchen/orders`

Returns all active kitchen tickets for the restaurant — orders with status `received` or `preparing`, sorted by `placed_at` ascending (oldest first).

**Headers:** `Authorization: Bearer <token>` (role must be `cook`)

**Response 200:**
```json
{
  "tickets": [
    {
      "order_id": "ord_xyz789",
      "table_number": 7,
      "status": "received",
      "placed_at": "2026-05-10T18:45:00Z",
      "items": [
        {
          "item_id": "item_001",
          "name": "Mutton Chop",
          "qty": 2,
          "note": "less spicy",
          "item_status": "pending"
        },
        {
          "item_id": "item_045",
          "name": "Dal Makhani",
          "qty": 1,
          "note": "",
          "item_status": "pending"
        }
      ]
    }
  ]
}
```

**Item status values:** `pending | done`

**Notes:**
- This is the primary data source for the cook's screen. Poll this on mount and rely on WebSocket for live updates after that.
- Exclude orders with status `ready` or `served` — those are off the cook's queue.

---

### PATCH `/api/kitchen/orders/{order_id}/items/{item_id}/status`

The cook taps a checkbox next to an item. This is the per-item "done" toggle — a checklist within a ticket.

**Request:**
```json
{ "item_status": "done | pending" }
```

**Response 200:**
```json
{
  "order_id": "ord_xyz789",
  "item_id": "item_001",
  "item_status": "done"
}
```

**Notes:**
- Emit `order:item-update` WebSocket event to the staff channel so the Table Detail screen reflects the cook's progress.
- This does not change the top-level `order.status` — that is a separate action.

---

### PATCH `/api/kitchen/orders/{order_id}/status`

The cook marks the entire ticket as ready (swipe-to-bump in the app). This moves the ticket off the cook's queue and notifies staff.

**Request:**
```json
{ "status": "ready" }
```

**Response 200:**
```json
{
  "order_id": "ord_xyz789",
  "status": "ready",
  "bumped_at": "2026-05-10T19:02:00Z"
}
```

**Notes:**
- Valid transitions: `received → preparing → ready`. Reject any other transition with 400.
- On `ready`: emit `order:status-update` to the staff channel. The staff's active order view lights up.
- The cook can also transition `received → preparing` when they start working on a ticket (optional; the app may auto-set this on first item checkbox).

---

### POST `/api/kitchen/orders/{order_id}/undo`

Reverts the last status change on a ticket. The app shows an undo bar for a few seconds after a bump.

**Response 200:**
```json
{
  "order_id": "ord_xyz789",
  "status": "preparing",
  "message": "Order status reverted"
}
```

**Response 409:**
```json
{ "error": "Cannot undo — order has already been served" }
```

**Notes:**
- Undo is only valid within a short window (suggest: 15 seconds). Store the `bumped_at` timestamp and reject undo if `now - bumped_at > 15s`.
- Emit `order:status-update` WebSocket event to staff channel.

---

## 6. Payments — `/api/crew/payments`

QuinckleCrew only handles cash payments. QR/online payments go through the Razorpay flow in the main Quinckle dine-in system.

### POST `/api/crew/payments/cash`

Staff marks a session as paid by cash after collecting payment.

**Request:**
```json
{
  "session_id": "sess_abc123",
  "staff_id": "usr_abc123",
  "amount_collected": 847
}
```

**Response 200:**
```json
{
  "session_id": "sess_abc123",
  "status": "paid",
  "payment_method": "cash",
  "amount": 847,
  "collected_by": "usr_abc123",
  "paid_at": "2026-05-10T20:10:00Z"
}
```

**Notes:**
- `amount_collected` should match `session_total`. If they differ (e.g., rounding), log it but do not reject the request.
- Record `staff_id` for cash accountability tracking (which staff collected how much cash per shift).
- After marking paid, the session can be closed via `DELETE /api/crew/sessions/{session_id}`.

---

## 7. WebSocket Events

All crew WebSocket connections authenticate via the same JWT. The cook and staff subscribe to different channels.

### Connection endpoints

| Role | WebSocket URL |
|---|---|
| Staff | `wss://api.quinckle.com/ws/crew/staff/{restaurant_id}` |
| Cook | `wss://api.quinckle.com/ws/crew/kitchen/{restaurant_id}` |

Both require `Authorization: Bearer <token>` as a query param or connection header.

---

### Events the backend emits

| Event | Direction | Channel | Payload |
|---|---|---|---|
| `order:new` | Server → Cook | kitchen:{restaurant_id} | `{ order_id, table_number, items, total, placed_at }` |
| `order:item-update` | Server → Staff | staff:{restaurant_id} | `{ order_id, item_id, item_status }` |
| `order:status-update` | Server → Staff | staff:{restaurant_id} | `{ order_id, table_number, status }` |
| `order:item-served` | Server → Staff | staff:{restaurant_id} | `{ order_id, item_id, served: true }` |
| `table:status-update` | Server → Staff | staff:{restaurant_id} | `{ table_id, table_number, status }` |

---

### When each event is emitted

| Trigger | Event fired |
|---|---|
| Staff places an order via `POST /api/crew/orders` | `order:new` → cook channel |
| Diner places an order via QR flow | `order:new` → cook channel |
| Cook toggles item checkbox | `order:item-update` → staff channel |
| Cook bumps ticket to `ready` | `order:status-update` → staff channel |
| Cook undoes a bump | `order:status-update` → staff channel |
| Staff marks item served | `order:item-served` → staff channel |
| Any table status changes | `table:status-update` → staff channel |

---

## 8. Database Models (Prisma additions for QuinckleCrew)

These extend the existing Quinckle schema (`backend.md` / `qr_backend.md`). Do not duplicate models already defined there.

```prisma
model CrewMember {
  id           String     @id @default(cuid())
  restaurantId String
  name         String
  phone        String
  role         String     // "staff" | "cook"
  isActive     Boolean    @default(true)
  createdAt    DateTime   @default(now())
  restaurant   Restaurant @relation(fields: [restaurantId], references: [id])
  payments     CashPayment[]

  @@unique([restaurantId, phone])
}

model CashPayment {
  id           String     @id @default(cuid())
  sessionId    String     @unique
  collectedBy  String     // CrewMember.id
  amount       Float
  paidAt       DateTime   @default(now())
  session      Session    @relation(fields: [sessionId], references: [id])
  collector    CrewMember @relation(fields: [collectedBy], references: [id])
}
```

**Add to existing `Order` model:**
```prisma
  source   String  @default("qr")  // "qr" | "staff"
  placedBy String?                 // CrewMember.id if source = "staff"
```

**Add to existing `OrderItem` model (or items JSON — prefer a separate table for querying):**
```prisma
model OrderItem {
  id         String  @id @default(cuid())
  orderId    String
  itemId     String
  qty        Int
  note       String?
  itemStatus String  @default("pending")  // "pending" | "done"
  served     Boolean @default(false)
  price      Float
  order      Order   @relation(fields: [orderId], references: [id])
  menuItem   MenuItem @relation(fields: [itemId], references: [id])
}
```

> If the existing schema stores `items` as a JSON blob in `Order`, migrate it to `OrderItem` rows. The per-item checkbox and serve features require individual row updates.

---

## 9. Error Handling

Use consistent error shapes across all crew routes:

```json
{ "error": "Human-readable message", "code": "MACHINE_READABLE_CODE" }
```

| HTTP code | When to use |
|---|---|
| 400 | Invalid request body or invalid state transition |
| 401 | Missing or expired JWT |
| 403 | Role does not have access to this route (e.g., cook hitting a staff route) |
| 404 | Resource not found |
| 409 | Conflict — table already occupied, item not ready to serve, etc. |

---

## 10. Route Authorization Summary

| Route group | Allowed roles |
|---|---|
| `/api/crew/auth/*` | Public (no JWT) |
| `/api/crew/tables/*` | `staff` |
| `/api/crew/sessions/*` | `staff` |
| `/api/crew/orders/*` | `staff` |
| `/api/crew/payments/*` | `staff` |
| `/api/kitchen/*` | `cook` |
| `/ws/crew/staff/*` | `staff` |
| `/ws/crew/kitchen/*` | `cook` |

Add a Fastify `preHandler` hook that checks `request.user.role` for every non-auth route and returns 403 if the role does not match.

---

## 11. Recommended Build Order

1. `CrewMember` table + Auth (OTP request → verify → JWT) — everything else needs a logged-in user
2. `GET /api/crew/tables` + `GET /api/kitchen/orders` — gets the two main dashboards rendering with real data
3. `POST /api/crew/sessions` + `DELETE /api/crew/sessions/{id}` — table occupancy flow
4. `POST /api/crew/orders` + `POST /api/kitchen/orders/{id}/status` — the core order-to-cook-to-serve loop
5. `PATCH /api/kitchen/orders/{id}/items/{id}/status` — per-item cook checklist
6. `PATCH /api/crew/orders/{id}/items/{id}/serve` — staff serves items
7. WebSocket events (replace polling with live pushes)
8. `POST /api/crew/payments/cash` — cash checkout

---

*QuinckleCrew — Internal staff coordination for the Quinckle platform.*
*Contact: quincklemain@gmail.com*

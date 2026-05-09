**QUINCKLE**

India's Complete Dine-Out Ecosystem

**QR Dine-In System**

Complete Technical Documentation

**Scan → Order → Track → Pay**

| **Node.js + Fastify** | **PostgreSQL + Redis** | **WebSocket** | **Razorpay** |
| --------------------- | ---------------------- | ------------- | ------------ |

<contact@quinckle.com> | <www.quinckle.com>

# **1\. Overview**

The Quinckle QR Dine-In system allows diners to scan a QR code at their table and instantly access a live digital menu, place food orders, track preparation status in real time, and pay - all without downloading an app or calling a waiter.

At scale across 10,000 restaurant partners, the system manages 200,000 unique QR codes, 40,000 concurrent diner sessions during dinner rush, and real-time order streaming to kitchen displays - all from the same Fastify backend.

| **For Diners**<br><br>No app download required<br><br>Scan QR on any smartphone<br><br>Live menu - always accurate pricing<br><br>Real-time order tracking<br><br>Pay via UPI, card, or wallet<br><br>Instant receipt on email | **For Restaurants**<br><br>Orders appear on kitchen display instantly<br><br>No printed menus - update prices in seconds<br><br>40% faster table turnover<br><br>Automatic billing - no calculation errors<br><br>Revenue + order analytics dashboard |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

# **2\. How It Works - Complete Flow**

The entire QR dine-in experience is broken into 6 stages. Each stage is independent and can be understood individually. The diagram below shows how all stages connect.

DINER SIDE QUINCKLE BACKEND RESTAURANT SIDE

─────────────────────────────────────────────────────────────────────────────────

\[1\] Diner sits at table

|

v

\[2\] Scans QR code \[3\] Cloudflare serves

quinckle.com/dine/ cached mobile web page

rest_8f3a2b/table_07 (no server hit needed)

|

v

\[4\] Menu page loads <─────────── \[5\] Fastify: GET /menu/rest_8f3a2b

(<200ms) Redis cache HIT → return JSON

|

v

\[6\] Diner selects items

|

v

\[7\] Taps Place Order ────────────> \[8\] POST /orders \[9\] Kitchen display

Validate items receives WebSocket

Write to PostgreSQL ping: NEW ORDER

WebSocket emit Table 7 - Paneer x2

|

v

\[10\] Screen shows: <─────────── WebSocket: order:status \[11\] Chef taps Preparing

"Preparing..." updates pushed to diner on kitchen tablet

|

v

\[12\] "Food is Ready!" <─────────── WebSocket: status = ready \[13\] Chef taps Ready

|

v

\[14\] Diner taps Pay ────────────> POST /checkout \[15\] Restaurant dashboard

Sum all session orders shows payment received

Create Razorpay order

Return payment link

|

v

\[16\] Pays via UPI/card ────────────> Razorpay webhook

| Mark session paid

v Queue receipt email

\[17\] Receipt on email Split: restaurant + Quinckle

**Key insight:** Every step after the QR scan is handled by your backend. The QR code itself is just a printed URL - it never expires, never needs updating, and works on any smartphone camera.

# **3\. How to Initialise the QR System**

Setting up the QR system involves 4 steps: project scaffolding, database setup, generating QR codes for restaurant tables, and printing/deploying them. Follow each step in order.

## **Step 1 - Project Setup**

Install dependencies and initialise the Fastify project:

\# Create project

mkdir quinckle-backend && cd quinckle-backend

npm init -y

\# Core dependencies

npm install fastify @fastify/jwt @fastify/cors @fastify/websocket

npm install @fastify/redis @fastify/autoload fastify-plugin

npm install @prisma/client prisma bullmq dotenv

\# QR code generation library

npm install qrcode

\# Dev dependencies

npm install -D nodemon

\# Initialise Prisma ORM

npx prisma init

## **Step 2 - Database Schema (Prisma)**

Create the database tables in prisma/schema.prisma:

generator client {

provider = "prisma-client-js"

}

datasource db {

provider = "postgresql"

url = env("DATABASE_URL")

}

model Restaurant {

id String @id @default(cuid())

name String

address String

phone String

isActive Boolean @default(true)

createdAt DateTime @default(now())

tables Table\[\]

menuItems MenuItem\[\]

orders Order\[\]

}

model Table {

id String @id @default(cuid())

restaurantId String

tableNumber Int

capacity Int @default(4)

qrToken String @unique @default(cuid())

restaurant Restaurant @relation(fields: \[restaurantId\], references: \[id\])

sessions Session\[\]

}

model MenuItem {

id String @id @default(cuid())

restaurantId String

name String

description String?

price Float

category String

isAvailable Boolean @default(true)

imageUrl String?

restaurant Restaurant @relation(fields: \[restaurantId\], references: \[id\])

}

model Session {

id String @id @default(cuid())

tableId String

status String @default("active") // active | paid | closed

createdAt DateTime @default(now())

table Table @relation(fields: \[tableId\], references: \[id\])

orders Order\[\]

}

model Order {

id String @id @default(cuid())

sessionId String

restaurantId String

status String @default("received") // received|preparing|ready|served

items Json

total Float

createdAt DateTime @default(now())

session Session @relation(fields: \[sessionId\], references: \[id\])

restaurant Restaurant @relation(fields: \[restaurantId\], references: \[id\])

}

\# Run migration to create tables in PostgreSQL

npx prisma migrate dev --name init

\# Generate Prisma client

npx prisma generate

## **Step 3 - Generate QR Codes for Tables**

When a restaurant is onboarded, run this script to generate QR codes for all their tables:

// scripts/generateQR.js

const QRCode = require('qrcode');

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const path = require('path');

const fs = require('fs');

async function generateQRsForRestaurant(restaurantId) {

const tables = await prisma.table.findMany({

where: { restaurantId }

});

for (const table of tables) {

// URL the QR code points to

const url = \`<https://quinckle.com/dine/\${restaurantId}/\${table.qrToken}\`>;

// Generate QR as PNG file

const filePath = \`qr-codes/\${restaurantId}\_table\_\${table.tableNumber}.png\`;

await QRCode.toFile(filePath, url, {

width: 400,

margin: 2,

color: { dark: '#1A3C5E', light: '#FFFFFF' }

});

console.log(\`Generated QR for Table \${table.tableNumber}: \${filePath}\`);

}

}

// Usage: node scripts/generateQR.js rest_8f3a2b

generateQRsForRestaurant(process.argv\[2\]);

**Important:** The QR code URL never changes. Even if the menu changes, the QR stays the same. Only regenerate QRs if a table is physically moved to a different number.

## **Step 4 - Print and Deploy QR Codes**

| **Action**   | **Detail**                                                                                                                         |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Print format | Print on thick card stock, laminate for durability. Minimum size: 8cm x 8cm so any phone camera can scan from 30cm distance.       |
| Placement    | Place flat on the table, not vertical. Centre of table, away from condiments. One QR per table - do not share across tables.       |
| Test each QR | Before deployment, scan every QR with 3 different phones (iPhone, Android, old models). Confirm it opens the correct table menu.   |
| Backup plan  | Print the table number on the QR card. If QR fails, staff can manually enter the table in the system via the restaurant dashboard. |

# **4\. Tech Stack**

The QR dine-in system is built on the same Fastify backend as the rest of Quinckle. Below is every technology used, why it was chosen, and what it handles.

## **4.1 Backend**

| **Technology**     | **Version** | **Role**                | **Why chosen**                                                        |
| ------------------ | ----------- | ----------------------- | --------------------------------------------------------------------- |
| Node.js            | v20 LTS     | JavaScript runtime      | Non-blocking I/O - ideal for 40K concurrent WebSocket connections     |
| Fastify            | v4          | HTTP + WebSocket server | 3x faster than Express, built-in schema validation, plugin system     |
| @fastify/websocket | v8          | WebSocket support       | Official Fastify plugin, integrates with existing route system        |
| @fastify/redis     | v6          | Redis connection plugin | Shares Redis client across all Fastify routes via decorator           |
| @fastify/jwt       | v8          | JWT authentication      | Verifies diner and restaurant tokens on protected routes              |
| Prisma ORM         | v5          | Database query builder  | Type-safe queries, automatic migrations, excellent PostgreSQL support |
| BullMQ             | v4          | Job queue               | Handles receipt emails and notification jobs asynchronously           |
| qrcode             | v1.5        | QR image generation     | Generates PNG QR files during restaurant onboarding                   |

## **4.2 Databases and Storage**

| **Technology** | **Version** | **What it stores**                                                               |
| -------------- | ----------- | -------------------------------------------------------------------------------- |
| PostgreSQL     | 15-alpine   | All permanent data: restaurants, tables, menu items, sessions, orders, payments  |
| Redis          | 7-alpine    | Menu cache (5-min TTL), active sessions, order status, WebSocket room membership |
| Cloudflare R2  | Latest      | Menu item images, QR code PNG files, receipt PDFs                                |

## **4.3 Infrastructure**

| **Technology** | **Provider**  | **Role**                                                           |
| -------------- | ------------- | ------------------------------------------------------------------ |
| Docker         | Self-hosted   | Containers for api, worker, postgres, redis, cloudflared           |
| AWS EC2        | Mumbai region | Application server - t3.medium for MVP, scale to ECS Fargate later |
| Cloudflare     | Free / Pro    | CDN, DDoS protection, SSL, rate limiting, Tunnel                   |
| GitHub Actions | GitHub        | CI/CD: test on PR, auto-deploy to EC2 on merge to main             |
| Razorpay       | India         | Payment processing, UPI, cards, wallets, webhooks                  |
| MSG91          | India         | OTP SMS for diner login, booking notifications                     |
| Firebase FCM   | Google        | Push notifications to diner app for order status updates           |

# **5\. API Reference**

All QR dine-in endpoints are prefixed with /api/dine. Authentication is handled via a session token generated at QR scan time - no account login required for diners.

## **5.1 Session Initialisation**

### **POST /api/dine/session - Start a table session**

Called automatically when a diner first scans the QR code. Creates a session linking the diner to the table.

// Request

POST /api/dine/session

Content-Type: application/json

{

"restaurantId": "rest_8f3a2b",

"qrToken": "tok_9x2k1m" // from QR URL

}

// Response 201

{

"sessionId": "sess_abc123",

"tableNumber": 7,

"sessionToken": "eyJhbGci...", // JWT for this session

"expiresAt": "2026-04-12T23:59:00Z"

}

### **GET /api/dine/menu/:restaurantId - Fetch restaurant menu**

Returns the full menu for the restaurant. Served from Redis cache - responds in under 10ms on cache hit.

// Request

GET /api/dine/menu/rest_8f3a2b

Authorization: Bearer &lt;sessionToken&gt;

// Response 200

{

"restaurantName": "6 Ballygunge Place",

"categories": \[

{

"name": "Starters",

"items": \[

{

"id": "item_001",

"name": "Mutton Chop",

"description": "Classic Kolkata mutton chop with kasundi",

"price": 180,

"isAvailable": true,

"imageUrl": "<https://cdn.quinckle.com/items/item_001.jpg>"

}

\]

}

\]

}

// Fastify route with Redis cache:

fastify.get('/menu/:restaurantId', async (req, reply) => {

const key = \`menu:\${req.params.restaurantId}\`;

const cached = await fastify.redis.get(key);

if (cached) return JSON.parse(cached);

const menu = await prisma.menuItem.findMany({

where: { restaurantId: req.params.restaurantId, isAvailable: true }

});

await fastify.redis.setex(key, 300, JSON.stringify(menu)); // 5 min TTL

return menu;

});

## **5.2 Order Management**

### **POST /api/dine/orders - Place an order**

Creates a new order for the current session. Triggers a WebSocket event to the kitchen display immediately.

// Request

POST /api/dine/orders

Authorization: Bearer &lt;sessionToken&gt;

{

"sessionId": "sess_abc123",

"items": \[

{ "itemId": "item_001", "qty": 2, "note": "less spicy" },

{ "itemId": "item_045", "qty": 1, "note": "" }

\]

}

// Response 201

{

"orderId": "ord_xyz789",

"status": "received",

"total": 360,

"estimatedMins": 15,

"items": \[

{ "name": "Mutton Chop", "qty": 2, "price": 180 },

{ "name": "Dal Makhani", "qty": 1, "price": 0 }

\]

}

// Response 409 - item unavailable

{ "error": "Mutton Chop is currently unavailable" }

### **GET /api/dine/orders/:sessionId - Get all orders for session**

Returns all orders placed in the current table session, with live status for each.

// Request

GET /api/dine/orders/sess_abc123

Authorization: Bearer &lt;sessionToken&gt;

// Response 200

{

"orders": \[

{

"orderId": "ord_xyz789",

"status": "preparing", // received | preparing | ready | served

"total": 360,

"placedAt":"2026-04-12T19:32:00Z",

"items": \[...\]

}

\],

"sessionTotal": 360

}

### **PATCH /api/kitchen/orders/:orderId - Update order status (Kitchen)**

Used by the kitchen display tablet to update order status. Triggers a WebSocket push to the diner's phone.

// Request - from kitchen tablet

PATCH /api/kitchen/orders/ord_xyz789

Authorization: Bearer &lt;restaurantToken&gt;

{ "status": "ready" } // preparing | ready | served

// Response 200

{ "orderId": "ord_xyz789", "status": "ready" }

// This route also emits WebSocket event:

fastify.io.to(\`session:\${order.sessionId}\`).emit('order:update', {

orderId: order.id,

status: 'ready',

message: 'Your food is ready! A waiter will bring it shortly.'

});

## **5.3 Payment**

### **POST /api/dine/checkout - Generate payment link**

Sums all orders in the session and creates a Razorpay payment link. Diner pays directly from their phone.

// Request

POST /api/dine/checkout

Authorization: Bearer &lt;sessionToken&gt;

{ "sessionId": "sess_abc123" }

// Response 200

{

"sessionTotal": 847,

"quinckleFee": 42, // 5% commission

"paymentLink": "<https://rzp.io/l/abc123>",

"ordersIncluded": \["ord_xyz789", "ord_pqr456"\]

}

### **POST /api/webhooks/razorpay - Handle payment confirmation**

Razorpay calls this endpoint when payment is complete. This is where the session is marked paid and receipt email is queued.

// Called by Razorpay - not by the diner

POST /api/webhooks/razorpay

X-Razorpay-Signature: &lt;hmac&gt;

// Fastify handler:

fastify.post('/webhooks/razorpay', async (req, reply) => {

// 1. Verify HMAC signature to confirm it came from Razorpay

verifyRazorpaySignature(req.headers, req.body);

if (req.body.event === 'payment.captured') {

const sessionId = req.body.payload.payment.entity.receipt;

// 2. Mark session as paid

await prisma.session.update({ where: { id: sessionId }, data: { status: 'paid' } });

// 3. Notify kitchen WebSocket

fastify.io.to(\`restaurant:\${restaurantId}\`).emit('session:paid', { sessionId, tableNumber });

// 4. Queue receipt email (async - does not block response)

await receiptQueue.add('send-receipt', { sessionId, email: diner.email });

}

reply.send({ status: "ok" });

});

## **5.4 WebSocket Events**

The QR system uses two WebSocket channels. Diners connect to their session channel. Kitchen displays connect to the restaurant channel.

| **Event name** | **Direction**    | **Channel**     | **Payload**                            |
| -------------- | ---------------- | --------------- | -------------------------------------- |
| order:new      | Server → Kitchen | restaurant:{id} | { orderId, tableNumber, items, total } |
| order:update   | Server → Diner   | session:{id}    | { orderId, status, message }           |
| order:status   | Kitchen → Server | restaurant:{id} | { orderId, status }                    |
| session:paid   | Server → Kitchen | restaurant:{id} | { sessionId, tableNumber, total }      |
| menu:update    | Server → Diner   | restaurant:{id} | { itemId, isAvailable, newPrice }      |
| table:clear    | Server → Diner   | session:{id}    | { message: "Thank you, come again!" }  |

// WebSocket setup in Fastify (src/plugins/websocket.js)

const fp = require('fastify-plugin');

module.exports = fp(async function(fastify) {

// Diner connects when QR page loads

fastify.get('/ws/dine/:sessionId', { websocket: true }, (conn, req) => {

const room = \`session:\${req.params.sessionId}\`;

conn.socket.join(room);

conn.socket.on("close", () => conn.socket.leave(room));

});

// Kitchen tablet connects at start of day

fastify.get('/ws/kitchen/:restaurantId', {

websocket: true,

preHandler: \[fastify.authenticate\] // restaurant JWT required

}, (conn, req) => {

const room = \`restaurant:\${req.params.restaurantId}\`;

conn.socket.join(room);

});

});

# **6\. Scale Architecture - 10,000 Restaurants**

The QR system is designed to handle all 10,000 Quinckle restaurant partners simultaneously. This section explains every architectural decision made for scale.

## **6.1 Scale Numbers**

| **2,00,000**<br><br>unique QR codes | **40,000**<br><br>concurrent diner sessions at peak | **10,000**<br><br>restaurant WebSocket channels | **< 200ms**<br><br>menu load time (Redis cache) |
| ----------------------------------- | --------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------- |

## **6.2 Redis Caching Strategy**

Redis is the core of why 10,000 restaurants is achievable on a single server. Without caching, every QR scan would hit PostgreSQL - impossible at scale.

// Cache key structure

menu:{restaurantId} TTL: 300s (5 min) - full menu JSON

item:{itemId}:available TTL: 60s (1 min) - single item availability

session:{sessionId} TTL: 14400s (4 hr) - active session data

orders:{sessionId} TTL: 14400s (4 hr) - all orders for session

// Memory calculation for 10,000 restaurants:

// Average menu JSON = 50KB per restaurant

// 10,000 restaurants × 50KB = 500MB total menu cache

// Redis 7 handles this comfortably on 1GB RAM instance

// With maxmemory-policy allkeys-lru, cold menus auto-evict

// When restaurant updates a menu item:

async function invalidateMenuCache(restaurantId) {

await fastify.redis.del(\`menu:\${restaurantId}\`);

// Next request will fetch fresh from PostgreSQL and re-cache

}

## **6.3 WebSocket Scaling**

Each restaurant gets an isolated WebSocket channel. At 10,000 restaurants with 4 staff devices each, you have about 40,000 kitchen connections plus 40,000 diner sessions = 80,000 total WebSocket connections at peak.

// One Fastify process handles ~10,000 WebSocket connections

// 80,000 connections / 10,000 per process = 8 containers needed at peak

// Sticky sessions in docker-compose.prod.yml or AWS ALB:

// A diner MUST always connect to the SAME container

// so their WebSocket is not broken by the load balancer

// AWS ALB sticky session config:

// Duration: 4 hours (matches session TTL)

// Cookie: AWSALB

// For Durga Puja spike: ECS Fargate auto-scales from 2 to 8 containers

// Scale-up trigger: CPU > 60% for 2 consecutive minutes

// Scale-down trigger: CPU < 30% for 5 consecutive minutes

**Critical rule:** Never use socket.io without sticky sessions behind a load balancer. If a diner's request goes to a different container than their WebSocket connection, the order:update event will never reach their phone.

## **6.4 Container Architecture at Scale**

| **Container**   | **Count at 10K restaurants / peak**                                                              |
| --------------- | ------------------------------------------------------------------------------------------------ |
| api (Fastify)   | 5-8 containers behind AWS ALB. Each handles ~10K WebSocket connections. ECS Fargate auto-scales. |
| worker (BullMQ) | 2-3 containers. Processes receipt emails and push notifications async.                           |
| postgres        | 1 primary + 1 read replica. Read replica handles all GET queries (menu, session reads).          |
| redis           | 1 instance with 2GB RAM. Handles 100K req/sec. Add Redis Cluster at 5L+ users.                   |
| cloudflared     | 1 instance. Handles all inbound Cloudflare traffic to the load balancer.                         |

# **7\. Kitchen Display System (KDS)**

The Kitchen Display System is a tablet web app used by restaurant staff. It receives real-time order notifications via WebSocket and lets chefs update order status.

## **7.1 How the KDS Works**

| **Event**           | **What happens**                                                                                                      |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| New order received  | A card appears on the kitchen screen showing table number, items ordered, and special notes. A sound plays.           |
| Chef starts cooking | Chef taps "Preparing" on the order card. Diner's phone shows "Your food is being prepared".                           |
| Food is ready       | Chef taps "Ready". Diner's phone shows "Your food is ready! A waiter will bring it shortly."                          |
| Food served         | Waiter taps "Served". Order card moves to completed history.                                                          |
| Item unavailable    | Staff marks item as unavailable in dashboard. Redis cache is invalidated. New diners see item greyed out immediately. |
| Network drop        | KDS uses exponential backoff WebSocket reconnect. Missed events are fetched via REST API on reconnect.                |

## **7.2 KDS Frontend Code (React)**

// Kitchen display - connects to restaurant WebSocket channel

const ws = new WebSocket(\`wss://api.quinckle.com/ws/kitchen/\${restaurantId}\`);

ws.onmessage = (event) => {

const data = JSON.parse(event.data);

if (data.type === 'order:new') {

setOrders(prev => \[data.order, ...prev\]);

playSound();

}

if (data.type === 'order:update') {

setOrders(prev => prev.map(o =>

o.id === data.orderId ? { ...o, status: data.status } : o

));

}

};

// Chef taps "Ready" button

async function updateStatus(orderId, status) {

await fetch(\`/api/kitchen/orders/\${orderId}\`, {

method: 'PATCH',

headers: { 'Authorization': \`Bearer \${restaurantToken}\` },

body: JSON.stringify({ status })

});

// Backend handles WebSocket push to diner automatically

}

# **8\. Error Handling and Edge Cases**

Production systems break in unexpected ways. This section documents every failure scenario and how the QR system handles it.

| **Scenario**                          | **What happens**                            | **How it is handled**                                                                                                |
| ------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| QR code damaged / unscannable         | Diner cannot scan the QR                    | Staff uses dashboard to manually create session for that table number                                                |
| Menu not loading                      | Redis cache miss + PostgreSQL slow          | Fastify returns cached stale menu with a "refreshing" flag. Diner sees menu immediately, not a spinner.              |
| Item ordered but now unavailable      | Item sold out after menu loaded             | Order API checks Redis availability before accepting. Returns 409 with which items are unavailable.                  |
| Diner closes phone mid-order          | WebSocket disconnects                       | Session persists in Redis for 4 hours. Diner reopens QR, session auto-resumes. Orders are not lost.                  |
| Kitchen display disconnects           | WiFi drops at restaurant                    | KDS reconnects automatically. On reconnect, fetches all pending orders via REST GET /api/kitchen/orders.             |
| Payment fails                         | Razorpay transaction declined               | Session stays open. Diner can retry payment or choose different method. Orders are preserved.                        |
| Razorpay webhook fails                | Network issue between Razorpay and Quinckle | Razorpay retries webhook up to 5 times. BullMQ also polls payment status every 60 seconds as fallback.               |
| Duplicate order placed                | Diner taps Place Order twice                | Idempotency key (session + timestamp rounded to 10s) prevents duplicate orders within same window.                   |
| Server restart during active sessions | Docker container restarts                   | Session data is in Redis, not in-memory. On restart, all sessions resume. WebSocket clients reconnect automatically. |

# **9\. Security**

The QR dine-in system has unique security requirements because diners do not have accounts. The session token system prevents one table from seeing another table's orders.

| **Security rule**       | **Implementation**                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Session token isolation | Each QR scan generates a unique JWT session token. It is scoped to one tableId only. A diner at Table 7 cannot call APIs for Table 8.                  |
| qrToken validation      | The qrToken in the URL is checked against the table record in PostgreSQL. A guessed URL without the correct qrToken returns 404.                       |
| Razorpay webhook HMAC   | Every Razorpay webhook is verified with HMAC-SHA256 using the webhook secret. Unverified webhooks are rejected with 400.                               |
| Rate limiting           | Cloudflare rate limits: max 30 requests/min per IP on /api/dine/session. Prevents QR scan flooding.                                                    |
| Input validation        | Every Fastify route has a JSON schema. Item IDs in orders are verified to belong to the session's restaurant. Cross-restaurant ordering is impossible. |
| Session expiry          | Session tokens expire in 4 hours. After that, the table must be re-scanned to start a new session.                                                     |
| Kitchen auth            | Kitchen WebSocket requires a restaurant JWT. A diner JWT cannot connect to a kitchen channel.                                                          |
| No PII in QR URL        | The QR URL contains only the restaurantId and qrToken - no diner name, phone, or other personal data.                                                  |

# **10\. Environment Variables and Deployment**

## **10.1 Environment Variables**

\# .env.prod - QR system specific variables

\# Application

NODE_ENV=production

PORT=3000

BASE_URL=<https://quinckle.com>

\# Database

DATABASE_URL=postgresql://quinckle_app:PASSWORD@postgres:5432/quinckle_prod

\# Redis

REDIS_HOST=redis

REDIS_PORT=6379

REDIS_PASSWORD=STRONG_PASSWORD_HERE

\# Auth

JWT_SECRET=MINIMUM_32_CHAR_SECRET

JWT_EXPIRES_IN=7d

SESSION_JWT_EXPIRES_IN=4h # QR session token expiry

\# Razorpay

RAZORPAY_KEY_ID=rzp_live_xxx

RAZORPAY_KEY_SECRET=SECRET

RAZORPAY_WEBHOOK_SECRET=WEBHOOK_SECRET

\# Notifications

FIREBASE_SERVER_KEY=FCM_SERVER_KEY

MSG91_AUTH_KEY=MSG91_KEY

\# Email (for receipts)

SMTP_HOST=smtp.sendgrid.net

SMTP_PORT=587

SMTP_USER=apikey

SMTP_PASS=SENDGRID_API_KEY

## **10.2 Deployment Checklist**

| **Step**                   | **Command / Action**                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| 1\. Build image            | docker compose -f docker-compose.prod.yml build api worker                                       |
| 2\. Run database migration | docker compose exec api npx prisma migrate deploy                                                |
| 3\. Start all containers   | docker compose -f docker-compose.prod.yml up -d                                                  |
| 4\. Verify health          | curl <https://quinckle.com/health> → should return { status: "ok" }                              |
| 5\. Test QR scan           | Scan a real QR code with your phone. Confirm menu loads and session token is returned.           |
| 6\. Test order flow        | Place a test order. Confirm it appears on kitchen display and diner gets WebSocket update.       |
| 7\. Test payment           | Complete a test payment with Razorpay test card 4111111111111111. Confirm receipt email arrives. |
| 8\. Monitor logs           | docker compose logs -f api \| grep ERROR                                                         |

_- End of Document -_

Quinckle QR Dine-In System | <contact@quinckle.com> | <www.quinckle.com>

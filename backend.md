**QUINCKLE**

India's Complete Dine-Out Ecosystem

**Technical Architecture Document**

April 2026 - MVP Launch Plan - Kolkata

| **Node.js + Fastify** | **PostgreSQL + Redis** | **Docker + AWS** | **Cloudflare Edge** |
| --------------------- | ---------------------- | ---------------- | ------------------- |

Prepared by: Quinckle Engineering Team | <contact@quinckle.com>

# **1\. Executive Summary**

Quinckle is India's first full-stack dine-out platform combining AI-powered restaurant discovery, real-time table booking, QR-based dine-in ordering, and verified reviews. This document defines the complete technical architecture required to build and launch the Quinckle MVP in Kolkata by end of April 2026.

| **Tech Stack**<br><br>Backend: Node.js + Fastify<br><br>Database: PostgreSQL via Prisma ORM<br><br>Cache: Redis (seats, sessions, menus)<br><br>Search: Elasticsearch<br><br>Frontend: React Native + React Web<br><br>Payments: Razorpay | **Infrastructure**<br><br>Containers: Docker + docker-compose<br><br>Server: AWS EC2 Mumbai (ap-south-1)<br><br>Edge: Cloudflare CDN + Tunnel<br><br>CI/CD: GitHub Actions<br><br>Monitoring: Sentry + Datadog logs<br><br>Notifications: MSG91 + Firebase FCM |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

# **2\. System Architecture**

The Quinckle backend uses a layered architecture with 6 distinct tiers. Every request from a diner's phone travels through each tier in sequence - from Cloudflare at the edge, through the Fastify gateway, into the relevant service, and down to the data layer.

## **2.1 The 6 Architecture Tiers**

| **Tier**             | **Purpose and components**                                                                          |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| Tier 1 - Clients     | Diner App (React Native), Restaurant Dashboard (React Web), QR Dine-In (Mobile Web), Admin Panel    |
| Tier 2 - Edge        | Cloudflare: CDN caching, DDoS protection, SSL termination, rate limiting, Cloudflare Tunnel         |
| Tier 3 - API Gateway | Fastify: JWT verification, JSON schema validation, request logging, route dispatch                  |
| Tier 4 - Services    | Auth, Booking, Orders, Payments, Restaurant, AI Search, Reviews, Notifications, Analytics           |
| Tier 5 - Data        | PostgreSQL (core data), Redis (cache + seats), Elasticsearch (search + geo), Cloudflare R2 (images) |
| Tier 6 - Infra       | Docker containers, AWS EC2 Mumbai, GitHub Actions CI/CD, Sentry error tracking, Datadog logs        |

## **2.2 Real-Time Booking Flow - Step by Step**

This is the most critical flow in Quinckle and your core differentiator over Zomato/Swiggy. The entire flow completes in under 100ms.

| **Step** | **Component** | **Action**                          | **Why**                                      |
| -------- | ------------- | ----------------------------------- | -------------------------------------------- |
| 1        | Diner App     | POST /bookings with JWT             | Schema validated instantly, no DB hit yet    |
| 2        | Cloudflare    | DDoS check + rate limit             | Blocks abuse before reaching your server     |
| 3        | Fastify       | Verify JWT, validate body schema    | Rejects bad requests early, saves DB calls   |
| 4        | Redis         | DECRBY seats atomically             | Atomic prevents double-booking under load    |
| 5        | PostgreSQL    | Prisma creates booking record       | Persistent storage of confirmed booking      |
| 6        | BullMQ        | Queue SMS + push notification job   | Async - user gets fast response, SMS follows |
| 7        | WebSocket     | Broadcast new seat count to clients | All connected apps update seat display live  |
| 8        | Response      | 201 Confirmed + booking details     | Total round-trip approx. 60-80ms             |

**Key insight:** Redis DECRBY is atomic. Even if 500 users click Book simultaneously during Durga Puja, Redis processes one at a time. The first user gets the seat, the rest get a 409 response. Double-booking is impossible.

## **2.3 All Services and Their Responsibilities**

| **Service**   | **What it does**                                                                                      |
| ------------- | ----------------------------------------------------------------------------------------------------- |
| Auth          | User registration, login, OTP via MSG91, JWT token generation and refresh                             |
| Restaurant    | Restaurant CRUD, menu management, table configuration, opening hours, partner onboarding              |
| Booking       | Real-time seat availability via Redis, booking creation, modification, cancellation, no-show handling |
| Orders        | Pre-order meals, QR dine-in ordering, order status tracking via WebSocket, kitchen queue              |
| Payments      | Razorpay integration, QR-based payment, 5% commission calculation, receipt generation, refunds        |
| AI Search     | Mood and intent-based search using OpenAI embeddings, geo-based filtering, restaurant ranking         |
| Reviews       | Verified review creation (only completed-visit diners), ratings, restaurant response management       |
| Notifications | Push notifications via Firebase FCM, SMS via MSG91, email confirmations, booking reminders            |
| Analytics     | Restaurant dashboard: daily covers, revenue, table turnover rate, peak hours, menu performance        |

# **3\. Features Architecture**

This section maps each Quinckle product feature to its exact technical implementation. Use this as your build reference for each feature.

## **3.1 AI-Powered Restaurant Search**

Users can search with natural language such as "date night rooftop 8 PM Kolkata". The system converts this to a structured query and returns ranked results.

| **Component**   | **Implementation**                                                                           |
| --------------- | -------------------------------------------------------------------------------------------- |
| Text embedding  | User query sent to OpenAI text-embedding-3-small API, converted to 1536-dimension vector     |
| Vector matching | Elasticsearch k-NN search finds restaurants with similar description vectors                 |
| Geo filter      | Elasticsearch geo_distance filter: only restaurants within user-specified radius             |
| Ranking         | Custom scoring: match score x 0.4 + rating x 0.3 + availability x 0.3                        |
| Caching         | Redis caches popular queries for 5 minutes - same query served instantly without OpenAI call |
| Fallback        | If OpenAI is unavailable, fall back to Elasticsearch full-text search on name and cuisine    |

## **3.2 QR Dine-In Flow**

When a diner sits at a table, they scan the QR code. This opens a mobile web page - no app download needed - where they browse the menu, order, track their food, and pay.

| **Step**     | **Technical Implementation**                                                              |
| ------------ | ----------------------------------------------------------------------------------------- |
| QR scan      | Each table has a unique QR: quinckle.com/dine/{restaurantId}/{tableId}                    |
| Menu load    | Menu fetched from Redis cache - always up to date, loads in under 200ms                   |
| Order place  | POST /orders - creates order, triggers kitchen WebSocket event                            |
| Status track | WebSocket connection keeps status live: Received, Preparing, Ready, Served                |
| Payment      | Razorpay payment link generated on demand - diner pays from phone, no card machine needed |
| Receipt      | Auto-generated PDF receipt, emailed to diner, saved in booking history                    |

## **3.3 Verified Reviews System**

Only diners who have completed a verified visit can leave a review. This prevents fake reviews entirely - Quinckle's key trust advantage over competitors.

| **Rule**     | **Implementation**                                                             |
| ------------ | ------------------------------------------------------------------------------ |
| Eligibility  | booking.status === completed AND no existing review for this visit ID          |
| Time window  | Review can be submitted up to 48 hours after checkout time                     |
| Rating calc  | Rolling average updated in Redis on each review, then persisted to PostgreSQL  |
| Photo upload | Diner can upload up to 5 photos - stored in Cloudflare R2, CDN-served          |
| Response     | Restaurant owner can post one reply per review via the dashboard               |
| Moderation   | Auto-flag reviews containing banned words - manual review queue in admin panel |

## **3.4 Restaurant Analytics Dashboard**

This is the core value proposition for the Rs. 199/month subscription. Restaurant partners see real-time performance data they cannot get anywhere else.

| **Metric**       | **How it is calculated**                                                         |
| ---------------- | -------------------------------------------------------------------------------- |
| Daily covers     | COUNT of bookings per day, compared to same day last week - shown as a bar chart |
| Table turnover   | Average of (checkout_time - checkin_time) per table per day                      |
| Peak hours       | Bookings grouped by hour of day - heatmap showing when to staff up               |
| Revenue          | Sum of all completed order totals, split by dine-in versus pre-order             |
| No-show rate     | Bookings with status no-show divided by total bookings, rolling 30 days          |
| Menu performance | Most ordered items, items abandoned in cart, least ordered items this week       |

# **4\. Docker Architecture**

Docker packages your application and all its dependencies into isolated containers. This guarantees the app runs identically on your laptop, on the AWS server, and on any future server. Think of each container as a sealed, self-contained box that has everything it needs inside.

## **4.1 Why Docker for Quinckle**

| **Benefit**     | **What it means in practice**                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------ |
| Consistency     | Eliminates the works on my machine problem. App behaves identically on dev laptop and production AWS server. |
| Isolation       | If the PostgreSQL container crashes, it does not affect the Redis container or the Fastify API container.    |
| Easy scaling    | During Durga Puja traffic spikes, add more API containers without touching the database container.           |
| Fast deploys    | git pull + docker compose up deploys new code in under 60 seconds with no server reconfiguration.            |
| Reproducibility | Any new developer can clone the repo and run the full stack locally in under 5 minutes.                      |

## **4.2 The 5-Container Production Stack**

All 5 containers run on one AWS EC2 instance for the MVP launch. They communicate through a private internal Docker network. No container ports are exposed to the public internet.

| **Container** | **Image used**                | **Role**                                                  | **Port**        |
| ------------- | ----------------------------- | --------------------------------------------------------- | --------------- |
| api           | Built from your Dockerfile    | Fastify application server - handles all API requests     | 3000 (internal) |
| worker        | Built from your Dockerfile    | BullMQ background job processor - SMS, push, analytics    | None            |
| postgres      | postgres:15-alpine            | PostgreSQL database - all persistent data                 | 5432 (internal) |
| redis         | redis:7-alpine                | Cache, session store, real-time seat counters             | 6379 (internal) |
| cloudflared   | cloudflare/cloudflared:latest | Cloudflare Tunnel - secure outbound connection to CF edge | None (outbound) |

**Security note:** No port is ever opened to the public internet. The cloudflared container makes an outbound connection to Cloudflare. All user traffic arrives through Cloudflare's network. Your server IP is never exposed and can never be directly attacked.

## **4.3 The Dockerfile - Multi-Stage Build**

The production Dockerfile uses 3 build stages. This reduces the final image from about 500MB down to about 150MB by removing all build tools and development dependencies from the final image.

\# Stage 1 - Install production dependencies only

FROM node:20-alpine AS deps

WORKDIR /app

COPY package\*.json ./

RUN npm ci --omit=dev

\# Stage 2 - Copy source code

FROM node:20-alpine AS build

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules

COPY . .

\# Stage 3 - Final lean production image

FROM node:20-alpine AS production

\# Security: never run as root user

RUN addgroup -S quinckle && adduser -S quinckle -G quinckle

WORKDIR /app

COPY --from=build --chown=quinckle:quinckle /app/node_modules ./node_modules

COPY --from=build --chown=quinckle:quinckle /app/src ./src

COPY --from=build --chown=quinckle:quinckle /app/package.json .

USER quinckle

EXPOSE 3000

STOPSIGNAL SIGTERM

\# Docker restarts container automatically if health check fails

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \\

CMD wget -qO- <http://localhost:3000/health> || exit 1

CMD \["node", "src/server.js"\]

| **Dockerfile line** | **Why it is there**                                                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| FROM node:20-alpine | Alpine Linux is only 5MB. Much smaller and more secure than the full ubuntu-based node image.                                                      |
| npm ci --omit=dev   | Installs only production packages. Excludes jest, nodemon, eslint - not needed at runtime.                                                         |
| Multi-stage build   | Stages 1 and 2 include build tools. Stage 3 copies only the finished output - no build tools in production.                                        |
| adduser quinckle    | The container runs as a non-root user. If the container is compromised, the attacker cannot get root access to the host.                           |
| HEALTHCHECK         | Docker monitors the /health endpoint every 30 seconds and automatically restarts the container if it stops responding.                             |
| STOPSIGNAL SIGTERM  | Fastify receives a graceful shutdown signal. It finishes processing all in-flight requests before stopping - zero dropped requests during deploys. |

## **4.4 docker-compose.prod.yml - Full Production Stack**

This file starts all 5 containers with correct dependencies, health checks, restart policies, data volumes, and networking. Run this file on your AWS server to bring the entire Quinckle stack online.

version: "3.8"

services:

cloudflared:

image: cloudflare/cloudflared:latest

command: tunnel --no-autoupdate run --token \${CF_TUNNEL_TOKEN}

restart: unless-stopped

depends_on:

api:

condition: service_healthy

networks: \[internal\]

api:

build:

context: .

target: production

restart: unless-stopped

env_file: .env.prod

environment:

NODE_ENV: production

depends_on:

postgres:

condition: service_healthy

redis:

condition: service_healthy

healthcheck:

test: \["CMD", "wget", "-qO-", "<http://localhost:3000/health"\>]

interval: 30s

timeout: 5s

retries: 3

start_period: 15s

networks: \[internal\]

logging:

driver: json-file

options:

max-size: 10m

max-file: "3"

worker:

build:

context: .

target: production

command: node src/worker.js

restart: unless-stopped

env_file: .env.prod

depends_on:

postgres:

condition: service_healthy

redis:

condition: service_healthy

networks: \[internal\]

postgres:

image: postgres:15-alpine

restart: unless-stopped

environment:

POSTGRES_DB: \${DB_NAME}

POSTGRES_USER: \${DB_USER}

POSTGRES_PASSWORD: \${DB_PASSWORD}

volumes:

\- pgdata:/var/lib/postgresql/data

healthcheck:

test: \["CMD-SHELL", "pg_isready -U \${DB_USER}"\]

interval: 10s

timeout: 5s

retries: 5

networks: \[internal\]

redis:

image: redis:7-alpine

restart: unless-stopped

command: >

redis-server

\--requirepass \${REDIS_PASSWORD}

\--appendonly yes

\--maxmemory 256mb

\--maxmemory-policy allkeys-lru

volumes:

\- redisdata:/data

healthcheck:

test: \["CMD", "redis-cli", "-a", "\${REDIS_PASSWORD}", "ping"\]

interval: 10s

timeout: 3s

retries: 5

networks: \[internal\]

volumes:

pgdata:

redisdata:

networks:

internal:

driver: bridge

| **Key setting**            | **What it does**                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------------------- |
| restart: unless-stopped    | Container automatically restarts if it crashes. Only stops when you manually run docker compose down. |
| condition: service_healthy | API container does not start until PostgreSQL and Redis have passed their health checks.              |
| volumes: pgdata            | Database data is stored in a named Docker volume. Running docker compose down never deletes it.       |
| networks: internal         | All containers share a private network. They reach each other by service name, e.g. postgres:5432.    |
| logging max-size: 10m      | Log files are automatically rotated at 10MB, keeping only the last 3 files. Prevents disk filling up. |
| appendonly yes (Redis)     | Redis writes every operation to disk. Data survives a container restart or server reboot.             |

# **5\. Deployment on AWS Mumbai - Step by Step**

Follow these steps in order to get Quinckle live. Allow 1-2 hours for the first deployment.

## **5.1 AWS EC2 Instance Settings**

| **Setting**      | **Value**                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------- |
| Instance type    | t3.medium - 2 vCPU, 4GB RAM. Handles 0 to 50,000 users comfortably.                                           |
| Region           | ap-south-1 (Mumbai) - lowest latency for Kolkata users, approximately 20ms ping.                              |
| Operating system | Ubuntu 22.04 LTS - stable, widely supported, good Docker compatibility.                                       |
| Storage          | 30GB GP3 SSD - fast and cost-effective. Increase to 50GB if you expect heavy image uploads.                   |
| Security group   | Allow SSH port 22 from your IP only. No other inbound ports needed - all traffic comes via Cloudflare Tunnel. |

## **5.2 Server Setup - Run These Commands Once**

\# 1. Connect to your EC2 server

ssh -i quinckle.pem ubuntu@your-ec2-ip

\# 2. Install Docker

sudo apt update && sudo apt install -y docker.io docker-compose-plugin

sudo usermod -aG docker ubuntu

newgrp docker

\# 3. Clone your repository

git clone <https://github.com/your-org/quinckle-backend.git>

cd quinckle-backend

\# 4. Create your production secrets file

nano .env.prod

\# Paste all your real passwords and API keys here

\# 5. Build images and start all containers

docker compose -f docker-compose.prod.yml up -d --build

\# 6. Confirm everything is healthy

docker compose -f docker-compose.prod.yml ps

\# 7. Watch the API logs

docker compose -f docker-compose.prod.yml logs -f api

## **5.3 Deploying New Code**

Every time you push a code change and want it live on the server, run these commands. This restarts only the app containers, not the database or Redis, so data is never affected.

\# On the server - deploy new code

cd quinckle-backend

git pull origin main

docker compose -f docker-compose.prod.yml up -d --build --no-deps api worker

docker image prune -f

\# Confirm new version is running

docker compose -f docker-compose.prod.yml ps

## **5.4 Day-to-Day Operations Commands**

| **Task**             | **Command**                                                                                   |
| -------------------- | --------------------------------------------------------------------------------------------- |
| Check all containers | docker compose -f docker-compose.prod.yml ps                                                  |
| Read live API logs   | docker compose -f docker-compose.prod.yml logs -f api                                         |
| Read worker logs     | docker compose -f docker-compose.prod.yml logs -f worker                                      |
| Restart API only     | docker compose -f docker-compose.prod.yml restart api                                         |
| Open database shell  | docker compose -f docker-compose.prod.yml exec postgres psql -U quinckle_app -d quinckle_prod |
| Ping Redis           | docker compose -f docker-compose.prod.yml exec redis redis-cli ping                           |
| Stop everything      | docker compose -f docker-compose.prod.yml down                                                |
| Check disk usage     | docker system df                                                                              |
| Clean up old images  | docker image prune -f                                                                         |

# **6\. April 2026 - Week-by-Week Build Plan**

This plan is designed to deliver a working, testable product at the end of each week. The order is strict - each week's work depends on the previous week being complete.

| **Week** | **Dates** | **What to Build**                                                                                                                            | **End Goal**                                     |
| -------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Week 1   | Apr 1-7   | Docker scaffold, Dockerfile, docker-compose, Fastify app.js setup, /health endpoint, PostgreSQL + Redis containers, GitHub repo + Actions CI | Full dev stack runs locally with one command     |
| Week 1   | Apr 1-7   | Auth service: user registration, login, OTP via MSG91, JWT tokens, @fastify/jwt plugin, authenticate hook                                    | Users can sign up and log in                     |
| Week 2   | Apr 8-14  | Restaurant CRUD API, menu management, table configuration, Elasticsearch indexing, basic location-based search                               | Restaurant listings and menus working            |
| Week 2   | Apr 8-14  | Real-time booking: Redis seat counters, DECRBY atomic lock, booking API, WebSocket server, seat availability broadcast                       | Real-time table booking confirmed in under 100ms |
| Week 3   | Apr 15-21 | QR code generation per table, mobile web dine-in page, order placement API, BullMQ job queue, order status via WebSocket                     | Full QR scan-to-order flow working               |
| Week 3   | Apr 15-21 | Razorpay integration, payment link generation, webhook handling, 5% commission calculation, receipt PDF generation                           | End-to-end payments processing live              |
| Week 4   | Apr 22-28 | Verified review system, review eligibility check, OpenAI search embeddings, mood-based restaurant search via Elasticsearch                   | AI search and verified reviews live              |
| Week 4   | Apr 22-28 | AWS EC2 setup, Cloudflare Tunnel config, production deployment, smoke testing all flows, monitoring setup, Kolkata soft launch               | Quinckle is live in Kolkata                      |

## **6.1 Build Priority - Do These in Exact Order**

- Docker stack + project scaffold - everything else runs inside Docker
- Auth service - every other service needs a logged-in user
- Restaurant and menu APIs - Booking cannot work without restaurants
- Real-time booking with WebSocket - Quinckle's core differentiator, test thoroughly
- QR dine-in and orders - requires restaurant data and auth to exist
- Razorpay payments - requires orders to exist
- AI search and reviews - can be added after the core booking flow is solid
- Production deployment to AWS - final step, do after all features are tested

# **7\. Infrastructure Cost Estimate**

Monthly cost for the Kolkata MVP launch. These numbers are for the initial 0 to 50,000 user range. Costs scale predictably after that.

| **Service**       | **Provider**       | **Monthly cost**     | **Notes**                                          |
| ----------------- | ------------------ | -------------------- | -------------------------------------------------- |
| EC2 t3.medium     | AWS Mumbai         | Rs. 3,500            | Handles 0-50K users. Upgrade to t3.large at scale. |
| PostgreSQL        | Self-hosted Docker | Rs. 0                | Runs in Docker on EC2. Move to RDS at 50K+ users.  |
| Redis             | Self-hosted Docker | Rs. 0                | Runs in Docker on EC2. Upstash Redis at scale.     |
| Cloudflare        | Cloudflare         | Rs. 0 (Free plan)    | Upgrade to Pro at Rs. 1,700/mo for advanced rules. |
| Domain + SSL      | Namecheap + CF     | Rs. 700/year         | SSL certificate is free via Cloudflare.            |
| MSG91 OTP SMS     | MSG91              | Rs. 1,000            | Covers approximately 2,000 OTP sends per month.    |
| Firebase FCM      | Google             | Rs. 0 (Free)         | Push notifications free up to 1 million per month. |
| OpenAI API        | OpenAI             | Rs. 2,000            | For AI search embeddings, approx. 100K queries.    |
| Sentry monitoring | Sentry             | Rs. 0 (Free tier)    | Error tracking, upgrade when team grows.           |
| Total             |                    | Approx. Rs. 7,200/mo | Covers first 50,000 users in Kolkata.              |

**Scale-up trigger:** When you reach 50K users, add: AWS RDS PostgreSQL (Rs. 2,500/mo) and a second EC2 instance (Rs. 3,500/mo). At 2L users move to ECS Fargate for automatic scaling during Durga Puja spikes.

# **8\. Pre-Launch Security Checklist**

Complete every item on this checklist before going live. Each one protects your users, their data, and the Quinckle platform.

| **Rule**                        | **How to implement it**                                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Never run containers as root    | Dockerfile: RUN adduser quinckle, then USER quinckle before CMD                                                                             |
| Never expose DB ports publicly  | postgres and redis have no ports: mapping in docker-compose. Only api container port 3000 is used internally.                               |
| Never commit .env files         | Add .env and .env.prod to .gitignore immediately. Use GitHub Secrets for CI/CD.                                                             |
| Use strong passwords everywhere | DB password and Redis password should be minimum 32 random characters. Use a password manager.                                              |
| Strong JWT secret               | JWT_SECRET must be minimum 32 characters. Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"           |
| Cloudflare rate limiting        | Set rate limit rule: max 10 requests per minute per IP on /api/auth/login and /api/auth/otp routes.                                         |
| Fastify schema validation       | Every route must have a JSON schema defined. Fastify rejects any request that does not match - no raw user input ever reaches the database. |
| HTTPS everywhere                | Cloudflare provides SSL termination. Never serve HTTP responses. Set Cloudflare SSL mode to Full Strict.                                    |
| Health check endpoint           | GET /health must return { status: "ok" } with HTTP 200. Docker uses this to auto-restart unhealthy containers.                              |
| Graceful shutdown               | STOPSIGNAL SIGTERM in Dockerfile ensures Fastify finishes in-flight requests before stopping during deployments.                            |

_- End of Document -_

Quinckle - Transforming how India discovers and experiences dining.

<contact@quinckle.com> | <www.quinckle.com>

# Backend Changes Needed — QuinckleCrew App

All changes the backend team needs to make for the QuinckleCrew crew app to work correctly in production. No database schema changes required for any of these.

---

## 1. 🔴 Bug Fix — OTP Verification Always Failing (Critical)

**File:** `src/services/crew/message-central.service.ts`

**Problem:**
The `verifyOtp` method does not send the `authToken` header when calling Message Central's `/verification/v3/validateOtp` endpoint. Message Central returns HTTP 401, so all crew member OTP verifications fail with `OTP_VERIFY_FAILED`. Crew members can receive the OTP on their phone but cannot log in.

**Current code (broken):**
```typescript
const response = await this.requestWithRetry(endpoint.toString(), {
  method: 'GET',
})
```

**Fix — add the authToken header:**
```typescript
const response = await this.requestWithRetry(endpoint.toString(), {
  method: 'GET',
  headers: {
    authToken: config.MESSAGE_CENTRAL_AUTH_TOKEN,
  },
})
```

**Where:** Inside the `verifyOtp` method, on the `requestWithRetry` call to `/verification/v3/validateOtp`.

---

## 2. 🟡 New Endpoint — Restaurant Menu for Staff Ordering

**File:** `src/routes/v1/restaurant.routes.ts`

**Problem:**
There is no GET endpoint to fetch menu items for a restaurant. Staff need to view the menu and add items to a table's order from the crew app. The existing `GET /api/v1/restaurants/:idOrSlug` only returns the restaurant record, not its menu items.

**Add this route** inside the `restaurantRoutes` plugin, after the existing `GET /:idOrSlug` route:

```typescript
// Public menu endpoint — used by crew app for staff-placed orders
fastify.get('/:id/menu', async (request) => {
  const { id } = z.object({ id: z.string().min(1) }).parse(request.params)
  const menuItems = await restaurantService.getMenuGrouped(id)
  return { success: true, data: { menuItems } }
})
```

**Full endpoint:**
```
GET /api/v1/restaurants/:id/menu
Auth: None (public)
Params: id — the restaurant's UUID
```

**Response format:**
```json
{
  "success": true,
  "data": {
    "menuItems": [
      {
        "id": "item_abc123",
        "name": "Butter Chicken",
        "price": "320.00",
        "category": "Mains",
        "isVeg": false,
        "isAvailable": true,
        "imageUrl": "https://..."
      }
    ]
  }
}
```

**Note:** `RestaurantService.getMenuGrouped(restaurantId)` already exists — this just exposes it via a route.

---

## 3. 🟢 Improvement — Razorpay Plugin: Graceful Startup Without Keys

**File:** `src/modules/payments/razorpay.plugin.ts`

**Problem:**
If `RAZORPAY_KEY_ID` or `RAZORPAY_KEY_SECRET` is missing or empty, the server crashes on startup with `Error: 'key_id' or 'oauthToken' is mandatory`. This is not an issue on production where keys are configured, but causes problems in any environment without Razorpay keys set up.

**Current code (crashes on startup):**
```typescript
async function razorpayPlugin(fastify: FastifyInstance): Promise<void> {
  if (!RAZORPAY_CONFIG.keyId || !RAZORPAY_CONFIG.keySecret) {
    fastify.log.warn('Razorpay keys not configured');
  }
  const razorpay = new Razorpay({
    key_id: RAZORPAY_CONFIG.keyId,
    key_secret: RAZORPAY_CONFIG.keySecret,
  });
  fastify.decorate('razorpay', razorpay);
}
```

**Fix — skip initialization if keys are missing:**
```typescript
async function razorpayPlugin(fastify: FastifyInstance): Promise<void> {
  if (!RAZORPAY_CONFIG.keyId || !RAZORPAY_CONFIG.keySecret) {
    fastify.log.warn('Razorpay keys not configured — payment endpoints will be non-functional');
    fastify.decorate('razorpay', null as unknown as Razorpay);
    return;
  }
  const razorpay = new Razorpay({
    key_id: RAZORPAY_CONFIG.keyId,
    key_secret: RAZORPAY_CONFIG.keySecret,
  });
  fastify.decorate('razorpay', razorpay);
  fastify.log.info('Razorpay SDK initialized');
}
```

---

## Summary

| # | Priority | File | Type | Needed for |
|---|---|---|---|---|
| 1 | 🔴 Critical | `src/services/crew/message-central.service.ts` | Bug fix | Crew login (OTP verify) |
| 2 | 🟡 Required | `src/routes/v1/restaurant.routes.ts` | New endpoint | Staff menu & ordering |
| 3 | 🟢 Nice to have | `src/modules/payments/razorpay.plugin.ts` | Improvement | Server stability without Razorpay keys |

**No database migrations required for any of these changes.**

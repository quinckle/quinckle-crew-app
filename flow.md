### 1. Authentication (`/api/auth`)

**POST /api/auth/login**
* [cite_start]**Description:** Handles crew login and identifies the user as Staff or Cook[cite: 1].
* [cite_start]**Request:** `{ "phone_number": "string", "otp": "string" }`[cite: 3].
* **Response:** `{ "token": "string", "user_id": "uuid", "role": "staff | cook" }`
* [cite_start]*Note:* The application uses the role to log the user into the Kitchen view or Staff View[cite: 1, 3].

---

### 2. Kitchen View APIs (`/api/kitchen`)

**GET /api/kitchen/orders**
* **Description:** Fetches active orders for the kitchen.
* [cite_start]**Response:** Array of orders where the cook can see the order id and the table from where it is ordered[cite: 5].

**PATCH /api/kitchen/items/{item_id}/status**
* **Description:** Updates the status per item of the order, acting like a todo checklist[cite: 7].
* [cite_start]**Request:** `{ "status": "preparing | ready_to_serve" }`[cite: 6].

**PATCH /api/kitchen/orders/{order_id}/status**
* **Description:** Allows the cook to mark the order as done and ready to serve[cite: 8].
* [cite_start]**Request:** `{ "status": "ready_to_serve" }`[cite: 8].

---

### 3. Staff View APIs: Table & Session Management (`/api/tables`, `/api/sessions`)

**GET /api/tables**
* **Description:** Retrieves the current status of all tables.
* [cite_start]**Response:** Array of tables so staff can see which tables are occupied [cite: 7] [cite_start]and which tables are currently free[cite: 8].

**POST /api/sessions/start**
* **Description:** Starts a new session for any table.
* **Request:** `{ "table_id": "uuid" }`

**POST /api/sessions/end**
* **Description:** Ends active sessions of any table[cite: 9].
* **Request:** `{ "session_id": "uuid" }`

**PATCH /api/sessions/{session_id}/extend**
* **Description:** Allows staff to extend the session time limit for the user[cite: 17]. This is used if the session is about to end and the user is not finished yet[cite: 18].
* **Request:** `{ "additional_minutes": "integer" }`

---

### 4. Staff View APIs: Order Management (`/api/staff/orders`)

**POST /api/staff/orders**
* [cite_start]**Description:** Staff can get the order from their system for the user if the user doesn't want to do it themselves[cite: 10]. [cite_start]This is also used if the user faces a problem with the QR scan and ordering on their own[cite: 11].
* **Request:** `{ "table_id": "uuid", "items": [...] }`

**GET /api/staff/orders/active**
* **Description:** Retrieves active orders to monitor their status.
* [cite_start]**Response:** Allows staff to see which table ordered what and what to serve them[cite: 19]. [cite_start]They can also see at which state the order is by the cook[cite: 20].

**PATCH /api/staff/items/{item_id}/serve**
* [cite_start]**Description:** After an order is prepared, staff have the option per item to mark them as served[cite: 15]. [cite_start]This action will also update to the user side[cite: 16].
* **Request:** `{ "status": "served" }`

---

### 5. Payment Processing (`/api/payments`)

**POST /api/payments/cash**
* [cite_start]**Description:** The user can pay the bill to a Staff by cash[cite: 12], [cite_start]The staff will have the option to mark the order as paid by cash[cite: 13].
* **Request:** `{ "order_id": "uuid", "staff_id": "uuid", "amount": "decimal" }`
* **Response:** Marks the order as paid. [cite_start]The admin will be able to see which Staff member collected how much cash[cite: 14].






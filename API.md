# Brew & Bite — API Documentation

Backend contract for the Brew & Bite ordering + team-admin system. All frontends
(storefront, admin panel) code against this document.

- **Base URL (persistent):** `https://18npv6obi8-8820.hosted.obvious.ai`
- **Base URL (local dev):** `http://localhost:8820`
- **App directory:** `/home/user/work/brew-and-bite/` · start: `node server.js` (port 8820)

> ⚠️ Do **not** recreate this app under `/home/user/project/` — the project mirror
> renames files written there (e.g. `package.json` → `package.fl_X5tCUiz0.json`),
> which breaks npm/node. Everything lives in `/home/user/work/brew-and-bite/`.

---

## Conventions

- All request/response bodies are JSON unless noted (`POST /api/upload` is multipart).
- Timestamps are ISO 8601 UTC, e.g. `"2026-10-28T08:44:45.804Z"`.
- Prices are **integers in SYP** (e.g. `30000`). USD display is a client-side concern
  using `settings.exchange_rate_syp_per_usd`.
- IDs are integers. `sort_order` is an integer; lower comes first.
- **Every order total is computed server-side from database prices.** Any
  client-sent `total_syp` is ignored.
- Errors are always JSON: `{ "error": "<message>" }`, sometimes with
  `details` (array of messages or an object).

### Auth model

- `POST /api/auth/login` sets an `HttpOnly` session cookie (`bb.sid`).
- Endpoints marked **auth** return `401 {"error":"Authentication required. Log in via POST /api/auth/login."}`
  without a valid session cookie. Send the cookie on every admin request
  (browsers do this automatically; `credentials: 'include'` with fetch).
- Only one team account exists (`admin`). Password changes apply immediately.

---

## Public endpoints (no auth)

### GET /api/health

Liveness probe.

```json
{ "ok": true, "service": "brew-and-bite", "time": "2026-10-28T08:44:16.116Z" }
```

### GET /api/menu

Categories with their **available, non-hidden** items, ordered by `sort_order`.
Returns `{"categories":[]}` before any content is added. Item fields omit
`is_available`/`is_hidden` (always true/false here by construction).

```json
{
  "categories": [
    {
      "id": 1, "name_ar": "قهوة", "name_en": "Coffee",
      "sort_order": 1, "card_image": "",
      "items": [
        {
          "id": 1, "name_ar": "قهوة عربية", "name_en": "Arabic Coffee",
          "desc_ar": "قهوة عربية أصيلة", "desc_en": "",
          "price_syp": 30000, "image": "", "is_offer": false,
          "is_popular": true, "sort_order": 1
        }
      ]
    }
  ]
}
```

### GET /api/settings

Public site settings (hero banner, contact, exchange rate).

```json
{
  "settings": {
    "exchange_rate_syp_per_usd": "14000",
    "phone": "+963 31 000 000",
    "opening_hours_ar": "", "opening_hours_en": "",
    "hero_image": "",
    "hero_title_ar": "برو آند بايت", "hero_title_en": "",
    "hero_subtitle_ar": "", "hero_subtitle_en": "",
    "hero_chips_ar": "", "hero_chips_en": "",
    "hero_cta_ar": "", "hero_cta_en": ""
  }
}
```

### POST /api/orders

Create an order. Public. Validates input, verifies each item exists and is
orderable (not hidden, available), computes `total_syp` server-side, snapshots
name/price per line.

**Request**

```json
{
  "customer_name": "محمد العلي",
  "customer_phone": "+963 944 123 456",
  "address": "حي الوعر، حمص",
  "note": "بدون سكر",
  "items": [ { "item_id": 1, "qty": 2 } ]
}
```

`customer_name` (2–60 chars) and `customer_phone` (5–40 chars of digits/spaces/`+ - ( )`)
are required. `address`, `note` optional. `items` must be a non-empty array of
`{ item_id: int ≥ 1, qty: int ≥ 1 }` (max 100 lines, qty ≤ 500).

**Response `201`** (note: total is `2 × 30000`, not any client-sent value)

```json
{
  "order": {
    "id": 1, "customer_name": "محمد العلي", "customer_phone": "+963 944 123 456",
    "address": "حي الوعر، حمص", "note": "بدون سكر",
    "total_syp": 60000, "status": "new",
    "created_at": "2026-10-28T08:44:45.804Z", "updated_at": "2026-10-28T08:44:45.804Z",
    "items": [ { "item_id": 1, "name_ar": "قهوة عربية", "unit_price_syp": 30000, "qty": 2 } ]
  }
}
```

Errors: `400` validation failure, e.g. missing phone
`{"error":"customer_phone is required (5-40 characters: digits, spaces, + - ( ))."}`
or unorderable item
`{"error":"Item 9999 cannot be ordered (it may not exist, be hidden, or be unavailable)."}`

### Static files

- `/` → `public/index.html` (storefront placeholder; real UI ships separately)
- `/admin/` → `public/admin/index.html` (team panel placeholder)
- `/uploads/<file>` → uploaded images, e.g. `/uploads/mvrvcdnv-180f30c9ae1e.png` (`image/png`)
- Unknown `/api/*` → `404 {"error":"No such endpoint: GET /api/nope"}`

---

## Auth endpoints

### POST /api/auth/login

**Request** `{ "username": "admin", "password": "…" }`

**200** `{ "user": { "id": 1, "username": "admin" } }` + sets `bb.sid` HttpOnly cookie.
**401** `{"error":"Invalid username or password."}`

### POST /api/auth/logout

**auth.** Destroys the session. `{"ok":true}`

### GET /api/auth/me

**auth.** `{ "user": { "id": 1, "username": "admin" } }` or
`401 {"error":"Not logged in."}`

---

## Admin — categories (auth)

`item_count` is included on list/detail responses.

### GET /api/categories

```json
{
  "categories": [
    { "id": 2, "name_ar": "مشروبات باردة", "name_en": "Cold Drinks", "sort_order": 0, "card_image": "", "item_count": 0, "created_at": "…", "updated_at": "…" },
    { "id": 1, "name_ar": "قهوة", "name_en": "Coffee", "sort_order": 1, "card_image": "", "item_count": 2, "created_at": "…", "updated_at": "…" }
  ]
}
```

### GET /api/categories/:id

`{"category": { … }}` · `404 {"error":"Category not found."}`

### POST /api/categories

**Request** `{ "name_ar": "قهوة", "name_en": "Coffee", "sort_order": 0, "card_image": "" }`
(`name_ar` or `name_en` required, ≤ 120 chars; `sort_order`/`card_image` optional)

**201** `{"category": {"id": 1, "name_ar": "قهوة", "name_en": "Coffee", "sort_order": 0, "card_image": "", "created_at": "…", "updated_at": "…"}}`

### PUT /api/categories/:id

Same fields, all optional (partials allowed). `{"category": { … }}`

### POST /api/categories/reorder

**Request** `{ "order": [2, 1] }` — full ordering by id; every existing id exactly once.
`{"categories": [ …reordered… ]}` · `400` if ids missing/duplicated/unknown.

### DELETE /api/categories/:id

- Empty category: `{"ok":true,"deleted_items":0}`
- With items and no `?cascade`: `409 {"error":"Category has 2 item(s). Move or delete them first, or retry with ?cascade=true to delete them too."}`
- `?cascade=true`: deletes contained items, `{"ok":true,"deleted_items":1}`

---

## Admin — items (auth)

### GET /api/items

All items (including hidden/unavailable), grouped by `category_id`, then
`sort_order`, then `id`.
`{"items": [ {…item…}, … ]}`

### GET /api/items/:id

`{"item": {…}}` · `404 {"error":"Item not found."}`

Item shape:

```json
{
  "id": 1, "category_id": 1,
  "name_ar": "قهوة عربية", "name_en": "Arabic Coffee",
  "desc_ar": "قهوة عربية أصيلة", "desc_en": "",
  "price_syp": 30000, "image": "",
  "is_offer": false, "is_popular": true, "is_available": true, "is_hidden": false,
  "sort_order": 1, "created_at": "…", "updated_at": "…"
}
```

### POST /api/items

**Request** (required: `category_id` of an existing category, `price_syp` int ≥ 0,
at least one name ≤ 200 chars; optional `desc_ar/desc_en` ≤ 1000, `image` path,
booleans, `sort_order`)

```json
{ "category_id": 1, "name_ar": "قهوة عربية", "name_en": "Arabic Coffee", "desc_ar": "قهوة عربية أصيلة", "price_syp": 25000, "is_popular": true }
```

**201** `{"item": {…}}` · `400` e.g. `{"error":"Validation failed.","details":["category_id must reference an existing category."]}`

### PUT /api/items/:id

Partial update. Example — price change:

`PUT /api/items/1` `{ "price_syp": 30000 }` → `{"item": { … "price_syp": 30000 … }}`

### POST /api/items/reorder

**Request** `{ "category_id": 1, "order": [2, 1] }` — full ordering of that
category's items by id. `{"items": [ …reordered… ]}` · `400` on bad ids/category.

### DELETE /api/items/:id

`{"ok":true}` · `404` if missing.

---

## Admin — settings (auth)

### PUT /api/settings

Partial update of known keys only. Allowed keys: `exchange_rate_syp_per_usd`,
`phone`, `opening_hours_ar`, `opening_hours_en`, `hero_image`, `hero_title_ar`,
`hero_title_en`, `hero_subtitle_ar`, `hero_subtitle_en`, `hero_chips_ar`,
`hero_chips_en`, `hero_cta_ar`, `hero_cta_en`.

**Request** `{ "phone": "+963 31 000 000", "hero_title_ar": "برو آند بايت" }`
**200** `{"settings": { …full settings object… }}`
**400** `{"error":"Unknown setting key(s): hacker_key.","details":{"allowed_keys":[…13 keys…]}}`

---

## Admin — image upload (auth)

### POST /api/upload

`multipart/form-data` with field **`file`**. Allowed: webp, jpg, png. Max 5 MB.
Stored under `data/uploads/`, random unique name.

**200** `{"url":"/uploads/mvrvcdnv-180f30c9ae1e.png","size":70,"content_type":"image/png","original_name":"bb-test.png"}`

Use the returned `url` as `item.image` / `category.card_image` / `settings.hero_image`.

Errors: `401` without session · `400 {"error":"Unsupported file type. Allowed: webp, jpg, png."}` ·
`413 {"error":"Image too large. Max upload size is 5MB."}`

---

## Admin — orders (auth)

### GET /api/orders?status=new,preparing

Live queue. `status` = comma-separated filter; **defaults to `new,preparing`**.
Ordered oldest first (fair queue). Same order shape as order creation, plus full
item lines. Orders appear here until `status` becomes `done`.

### PATCH /api/orders/:id/status

**Request** `{ "status": "preparing" }` — one of `new` | `preparing` | `done`.
Returns `{"order": {…updated…}}`.
`400 {"error":"status must be one of: new, preparing, done."}` · `404` unknown order.

### GET /api/orders/history

All orders with `status = "done"`, newest first. Same shape as the queue.

---

## Admin — account (auth)

### POST /api/account/password

**Request** `{ "current_password": "…", "new_password": "…" }` (new ≥ 8 chars)
**200** `{"ok":true}` — applies immediately.
`400 {"error":"Current password is incorrect."}` or new-password validation message.

---

## Data model (SQLite: `data/brew-and-bite.db`)

| Table | Purpose |
|---|---|
| `categories` | id, name_ar, name_en, sort_order, card_image, timestamps |
| `items` | id, category_id (FK cascade), name_ar/en, desc_ar/en, price_syp, image, is_offer, is_popular, is_available, is_hidden, sort_order, timestamps |
| `settings` | key/value; seeded with `exchange_rate_syp_per_usd=14000` and empty hero/contact fields |
| `accounts` | username, bcrypt-hashed password |
| `orders` | id, customer_name, customer_phone, address, note, total_syp, status (`new\|preparing\|done`), timestamps |
| `order_items` | order_id (FK cascade), item_id, name_ar snapshot, unit_price_syp snapshot, qty |

## Running it

```bash
cd /home/user/work/brew-and-bite
npm install
# first boot seeds the admin account from ADMIN_PASSWORD
ADMIN_PASSWORD='<password>' node server.js   # port 8820
```

Registered hosting (wake-on-request): `https://18npv6obi8-8820.hosted.obvious.ai`
(tmux session `svc-8820`; `--install` re-runs `npm install` on wake).

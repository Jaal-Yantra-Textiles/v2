---
title: "UCP Endpoints"
sidebar_label: "Endpoints"
sidebar_position: 1
---

# UCP Endpoint Reference

## Discovery

### `GET /.well-known/ucp`

Returns the UCP discovery manifest describing the store's services, capabilities, and supported payment handlers.

**Headers:** None required.

**Response:**

```json
{
  "ucp": {
    "version": "2026-01-11",
    "status": "success",
    "services": {
      "dev.ucp.shopping": [
        {
          "transport": "rest",
          "endpoint": "https://api.jyt.com/ucp"
        }
      ]
    },
    "capabilities": {
      "dev.ucp.shopping.checkout": [{ "version": "2026-01-11" }],
      "dev.ucp.shopping.cart": [{ "version": "2026-01-11" }],
      "dev.ucp.shopping.order": [{ "version": "2026-01-11" }],
      "dev.ucp.shopping.fulfillment": [{ "version": "2026-01-11" }]
    },
    "payment_handlers": [
      { "id": "payu", "name": "PayU", "currencies": ["inr"] },
      { "id": "stripe", "name": "Stripe", "currencies": ["usd", "eur", "gbp"] }
    ]
  }
}
```

---

## Checkout Sessions

### `POST /ucp/checkout-sessions`

Creates a new checkout session (Medusa cart) with line items, buyer info, and optional shipping address.

**Request body:**

```typescript
{
  line_items: Array<{
    item: { id: string }       // variant ID
    quantity: number
  }>
  buyer?: {
    email?: string
    first_name?: string
    last_name?: string
    full_name?: string
    phone_number?: string
  }
  shipping_address?: UcpAddress
  context?: {
    region_id?: string
    currency?: string          // ISO 4217 code, e.g. "usd", "inr"
  }
  discounts?: {
    codes?: string[]
  }
}
```

**Response (201):**

```typescript
{
  ucp: { version: "2026-01-11", status: "success" }
  id: string                    // cart ID
  status: "incomplete" | "ready_for_complete"
  currency: string              // e.g. "USD"
  line_items: UcpLineItem[]
  totals: UcpTotal[]
  buyer?: { email?: string, first_name?: string, ... }
  shipping_address?: UcpAddress
  fulfillment?: UcpFulfillment
  messages: UcpMessage[]
  links: UcpLink[]
}
```

**Example:**

```bash
curl -X POST https://api.jyt.com/ucp/checkout-sessions \
  -H "Content-Type: application/json" \
  -H "UCP-Agent: profile=\"https://agent.example/profile\"" \
  -H "Request-Id: req-001" \
  -H "x-publishable-api-key: pk_..." \
  -d '{
    "line_items": [{ "item": { "id": "variant_01..." }, "quantity": 2 }],
    "buyer": { "email": "buyer@example.com" },
    "context": { "region_id": "reg_01..." }
  }'
```

---

### `GET /ucp/checkout-sessions/:id`

Retrieves a checkout session by ID.

**Response (200):** Same shape as POST response.

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 404 | `not_found` | Session does not exist |

---

### `PUT /ucp/checkout-sessions/:id`

Updates an existing checkout session. Supports partial updates — only provided fields are modified.

**Request body (all optional):**

```typescript
{
  buyer?: { email?: string, first_name?: string, last_name?: string, ... }
  shipping_address?: UcpAddress
  line_items?: Array<{
    line_item_id?: string       // existing item to update
    item?: { id: string }       // new item to add
    quantity: number
  }>
  fulfillment_option_id?: string
  discounts?: { codes?: string[] }
}
```

**Response (200):** Updated session.

**Notes:**
- If `shipping_address` changes the country, the cart's region is automatically switched to a matching region.
- Providing `line_item_id` updates an existing line item's quantity; providing `item.id` adds a new line item.

---

### `POST /ucp/checkout-sessions/:id/complete`

Initiates payment for a checkout session. Returns a `next_action` the agent/shopper must take to complete payment.

**Prerequisites:**
- At least one line item
- Buyer email set
- Shipping address with `address_1` (not just an auto-created empty record)

**Request body:**

```typescript
{
  payment: {
    instruments: Array<{
      handler_id: string        // "payu" or "stripe"
      instrument?: {
        token?: string          // optional payment instrument token
      }
    }>
  }
}
```

**Response (200):**

```typescript
{
  ucp: { version: "2026-01-11", status: "success" }
  id: string
  status: "complete_in_progress"
  payment: {
    handler_id: "payu" | "stripe"
    provider_id: string         // e.g. "pp_payu_payu"
    next_action: {
      type: "redirect" | "client_secret"
      url?: string              // for redirect type
      client_secret?: string    // for client_secret type
      description: string
    }
    description: string
  }
  ...
}
```

**Payment provider selection:**

| Cart currency | Provider | Handler ID | Next action |
|---------------|----------|------------|-------------|
| INR | PayU | `payu` | Redirect to PayU hosted page |
| Non-INR | Stripe | `stripe` | Redirect to Stripe hosted card page (falls back to `client_secret`) |

**After completion:** Poll `GET /ucp/checkout-sessions/:id` until `status` changes to `"completed"`. The response will include an `order` link.

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 400 | `missing_items` | No line items in cart |
| 400 | `missing_email` | Buyer email not set |
| 400 | `missing_shipping_address` | No shipping address with street |
| 404 | `not_found` | Session does not exist |
| 500 | `payment_setup_failed` | Could not create payment collection |
| 500 | `payment_session_failed` | Payment provider rejected session init |

---

## Catalog

### `POST /ucp/catalog/search`

Full-text search of the storefront catalog.

**Request body:**

```typescript
{
  query?: string                // full-text search
  filters?: {
    category?: string           // category ID
    collection?: string         // collection ID
  }
  pagination?: {
    limit?: number              // default 20
    offset?: number             // default 0
  }
}
```

**Response (200):**

```typescript
{
  ucp: { version: "2026-01-11", status: "success" }
  products: UcpProduct[]
  count: number
  offset: number
  limit: number
}
```

---

### `POST /ucp/catalog/lookup`

Retrieve specific products by ID.

**Request body:**

```typescript
{
  ids: string[]                 // product IDs
}
```

**Response (200):** Same as search, but filtered to requested IDs.

---

## Orders

### `GET /ucp/orders/:id`

Retrieve an order by ID. Includes fulfillment events and tracking info.

**Response (200):**

```typescript
{
  ucp: { version: "2026-01-11", status: "success" }
  id: string
  display_id: string | null
  checkout_id: string | null     // original cart ID
  status: string                 // e.g. "completed", "pending"
  currency: string
  line_items: UcpLineItem[]
  totals: UcpTotal[]
  fulfillment_status: string
  fulfillment_events: Array<{
    type: "shipped" | "created"
    timestamp: string
    tracking_number: string | null
    carrier: string | null
    items: Array<{ product_id: string, quantity: number }>
  }>
  buyer?: { email: string }
  shipping_address?: UcpAddress
  links: UcpLink[]
}
```

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 404 | `not_found` | Order does not exist |

---

## Types

### UcpAddress

```typescript
{
  first_name?: string
  last_name?: string
  street_address: string          // maps to Medusa address_1
  address_locality: string        // maps to Medusa city
  address_region?: string         // maps to Medusa province
  address_country: string         // ISO 3166 alpha-2/alpha-3/full name
  postal_code?: string
  phone_number?: string
}
```

Country code normalization handles:
- Alpha-2: `us`, `in`, `gb`
- Alpha-3: `usa`, `ind`, `gbr`
- Full names: `United States`, `India`, `United Kingdom`

### UcpLineItem

```typescript
{
  id: string
  item: {
    id: string                    // variant ID
    title: string
    price: number
  }
  quantity: number
  totals: Array<{ type: "line_total", display_text: string, amount: number }>
}
```

### UcpTotal

```typescript
{
  type: "subtotal" | "fulfillment" | "tax" | "discount" | "total"
  display_text: string
  amount: number
}
```

### UcpMessage

```typescript
// Error message
{
  type: "error"
  code: string                    // e.g. "missing_email", "missing_shipping_address"
  content: string
  severity: "recoverable" | "fatal"
  path?: string                   // JSON pointer, e.g. "$.buyer.email"
}

// Info message
{
  type: "info"
  code?: string
  content: string
}
```

### UcpProduct

```typescript
{
  id: string
  title: string
  description: string
  handle: string
  categories: string[]
  price_range: {
    min: { amount: number, currency: string }
    max: { amount: number, currency: string }
  } | null
  variants: Array<{
    id: string
    title: string
    sku: string | null
    price: { amount: number, currency: string } | null
    availability: {
      available: boolean
      status: "in_stock" | "out_of_stock"
    }
  }>
  media: Array<{ url: string, type: "image" }>
}
```

---

## Error Envelope

All errors follow a consistent shape:

```json
{
  "ucp": {
    "version": "2026-01-11",
    "status": "error"
  },
  "messages": [
    {
      "type": "error",
      "code": "not_found",
      "content": "Checkout session not found",
      "severity": "fatal"
    }
  ]
}
```

| Code | HTTP Status | Severity | Description |
|------|-------------|----------|-------------|
| `not_found` | 404 | fatal | Resource does not exist |
| `missing_items` | 400 | recoverable | Cart has no line items |
| `missing_email` | 400 | recoverable | Buyer email not set |
| `missing_shipping_address` | 400 | recoverable | No shipping address |
| `country_not_supported` | 400 | recoverable | Country not in any region |
| `payment_setup_failed` | 500 | fatal | Payment collection creation failed |
| `payment_session_failed` | 500 | fatal | Payment session init failed |
| `checkout_failed` | 500 | fatal | General checkout error |
| `internal_error` | 500 | fatal | Unhandled error |

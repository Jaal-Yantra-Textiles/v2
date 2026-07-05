---
title: "UCP Developer Guide"
sidebar_label: "Developer Guide"
sidebar_position: 2
---

# UCP Developer Guide

A step-by-step guide for integrating an AI agent with the JYT store via UCP.

## Quick Start

### 1. Discover the store

```bash
curl https://api.jyt.com/.well-known/ucp
```

The response tells you what services and payment handlers are available. No headers required.

### 2. Search the catalog

```bash
curl -X POST https://api.jyt.com/ucp/catalog/search \
  -H "Content-Type: application/json" \
  -H "UCP-Agent: profile=\"https://my-agent.example/profile\"" \
  -H "Request-Id: req-$(uuidgen)" \
  -H "x-publishable-api-key: pk_..." \
  -d '{ "query": "cotton shirt", "pagination": { "limit": 5 } }'
```

### 3. Create a checkout session

```bash
curl -X POST https://api.jyt.com/ucp/checkout-sessions \
  -H "Content-Type: application/json" \
  -H "UCP-Agent: profile=\"https://my-agent.example/profile\"" \
  -H "Request-Id: req-$(uuidgen)" \
  -H "x-publishable-api-key: pk_..." \
  -d '{
    "line_items": [{ "item": { "id": "variant_01JXY..." }, "quantity": 1 }],
    "buyer": { "email": "customer@example.com" },
    "context": { "currency": "usd" }
  }'
```

The response includes:
- `id` — the session ID (use for all subsequent calls)
- `status` — `incomplete` (items + email, no address yet)
- `messages` — guidance on what's missing

### 4. Add a shipping address

```bash
curl -X PUT https://api.jyt.com/ucp/checkout-sessions/sess_01JXY... \
  -H "Content-Type: application/json" \
  -H "UCP-Agent: profile=\"https://my-agent.example/profile\"" \
  -H "Request-Id: req-$(uuidgen)" \
  -H "x-publishable-api-key: pk_..." \
  -d '{
    "shipping_address": {
      "first_name": "Asha",
      "last_name": "Patel",
      "street_address": "123 Hill Rd",
      "address_locality": "Mumbai",
      "address_region": "MH",
      "address_country": "in",
      "postal_code": "400001",
      "phone_number": "+919876543210"
    }
  }'
```

After this, `status` becomes `ready_for_complete`.

### 5. Complete checkout

```bash
curl -X POST https://api.jyt.com/ucp/checkout-sessions/sess_01JXY.../complete \
  -H "Content-Type: application/json" \
  -H "UCP-Agent: profile=\"https://my-agent.example/profile\"" \
  -H "Request-Id: req-$(uuidgen)" \
  -H "x-publishable-api-key: pk_..." \
  -d '{ "payment": { "instruments": [{ "handler_id": "payu" }] } }'
```

The response includes a `payment.next_action`:

```json
{
  "status": "complete_in_progress",
  "payment": {
    "handler_id": "payu",
    "next_action": {
      "type": "redirect",
      "url": "https://secure.payu.in/_payment",
      "description": "PayU hosted payment page..."
    }
  }
}
```

### 6. Poll for completion

```bash
# Poll every 2-5 seconds
curl https://api.jyt.com/ucp/checkout-sessions/sess_01JXY... \
  -H "UCP-Agent: profile=\"https://my-agent.example/profile\"" \
  -H "Request-Id: req-$(uuidgen)" \
  -H "x-publishable-api-key: pk_..."
```

When `status` becomes `"completed"`, the response includes an order link.

### 7. Retrieve the order

```bash
curl https://api.jyt.com/ucp/orders/order_01JXY... \
  -H "UCP-Agent: profile=\"https://my-agent.example/profile\"" \
  -H "Request-Id: req-$(uuidgen)" \
  -H "x-publishable-api-key: pk_..."
```

---

## Session Status Lifecycle

```
                    ┌─────────────┐
         create ──▶ │  incomplete  │
                    └──────┬──────┘
                           │
                    add items + email + address
                           │
                    ┌──────▼──────────────┐
                    │  ready_for_complete  │
                    └──────┬──────────────┘
                           │
                    POST /complete
                           │
                    ┌──────▼───────────────────┐
                    │  complete_in_progress     │
                    │  (payment pending)        │
                    └──────┬─────────┬──────────┘
                           │         │
                     payment        payment
                     succeeds       fails/expires
                           │         │
                    ┌──────▼──┐  ┌──▼──────────┐
                    │ completed│  │  incomplete  │
                    └─────────┘  └──────────────┘
```

| Status | Meaning | Agent action |
|--------|---------|-------------|
| `incomplete` | Missing items, email, or address | Add via PUT |
| `ready_for_complete` | All prerequisites met | POST /complete |
| `complete_in_progress` | Payment initialized, waiting | Poll GET until terminal |
| `completed` | Order created | Retrieve order via GET /ucp/orders/:id |
| `canceled` | Session canceled | No further action |

---

## Region Resolution

The UCP API automatically resolves regions based on the shipping address country:

1. If `context.region_id` is provided, it's used directly
2. If only a shipping address is provided, the system searches for a region whose country list includes `address_country`
3. Country codes are normalized — accepts alpha-2 (`us`), alpha-3 (`usa`), and full names (`United States`)
4. If no matching region exists, returns a `country_not_supported` error listing supported countries

---

## Address Translation

UCP uses schema.org-style address fields. These are translated to/from Medusa's internal format:

| UCP field | Medusa field |
|-----------|-------------|
| `street_address` | `address_1` |
| `address_locality` | `city` |
| `address_region` | `province` |
| `address_country` | `country_code` |
| `postal_code` | `postal_code` |
| `phone_number` | `phone` |

---

## Payment Flows

### PayU (INR)

1. Agent calls `POST /complete` with `handler_id: "payu"`
2. Backend creates a payment collection and initializes a PayU session
3. Response includes `next_action.type: "redirect"` with a PayU payment URL
4. Shopper pays on PayU's hosted page (cards, UPI, netbanking)
5. PayU webhook completes the cart → order is created
6. Agent polls GET until `status: "completed"`

### Stripe (non-INR)

1. Agent calls `POST /complete` with `handler_id: "stripe"`
2. Backend creates a payment collection and initializes a Stripe session
3. Response includes either:
   - `next_action.type: "redirect"` with a Stripe hosted card page URL (preferred)
   - `next_action.type: "client_secret"` with a Stripe client secret (fallback)
4. Shopper pays on Stripe's hosted page
5. Stripe webhook completes the cart → order is created
6. Agent polls GET until `status: "completed"`

---

## TypeScript Integration

### Types

```typescript
interface UcpCheckoutSession {
  ucp: { version: string; status: "success" }
  id: string
  status: "incomplete" | "ready_for_complete" | "complete_in_progress" | "completed" | "canceled"
  currency: string
  line_items: UcpLineItem[]
  totals: UcpTotal[]
  buyer?: { email?: string; first_name?: string; last_name?: string; phone_number?: string }
  shipping_address?: UcpAddress
  fulfillment?: UcpFulfillment
  messages: UcpMessage[]
  links: UcpLink[]
}

interface UcpError {
  ucp: { version: string; status: "error" }
  messages: Array<{
    type: "error"
    code: string
    content: string
    severity: "recoverable" | "fatal"
    path?: string
  }>
}
```

### Minimal client

```typescript
const UCP_BASE = "https://api.jyt.com"
const HEADERS = {
  "Content-Type": "application/json",
  "UCP-Agent": 'profile="https://my-agent.example/profile"',
  "x-publishable-api-key": process.env.JYT_PUBLISHABLE_KEY!,
}

async function ucpRequest(path: string, body?: unknown) {
  const res = await fetch(`${UCP_BASE}${path}`, {
    method: body ? "POST" : "GET",
    headers: { ...HEADERS, "Request-Id": crypto.randomUUID() },
    body: body ? JSON.stringify(body) : undefined,
  })
  return res.json()
}

// Create session
const session = await ucpRequest("/ucp/checkout-sessions", {
  line_items: [{ item: { id: variantId }, quantity: 1 }],
  buyer: { email: "customer@example.com" },
})

// Add address
await ucpRequest(`/ucp/checkout-sessions/${session.id}`, {
  shipping_address: {
    street_address: "123 Main St",
    address_locality: "New York",
    address_country: "us",
    postal_code: "10001",
  },
})

// Complete
const completed = await ucpRequest(`/ucp/checkout-sessions/${session.id}/complete`, {
  payment: { instruments: [{ handler_id: "stripe" }] },
})

// Redirect shopper to completed.payment.next_action.url
// Then poll:
const poll = await ucpRequest(`/ucp/checkout-sessions/${session.id}`)
if (poll.status === "completed") {
  const order = await ucpRequest(`/ucp/orders/${poll.order_id}`)
  console.log("Order created:", order.display_id)
}
```

---

## Testing

Integration tests are at `integration-tests/http/ucp/ucp-checkout.spec.ts` (19 tests, all passing).

```bash
# Run UCP tests
TEST_TYPE=integration:http NODE_OPTIONS="--experimental-vm-modules" \
  npx jest --testPathPattern="ucp/ucp-checkout" --runInBand
```

The test suite covers:
- Discovery manifest
- Header validation (missing UCP-Agent / Request-Id)
- Checkout session CRUD (create, retrieve, update)
- Checkout complete validation (missing email, missing address)
- Catalog search + lookup
- Order retrieval + 404 handling
- UCP error envelope format

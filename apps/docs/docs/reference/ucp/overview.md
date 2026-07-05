---
title: "Universal Commerce Protocol (UCP)"
sidebar_label: "Overview"
sidebar_position: 0
---

# Universal Commerce Protocol (UCP)

The JYT Commerce API exposes a **Universal Commerce Protocol (UCP)** surface that lets AI agents discover and interact with the store through a standardized, spec-compliant REST API. UCP abstracts away Medusa-specific cart semantics and gives agents a uniform checkout flow: discover → search → create session → update → complete → poll.

## Why UCP?

Traditional store APIs are designed for human-operated frontends. AI agents need:

- **Self-discovery** — a well-known endpoint that describes what the store can do
- **Standardized error envelopes** — structured `{ ucp, messages }` format, not raw HTTP errors
- **Status-driven sessions** — explicit `incomplete → ready_for_complete → complete_in_progress → completed` lifecycle
- **Payment next-actions** — agents receive a `next_action` (redirect URL or client secret) instead of having to reverse-engineer provider flows

## Architecture

```
AI Agent
  │
  ▼
GET /.well-known/ucp          ← Discovery manifest
  │
  ▼
POST /ucp/catalog/search      ← Find products
POST /ucp/catalog/lookup      ← Get product details
  │
  ▼
POST /ucp/checkout-sessions   ← Create cart (session)
GET  /ucp/checkout-sessions/:id
PUT  /ucp/checkout-sessions/:id
  │
  ▼
POST /ucp/checkout-sessions/:id/complete  ← Initialize payment
  │                                            Returns next_action
  ▼
GET /ucp/checkout-sessions/:id  ← Poll until status = "completed"
  │
  ▼
GET /ucp/orders/:id            ← Retrieve order
```

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| UCP checkout session = Medusa cart | No duplicate state; leverages Medusa's cart engine |
| Async payment flow | PayU/Stripe payments are redirect-based; agent polls until completion |
| Reuses MCP loopback proxy | `callStoreRoute` forwards to `/store/*` routes, inheriting all middleware (publishable-key scoping, pricing, tax) |
| `.well-known/ucp` via middleware | Medusa's file scanner ignores dot-directories; registered as inline handler in `defineMiddlewares` |
| INR → PayU, non-INR → Stripe | Currency-based provider selection |

## Protocol Version

Current UCP version: **`2026-01-11`**

All responses include a `ucp` envelope:

```json
{
  "ucp": {
    "version": "2026-01-11",
    "status": "success"
  },
  ...
}
```

## Required Headers

All `/ucp/*` routes (except `/.well-known/ucp`) require:

| Header | Description |
|--------|-------------|
| `UCP-Agent` | Agent identifier, e.g. `profile="https://agent.example/profile"` |
| `Request-Id` | Unique request ID for tracing |
| `x-publishable-api-key` | Medusa publishable API key for sales-channel scoping |

## Source Files

| File | Purpose |
|------|---------|
| `src/api/ucp/lib/context.ts` | Publishable key resolution, region matching, loopback URL |
| `src/api/ucp/lib/formatter.ts` | Medusa cart → UCP checkout session transformation |
| `src/api/ucp/lib/status-maps.ts` | Cart state → UCP status mapping |
| `src/api/ucp/lib/address-translator.ts` | UCP ↔ Medusa address translation + country code normalization |
| `src/api/ucp/lib/error-formatter.ts` | UCP spec-compliant error envelope |
| `src/api/ucp/lib/fulfillment.ts` | Fulfillment methods, groups, and shipping options |
| `src/api/ucp/lib/payment-next-action.ts` | Payment session → next action (redirect URL / client secret) |
| `src/api/ucp/lib/cart-fields.ts` | Cart field constants for `query.graph` |
| `src/api/ucp/lib/shipping-options.ts` | Safe wrapper around `listShippingOptionsForCartWorkflow` |
| `src/api/ucp/validators.ts` | Zod schemas for all UCP request bodies |

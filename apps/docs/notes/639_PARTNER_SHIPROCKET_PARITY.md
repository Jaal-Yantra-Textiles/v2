# #639 — Partner-side Shiprocket label / attach-AWB parity

Status: **backend + partner-ui hooks BUILT** (PR pending). Button render slice
DEFERRED (Playwright-gated — needs a partner-owned order WITH a fulfillment
seeded at the live partner-ui).

## Problem
Partners could only mark-as-shipped with a hand-keyed tracking number
(`POST /partners/fulfillments/:id/shipment` → core `createShipmentWorkflow`).
There was no partner equivalent of the admin Shiprocket carrier flows
(generate label / attach existing AWB), a parity gap under #337 / #404 / #437.

## What shipped (this PR)

### Backend routes (mirror admin, scoping INSIDE the handler)
- `POST /partners/orders/:id/shiprocket-label`
  — `apps/backend/src/api/partners/orders/[id]/shiprocket-label/route.ts`
- `POST /partners/orders/:id/shiprocket-attach-awb`
  — `apps/backend/src/api/partners/orders/[id]/shiprocket-attach-awb/route.ts`

Both call `validatePartnerOrderOwnership(req.auth_context, orderId, req.scope)`
FIRST (the partner-API-mirrors-admin convention: same wire contract as
`/admin/orders/:id/shiprocket-*`, scoping lives in the handler). Ownership =
retail (order in the partner's store sales-channel) OR the D3 `partner↔order`
work link. A foreign order **404s before any fulfillment/carrier work runs**.

They then reuse the exact admin building blocks:
`ensureOrderFulfillment` → `createShiprocketShipmentForFulfillment`
(label, accepts `preferred_courier_id` for #641 parity) /
`attachExistingShiprocketAwb` (attach).

Middleware: two matchers added to `apps/backend/src/api/middlewares.ts`
(`createCorsPartnerMiddleware` + `authenticate("partner", …)`), next to the
existing `/partners/orders/:id/fulfillments/:fulfillmentId/shipment` entry.

Response envelopes match admin exactly:
`{ shiprocket_label: {...} }` / `{ shiprocket_awb: {...} }`.

### Partner-ui hooks
`apps/partner-ui/src/hooks/api/shiprocket.tsx`:
- `useGenerateShiprocketLabel(orderId)` — POST `…/shiprocket-label`, optional
  `{ preferred_courier_id }`.
- `useAttachShiprocketAwb(orderId)` — POST `…/shiprocket-attach-awb` with `awb`.
Both invalidate `ordersQueryKeys.all` on success (mirror `fulfillment.tsx`).

### Tests
`integration-tests/http/partner-shiprocket-routes.spec.ts` — owner vs intruder:
intruder → 404 on both routes (before validation/carrier); owner + empty AWB →
400 (body validation, proving the guard let the owner through). 1/1 green.

## Deferred render slice (next)
Wire two buttons into the partner order-fulfillment section
(`apps/partner-ui/src/routes/orders/order-detail/components/order-fulfillment-section/order-fulfillment-section.tsx`,
the action row at ~L627 next to **Download Label** / `handleFetchLabel`):

1. **Generate Shiprocket Label** — `useGenerateShiprocketLabel(order.id)`; show
   when the fulfillment has no waybill yet and isn't canceled; toast the AWB.
2. **Attach existing AWB** — open an inline input / drawer (mirror the admin
   Design-Orders attach panel), call `useAttachShiprocketAwb(order.id)`.

Mirror the admin handlers in
`apps/backend/src/admin/routes/design-orders/[id]/page.tsx`
(`handleGenerateLabel` / `handleAttachAwb`).

**Why deferred:** the daemon rule requires Playwright verification of UI against
the live partner-ui at :5173, which needs a partner-owned order WITH a
fulfillment seeded + a partner browser login. That seeding wasn't done this
chunk; the backend (the actual parity gap) is integration-tested and the hooks
typecheck clean.

## Open decision (none blocking)
The admin label route is **order-keyed** (`/orders/:id/shiprocket-label`), so the
partner mirror is too — even though the partner fulfillment UI is
fulfillment-keyed. `ensureOrderFulfillment` reconciles (reuses/creates the
order's fulfillment), so the button can live in the per-fulfillment section and
still call the order-keyed route. No ambiguity for single-fulfillment orders
(the design-order flow); multi-fulfillment partner orders would label the
order's first/primary fulfillment — fine for the current converted-order flow.

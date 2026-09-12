# TRACE: Partner UI design_id on work-order line

> STATUS: skeleton — being filled in. All claims will cite `path:line` from repo root.

## 1. Purpose

(being traced) partner-ui reads `metadata.design_id` off work-order lines; backend now has a real design<->order_line_item link + resolver. This doc traces the HTTP data path so partner-ui can read a server-resolved design id instead.

## 2. Entry points

- (tracing) `apps/partner-ui/src/components/work-orders/collated-design-detail.tsx` — reads `line?.metadata?.design_id` (lines 32, 58, 230 per task context)
- (tracing) `apps/partner-ui/src/components/work-orders/collated-design-runs.tsx` — line 277

## 3. Data models & links

- (tracing) `apps/backend/src/links/design-order-line-item-link.ts`
- (tracing) `apps/backend/src/lib/resolve-line-item-production.ts` — `resolveLineItemDesignId`

## 4. Key behaviours

(to be filled: hook -> URL -> backend route -> response builder -> fields selected)

## 5. Gotchas / invariants

(to be filled)

## 6. Open questions / (unverified)

- (tracing in progress)

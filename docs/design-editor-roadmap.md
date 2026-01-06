# Design Editor Feature Plan

_Last updated: 2026-01-06_

## Step 1 – Visual resilience
1. Add a loader overlay while the base product image is loading in the canvas.
2. When a product has no `thumbnail`, inject a generated fallback base design (neutral silhouette) and record that in design metadata so future sessions know the origin.
3. Provide a recovery action if the base image fails to load so users can regenerate the fallback without refreshing.

## Step 2 – Production intent UI
1. In the Canvas Tools block, surface an "Estimate" pill that reads `product.design.estimate_cost` when available (fallback to "Estimate unavailable" with tooltip explaining why).
2. Add a "Produce this design" CTA that opens a summary sheet (materials, partner, specs) and captures the user’s intent; do **not** trigger runs directly here.
3. The CTA should call a cost-estimate endpoint when no cached estimate exists and cache the response in `design.metadata.estimate_cost`.

## Step 3 – Specifications & creative controls
1. Introduce a "Specifications" section with color palette pickers (linked to materials when possible) and measurement inputs (bust, waist, length, etc.).
2. Persist specs under `design.metadata.specs` so downstream workflows (quotes, production runs) can consume them.
3. Mirror these fields in the `/store/custom/designs` route so they survive save/restore cycles and appear in admin.

## Step 4 – Persistence integrity
1. Reconfirm `convertToExcalidraw` output is persisted under `metadata.excalidraw` in the save workflow.
2. Extend store save route tests to ensure layers, specs, estimate, and fallback flags round-trip.
3. Surface clear errors/toasts when saving fails so users can retry without losing work.

## Step 5 – Digital product + order bridge
1. Model a "Custom Design" digital product (non-shipping, digital fulfillment provider) that each new design instance can clone against.
2. When a design is added to cart, create a one-off variant referencing the design ID so the existing `order.placed` subscriber can spawn the production run automatically.
3. If a product already has `design.estimate_cost`, reuse it; otherwise backfill estimate from material inventory cost + partner rate when the order is confirmed.

### Step 5a – Preference badges + AI base generation
1. **Save flow badges**: Inside the Save Design modal, prompt the customer to choose stylistic badges (style, color family, body type, embellishment level, occasion, budget sensitivity). Persist picks in `design.metadata.badges` for both designed and design-less states so estimators always have context.
2. **AI fallback workflow**:
   - Create `src/api/store/ai/imagegen/route.ts` that invokes a new Mastra workflow for image generation whenever there is no base design.
   - Build the workflow inside `src/mastra/workflows/imagegen` using the existing Mastra pattern; wire it to `src/workflows/ai` helpers if available.
   - Use Mistral’s free tier (track quota with a lightweight `GET /usage` call or cached value) before each generation.
3. **Media persistence**:
   - Store each generated image in-browser (local cache for instant preview) and upload via the admin medias API (`src/api/admin/medias`) under a folder per customer (`/medusa/ai-designs/{customerId}`).
   - Record the media file ID + badge metadata on the design so future sessions can reuse the asset without re-generating.
4. **Design editor integration**: When a product lacks a base thumbnail, first check for stored AI media; if none, call the new API, show progress, and hydrate the canvas with the returned image plus metadata tags.

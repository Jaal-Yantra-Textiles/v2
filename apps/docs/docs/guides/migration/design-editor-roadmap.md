---
title: "Design Editor Feature Plan"
sidebar_label: "Design Editor Roadmap"
sidebar_position: 2
---

# Design Editor Feature Plan

_Last updated: 2026-01-08_

---

## ✅ Completed Work Summary

### Step 5a – Preference badges + AI base generation (COMPLETE)

**API Layer:**
- ✅ [src/api/store/ai/imagegen/route.ts](src/api/store/ai/imagegen/route.ts) - POST endpoint for AI image generation
- ✅ [src/api/store/ai/imagegen/validators.ts](src/api/store/ai/imagegen/validators.ts) - Zod validators for badges, reference images, canvas snapshot, and mode

**Mastra Workflow:**
- ✅ [src/mastra/workflows/imagegen/index.ts](src/mastra/workflows/imagegen/index.ts) - 3-step workflow:
  1. `buildPromptStep` - Uses Mistral Medium model to enhance prompts from badges/materials
  2. `checkQuotaStep` - Validates quota before generation
  3. `generateImageStep` - Generates images using **Mistral Agents API with built-in `image_generation` tool** (Black Forest Lab FLUX1.1 [pro] Ultra)
- ✅ Workflow registered in [src/mastra/index.ts](src/mastra/index.ts) as `imageGenerationWorkflow`

**Image Generation Implementation:**
- Uses Mistral's Agents API (not standard chat completions) because built-in tools only work through Agents API
- Flow: Create agent → Start conversation → Extract `file_id` from `tool_file` chunks → Download image → Return base64 data URL
- Properly extracts `file_type` from Mistral response for correct MIME type handling

**Application Workflow:**
- ✅ [src/workflows/ai/generate-design-image.ts](src/workflows/ai/generate-design-image.ts) - Medusa workflow that:
  - Invokes Mastra workflow via `invokeMastraImageGenStep`
  - **Always uploads to media storage** (both preview and commit modes) for proper URL handling
  - Finds existing `ai-designs` folder or creates new one
  - Parses base64 data URLs and uploads as proper image files
  - Updates design metadata with AI media info via `updateDesignWithAiMediaStep` (commit mode only)
  - Uses `transform()` and `when()` patterns for runtime value access

**Media Upload:**
- ✅ [src/workflows/media/upload-and-organize-media.ts](src/workflows/media/upload-and-organize-media.ts) - Uses base64 encoding for Medusa's `uploadFilesWorkflow`
- Images stored in `/static/` directory with proper file extensions
- Returns HTTP URL for frontend display

**Storefront Integration (jyt-storefront):**
- ✅ `src/lib/data/ai-imagegen.ts` - Server action for calling AI API
- ✅ `.../hooks/modules/use-ai-generation.ts` - Modular hook for AI generation
- ✅ `.../hooks/use-design-editor.ts` - Main hook integrates AI generation, sets `generatedBase` state
- ✅ `.../hooks/use-image.ts` - Loads image from URL for canvas display
- ✅ `.../components/ai-login-prompt.tsx` - Login modal for unauthenticated users
- ✅ `.../components/editor-sidebar.tsx` - AI Generation section in sidebar
- ✅ `.../components/editor-canvas.tsx` - AI loading overlay with animation
- ✅ `.../index.tsx` - Integration with main editor component
- 📄 Full documentation: [/docs/implementation/ai/design-editor-ai](/docs/implementation/ai/design-editor-ai)

### Step 5b – Creator attribution & provenance controls (Partial)

**Schema:**
- ✅ `origin_source` enum field on Design model: `"manual" | "ai-mistral" | "ai-other"` ([src/modules/designs/models/design.ts](src/modules/designs/models/design.ts))
- ✅ Design-Customer link ([src/links/design-customer-link.ts](src/links/design-customer-link.ts)) - associates designs with creating customer

**Workflow & API Wiring:**
- ✅ [src/api/store/custom/designs/route.ts](src/api/store/custom/designs/route.ts) - Sets `origin_source: "manual"` for customer creations
- ✅ [src/workflows/designs/create-design.ts](src/workflows/designs/create-design.ts) - Accepts `origin_source` and `customer_id_for_link`
- ✅ AI workflow updates `origin_source = "ai-mistral"` on commit

---

## 📋 Pending Work

## Step 1 – Visual resilience
1. Add a loader overlay while the base product image is loading in the canvas.
2. When a product has no `thumbnail`, inject a generated fallback base design (neutral silhouette) and record that in design metadata so future sessions know the origin.
3. Provide a recovery action if the base image fails to load so users can regenerate the fallback without refreshing.

## Step 2 – Production intent UI
1. In the Canvas Tools block, surface an "Estimate" pill that reads `product.design.estimate_cost` when available (fallback to "Estimate unavailable" with tooltip explaining why).
2. Add a "Produce this design" CTA that opens a summary sheet (materials, partner, specs) and captures the user's intent; do **not** trigger runs directly here.
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

### Step 5a – Remaining (Minor Enhancements)
> Core functionality complete. Optional enhancements:

1. **Save flow badges UI**: Add badge selection UI in Save Design modal (currently badges passed from sidebar)
   - Style, color family, body type, embellishment level, occasion, budget sensitivity
   - Persist in `design.metadata.badges`

2. **"Regenerate with AI" action**: Allow comparing existing vs new preview before committing

3. ✅ **Image generation service**: COMPLETE - Using Mistral Agents API with FLUX1.1 [pro] Ultra ($100/1000 images)

### Step 5b – Remaining (Attribution Fields)
> Core schema and workflow wiring complete. Remaining:

1. Add `created_by_type` (`"admin" | "store_customer" | "partner" | "system"`) and `created_by_id` fields to Design model
2. **Reporting hooks**: Add filters to list endpoints (`filters.created_by_type`, `filters.origin_source`)

---
title: "Fashion Library — AI Tech-Pack Moodboard"
sidebar_label: "Fashion Library"
sidebar_position: 9
---

# Fashion Library — AI Tech-Pack Moodboard

_Last updated: 2026-07-06 · shipped in #892 (PR #907, squash `153a4bffe`)_

A fashion-specific tooling panel and AI pipeline built into the Excalidraw
moodboard canvas on a design. It turns a design's structured data
(measurements, construction details, specs) into a **generated tech-pack
moodboard**, and gives the designer AI tools — **structure-preserving
redesign**, **background segmentation**, **raster→SVG outline**, and
**measurement-true pattern blocks** — right on the canvas.

---

## Architecture

```
src/admin/components/designs/
  design-moodboard-section.tsx   ← Excalidraw canvas modal; "Generate tech-pack" + "Save"; hosts the panel
  fashion-panel.tsx              ← floating Fashion Library panel (6 tabs)
    ├── fabric-preview-tab.tsx   ← segmentation + fabric / 3D texture preview
    ├── redesign-tab.tsx         ← AI restyle
    ├── outline-tab.tsx          ← raster → editable SVG
    ├── fashion-shapes.ts        ← garment / body-shape polygons
    └── fashion-croquis.ts       ← sewing pattern-piece SVGs
  design-construction-section.tsx ← construction-detail editor (feeds the tech-pack)

src/api/admin/designs/[id]/      ← moodboard/redesign/outline/segment/construction-details/pattern-blocks routes
src/workflows/designs/moodboard/ ← deterministic tech-pack scene builder
src/mastra/services/             ← provider credential resolution (redesign, fal)
```

Canvas state (`elements` / `appState` / `files`) is loaded and saved to
`design.moodboard` via `useMoodboard` + `useDesign`.

---

## Panel tabs

Toggled by the **"Fashion Library"** button in the canvas toolbar. Current tabs
(the pre-#892 "Figures" croquis tab was dropped):

| Tab | Does |
|-----|------|
| **Garments** | Inserts garment / body-shape vector polygons from `FASHION_SHAPES`. Flat-lay / 3⁄4-view perspective toggle. |
| **Patterns** | Inserts sewing pattern-piece SVGs (grain lines, notches) from `PATTERN_PIECES`. |
| **Pinterest** | Searches `GET /admin/pinterest`, inserts pin images (bookmark pagination). |
| **Fabric** | `FabricPreviewTab` — segment a selected canvas image, then preview fabric / 3D texture. |
| **Redesign** | `RedesignTab` — AI structure-preserving restyle of a selected image. |
| **Outline** | `OutlineTab` — vectorize a flat/cutout into an editable SVG. |

Redesign renders auto-insert into a dedicated **"Redesign explorations"** frame
on the canvas.

---

## Generate tech-pack (deterministic)

`POST /admin/designs/:id/moodboard/generate` builds the moodboard **without an
AI provider** — it is a deterministic scene builder:

1. Load the design graph — name, type, `size_sets.measurements`, specifications.
2. `buildTechPackInputFromDesign` → `assessTechPackCompleteness` gates on
   **measurements present + ≥1 construction detail**.
3. `buildMoodboardScene` lays out titled frames (spec sheet, measurements,
   construction-detail symbols via parametric geometry).
4. Persists to `design.moodboard` (replaces the scene) and loads it into the canvas.

Construction details come from the **`construction-details`** routes
(`GET`/`POST`/`PATCH`/`DELETE`), editable in `design-construction-section.tsx`.
Techniques are an enum of 8: dart, knife-pleat, box-pleat, gathers, tucks,
topstitch, yoke, embroidery — each with param hints, stored on the spec metadata
and rendered as construction symbols in the moodboard.

---

## AI Redesign — provider-agnostic

`POST /admin/designs/:id/redesign` with `{ image_url | image_base64, prompt }`
returns `{ redesign: { image_url (data URL), provider, model, prompt } }`. It is
**exploration output only** — it never mutates the design.

- **Model:** Nano-Banana `gemini-2.5-flash-image`, driven through one of two
  interchangeable engines (`redesign-engines.ts`):
  - `openrouter` — `@openrouter/ai-sdk-provider` + `ai` SDK (`google/gemini-2.5-flash-image`).
  - `google` — direct Generative Language REST (`gemini-2.5-flash-image`, `responseModalities: ["IMAGE"]`).
- **Selection** (`src/mastra/services/redesign-credentials.ts`), in order:
  1. External Platform tagged role **`ai_redesign`** (`provider_type` openrouter/google) — **preferred for prod**,
  2. `OPENROUTER_API_KEY` env,
  3. `GOOGLE_GENERATIVE_AI_API_KEY` env,
  4. none → route returns **503 `no_provider`**.
- Errors normalize to `RedesignEngineError { kind, status }`
  (rate_limit / auth / safety / no_image / bad_input) so classified messages
  survive Medusa's 500-scrubbing. `TEST_TYPE` bypasses the call with a mock image.

---

## Segment (background removal) & Depth

- `POST /admin/designs/:id/segment` → `{ cutout_url, mask_url }` via
  `fal-ai/birefnet/v2` (`output_mask`, `refine_foreground`, 1024² operating res).
  The `model` input selects the BiRefNet variant; the UI defaults to
  **"General Use (Heavy)"** (Light / Dynamic / 2K / Portrait / Matting also valid).
- `POST /admin/designs/:id/segment/depth` → depth + normal maps via MiDaS
  (`fal-ai/image-preprocessors/midas`).
- Credentials: External Platform role `ai_image_gen` (`provider_type` fal) then
  `FAL_KEY` env.

---

## Outline (raster → editable SVG)

`POST /admin/designs/:id/outline` with `{ image_url | image_base64, mode?, … }`
returns `{ outline: { svg, image_url, mode, width, height } }` (does not mutate
the design).

Engine = **`imagetracerjs` (Unlicense) + `sharp`** — `sharp` decodes the raster
to RGBA, `imagetracerjs` traces it to `<path>`s. `mode` is `outline`
(2-colour silhouette) or `posterize` (`steps` colours).

:::warning Engine ≠ the code comments
The request schema and some error-kind names still say **"potrace"** for API
stability, but the shipped engine is **imagetracerjs + sharp**. `potrace` was
deliberately dropped (GPL-2.0). **Do not reintroduce potrace.**
:::

---

## Pattern blocks — FreeSewing

`GET /admin/designs/:id/pattern-blocks?block=bodice|skirt|trouser` drafts
**measurement-true** cut blocks from the design's first size-set measurements
(inches → mm), for self-serve tech-packs:

- bodice = `@freesewing/bella`, skirt = `@freesewing/sarah`, trouser = `@freesewing/titan` (`@freesewing/core` v4, MIT).
- FreeSewing's own theme/renderer is skipped; the cut outline is extracted
  directly (`fill` = single closed seam path; `line` = composed segments) and
  re-emitted as Library-styled SVG (slate on cream) with darts, grainline arrows
  and labels. `resolveMeasurements` backfills a full measurement set from the
  closest standard model so a block never drafts empty.
- Loaded via dynamic `import()` (ESM lib in a CJS backend), server-side only to
  keep the heavy dep out of the admin bundle; pnpm resolution fixed via
  `pnpm.packageExtensions`.

---

## Admin hooks & client (`src/admin/hooks/api/designs.ts`)

| Hook | Endpoint |
|------|----------|
| `useGenerateMoodboard(id)` | `POST …/moodboard/generate` |
| `useRedesignDesign(id)` | `POST …/redesign` |
| `useOutlineDesign(id)` | `POST …/outline` |
| `useConstructionDetails` / `useCreate…` / `useUpdate…` / `useDelete…` | `…/construction-details[/:detailId]` |

Segment is called inline via `sdk.client.fetch` from `fabric-preview-tab.tsx`
(no dedicated hook).

---

## Tests

`redesign/__tests__/redesign-support.unit.spec.ts`,
`redesign-engines.unit.spec.ts`, `outline/__tests__/outline-support.unit.spec.ts`,
and `src/workflows/designs/moodboard/__tests__/` cover the pure builders and
engine dispatch. Provider calls are bypassed under `TEST_TYPE`.

---

## Production configuration tail

- Set AI keys, preferably via the **`ai_redesign`** External Platform (OpenRouter
  or Google) and **`ai_image_gen`** (fal) — env `OPENROUTER_API_KEY` /
  `GOOGLE_GENERATIVE_AI_API_KEY` / `FAL_KEY` are the fallback.
- Deferred: an in-UI redesign-engine picker, and a "Zoom details" tech-pack frame
  (needs per-region bounding boxes no design field carries yet).

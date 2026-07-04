# Photo → Measured Tech-Pack Pipeline — Data & Seam Audit

Code audit feeding build plan (GitHub issue #892). Every claim cites a
`path/to/file.ts:Symbol` (or HTTP route) grounded in code actually read.
Anything not grounded is marked `(unverified)`.

---

## 1. Purpose

This document audits the existing data models and CV/vision seams in the JYT
backend (Medusa 2.x, TypeScript) to determine what a "photo → measured
tech-pack" pipeline can render as **authoritative** versus **suggested**. It
maps which fields could hold real centimetre measurements, which vision
endpoints already exist, and concretely what is missing.

---

## 2. Entry points (vision / CV seams)

- `POST /admin/designs/:id/segment` — `apps/backend/src/api/admin/designs/[id]/segment/route.ts:POST`
  — runs fal.ai BiRefNet v2 background removal; returns `{ segment: { cutout_url, mask_url } }`.
- `POST /admin/designs/:id/segment/depth` — `apps/backend/src/api/admin/designs/[id]/segment/depth/route.ts:POST`
  — runs fal.ai MiDaS; returns `{ depth: { depth_url, normal_url } }`.
- `imageGenerationWorkflow` — `apps/backend/src/mastra/workflows/imagegen/index.ts:imageGenerationWorkflow`
  — text/badge → image generation (preview/commit). Not a measurement pipeline.
- `imageExtractionWorkflow` — `apps/backend/src/mastra/workflows/imageExtraction/index.ts:imageExtractionWorkflow`
  — vision extraction of inventory items (name/quantity/sku), not garment measurements.
- `designValidatorWorkflow` (design data generator) — `apps/backend/src/mastra/workflows/designValidator/index.ts:generateDesignData`
  — LLM-generates a full design object incl. `custom_sizes` from a text prompt (no image input).
- Moodboard save (admin UI) — `apps/backend/src/admin/hooks/use-moodboard.ts:saveExcalidrawState`
  — writes Excalidraw scene JSON to `design.moodboard` via `updateDesign`.

---

## 3. Data models & links

All models live under `apps/backend/src/modules/designs/models/`.

### 3.1 `Design` — `apps/backend/src/modules/designs/models/design.ts:Design`

Table `design`. PK `id` (`model.id().primaryKey()`).

Fields relevant to this audit (full field list is larger; only measurement/
spec/moodboard-adjacent fields enumerated, plus the moodboard field):

| Field | `model.*` type | Captures |
|---|---|---|
| `id` | `model.id().primaryKey()` | PK |
| `custom_sizes` | `model.json().nullable()` | Legacy free-form size specs (superseded by `size_sets` relation) |
| `color_palette` | `model.json().nullable()` | Legacy free-form color list (superseded by `colors` relation) |
| `moodboard` | `model.json().nullable()` | Excalidraw scene JSON (see §5) |
| `media_files` | `model.json().nullable()` | Media asset references |
| `design_files` | `model.json().nullable()` | URLs to design files |
| `metadata` | `model.json().nullable()` | Free-form metadata |

Relations (all `hasMany`, cascade-delete): `specifications`, `colors`,
`size_sets`, `components`, `used_in` — `apps/backend/src/modules/designs/models/design.ts:Design`
(lines 85–93).

### 3.2 `DesignSizeSet` — `apps/backend/src/modules/designs/models/design_size_set.ts:DesignSizeSet`

Table `design_size_sets`. PK `id`.

| Field | `model.*` type | Captures |
|---|---|---|
| `id` | `model.id().primaryKey()` | PK |
| `size_label` | `model.text()` | Size label e.g. "M", "L" |
| `measurements` | `model.json().nullable()` | **The canonical cm/inch measurement store** — `Record<string, number>` keyed by measurement name (chest/length/…) per `apps/backend/src/workflows/designs/helpers/size-set-utils.ts:NormalizedSizeSet` |
| `metadata` | `model.json().nullable()` | Free-form |
| `design` | `model.belongsTo(() => Design, { mappedBy: "size_sets" })` | FK to design |

### 3.3 `DesignSpecification` — `apps/backend/src/modules/designs/models/design_specification.ts:DesignSpecification`

Table `design_specifications`. PK `id`.

| Field | `model.*` type | Captures |
|---|---|---|
| `id` | `model.id().primaryKey()` | PK |
| `title` | `model.text().translatable()` | Spec line title |
| `category` | `model.enum(["Measurements","Materials","Construction","Finishing","Packaging","Quality","Other"])` | Spec category; `"Measurements"` exists as a bucket |
| `details` | `model.text().translatable()` | Free-text spec body |
| `measurements` | `model.json().nullable()` | Size-specific measurements (comment: "For storing size-specific measurements") |
| `materials_required` | `model.json().nullable()` | List of required materials |
| `special_instructions` | `model.text().translatable().nullable()` | Notes |
| `attachments` | `model.json().nullable()` | URLs to spec documents |
| `version` | `model.text()` | Spec version string |
| `status` | `model.enum(["Draft","Under_Review","Approved","Rejected","Needs_Revision"]).default("Draft")` | Review state |
| `reviewer_notes` | `model.text().translatable().nullable()` | Notes |
| `metadata` | `model.json().nullable()` | Free-form |
| `design` | `model.belongsTo(() => Design, { mappedBy: "specifications" })` | FK to design |

### 3.4 `DesignColor` — `apps/backend/src/modules/designs/models/design_color.ts:DesignColor`

Table `design_colors`. PK `id`.

| Field | `model.*` type | Captures |
|---|---|---|
| `id` | `model.id().primaryKey()` | PK |
| `name` | `model.text().translatable()` | Color name |
| `hex_code` | `model.text()` | Hex color code |
| `usage_notes` | `model.text().translatable().nullable()` | Notes |
| `order` | `model.number().nullable()` | Display order |
| `metadata` | `model.json().nullable()` | Free-form |
| `design` | `model.belongsTo(() => Design, { mappedBy: "colors" })` | FK to design |

### 3.5 `DesignComponent` — `apps/backend/src/modules/designs/models/design_component.ts:DesignComponent`

Table `design_component`. PK `id`. Self-referential bundle joiner.

| Field | `model.*` type | Captures |
|---|---|---|
| `id` | `model.id().primaryKey()` | PK |
| `quantity` | `model.number().default(1)` | Component count |
| `role` | `model.text().translatable().nullable()` | e.g. "embroidery", "lining", "trim", "main_fabric" |
| `notes` | `model.text().translatable().nullable()` | Notes |
| `order` | `model.number().default(0)` | Display order |
| `metadata` | `model.json().nullable()` | Free-form |
| `parent_design` | `model.belongsTo(() => Design, { mappedBy: "components" })` | Parent FK |
| `component_design` | `model.belongsTo(() => Design, { mappedBy: "used_in" })` | Child FK |

### Module links

No cross-module `Module.link()` declarations were read in this audit; the
designs module is self-contained with internal `hasMany`/`belongsTo` only
(unverified — `apps/backend/src/modules/designs/index.ts` not read).

---

## 4. Key behaviours

### 4.1 Which fields could hold real centimetre values?

**Authoritative measurement stores (numeric, structured):**
- `DesignSizeSet.measurements` — `apps/backend/src/modules/designs/models/design_size_set.ts:DesignSizeSet`
  — typed downstream as `Record<string, number>` per
  `apps/backend/src/workflows/designs/helpers/size-set-utils.ts:NormalizedSizeSet`
  (line 6). This is the only field with a numeric-measurement contract.
  Keys are free-form strings (e.g. `chest`, `length`, `shoulder`, `sleeve`,
  `waist`, `hip`) as evidenced by the designValidator prompt at
  `apps/backend/src/mastra/workflows/designValidator/index.ts:generateDesignData`
  (lines 82–100). **No unit field exists** — unit is implicit (the validator
  prompt asks for inches; nothing enforces cm).
- `DesignSpecification.measurements` — `apps/backend/src/modules/designs/models/design_specification.ts:DesignSpecification`
  — `model.json().nullable()`, comment "For storing size-specific measurements".
  Shape is unconstrained JSON (no schema found), so it *could* hold numbers
  but has no enforced numeric contract.

**Labels / notes only (NOT measurement values):**
- `Design.size_label`? — does not exist; `size_label` is on `DesignSizeSet` and is a text label, not a value.
- `DesignSpecification.title`, `.details`, `.special_instructions`, `.reviewer_notes` — all `model.text()`, free text.
- `DesignColor.*` — color metadata only, no measurements.
- `DesignComponent.quantity`, `.order` — counts/ordering, not garment dimensions.
- `Design.custom_sizes` — legacy JSON blob; superseded by `size_sets` but still
  written when no structured size_sets are provided
  (`apps/backend/src/workflows/designs/create-design.ts:createDesignStep`,
  line 73: `custom_sizes: normalizedSizeSets ? null : input.custom_sizes`).

**Conclusion:** Only `DesignSizeSet.measurements` (and loosely
`DesignSpecification.measurements`) can carry authoritative numeric
measurements. Everything else is label/notes. There is **no dedicated
landmark/keypoint/drop/hem field** — those would have to live as keys inside
the `measurements` JSON.

### 4.2 Segmentation endpoint — `POST /admin/designs/:id/segment`

`apps/backend/src/api/admin/designs/[id]/segment/route.ts:POST`.

- Request body (`apps/backend/src/api/admin/designs/[id]/segment/validators.ts:SegmentImageSchema`):
  `image_url?`, `image_base64?`, `model?` (enum, default `"General Use (Light)"`).
- Calls `fal.subscribe("fal-ai/birefnet/v2", …)` with `output_mask: true`,
  `refine_foreground: true`, `operating_resolution: "1024x1024"`.
- **Returns:** `{ segment: { cutout_url: string, mask_url: string | null } }`
  (lines 94–99). Reads `data.image.url` and `data.mask_image.url` from the
  fal result.
- **Does NOT return** `bbox`, landmarks, keypoints, or any measurement.

### 4.3 Depth endpoint — `POST /admin/designs/:id/segment/depth`

`apps/backend/src/api/admin/designs/[id]/segment/depth/route.ts:POST`.

- Request body: `{ image_url?, image_base64? }` (read from `req.body`, no
  zod validator file — inline typed destructure, lines 25–28).
- Calls `fal.subscribe("fal-ai/image-preprocessors/midas", …)`.
- **Returns:** `{ depth: { depth_url: string, normal_url: string | null } }`
  (lines 96–101). Reads `data.depth_map.url` and `data.normal_map.url`.
- Adds depth + normal maps vs. the segment route. Still no measurements.

### 4.4 Image generation workflow — `imageGenerationWorkflow`

`apps/backend/src/mastra/workflows/imagegen/index.ts:imageGenerationWorkflow`.

Trigger schema (`triggerSchema`, lines 65–106) accepts:
- `mode`: `"preview" | "commit"` (default `"preview"`)
- `badges`: optional object (`style`, `color_family`, `body_type`,
  `embellishment_level`, `occasion`, `budget_sensitivity`, `custom`)
- `materials_prompt`: optional string
- `reference_images`: optional array (max 3) of `{ url, weight?, prompt? }` —
  **yes, reference images are accepted**
- `canvas_snapshot`: optional `{ width, height, layers: [{ id, type, data }] }`
  — **yes, a canvas snapshot is accepted**
- `preview_cache_key`, `customer_id` (required), `threadId`, `resourceId`

Output schema (`outputSchema`, lines 109–116): `{ image_url?, enhanced_prompt,
style_context, quota_remaining, provider_used?, error? }`.

This workflow **generates** images from text+references; it does **not**
extract measurements or produce a tech-pack.

### 4.5 Image extraction workflow — `imageExtractionWorkflow`

`apps/backend/src/mastra/workflows/imageExtraction/index.ts:imageExtractionWorkflow`.

Trigger (`triggerSchema`, lines 7–27): `{ image_url, entity_type
("raw_material"|"inventory_item"), notes?, threadId?, resourceId?, run_id? }`.

Output (`extractionResultSchema`, lines 39–43):
```
{ entity_type: string, items: Array<{ name, quantity, unit?, sku?, confidence?, metadata? }>, summary? }
```
(item schema at lines 30–37).

This extracts **inventory item counts**, not garment measurements. There is
no field for length/width/drop/hem in the output schema.

### 4.6 Moodboard scene shape stored on `design.moodboard`

`apps/backend/src/admin/hooks/use-moodboard.ts:saveExcalidrawState` (lines
125–132) constructs and persists:
```ts
{
  type: "excalidraw",
  version: 2,
  source: "https://excalidraw.com",
  elements: processedElements,   // Excalidraw element array (image/text/shape)
  appState: { viewBackgroundColor, gridSize, theme, zoom },
  files: processedFiles          // { [fileId]: { id, dataURL, mimeType, created, lastRetrieved } }
}
```
This is written via `updateDesign({ moodboard: excalidrawData })` (line 153).
`design.moodboard` is `model.json().nullable()` —
`apps/backend/src/modules/designs/models/design.ts:Design` (line 83).

---

## 5. Gotchas / invariants

- **No unit enforcement.** `DesignSizeSet.measurements` is `Record<string,
  number>` with no unit field. The designValidator prompt asks for *inches*
  (`apps/backend/src/mastra/workflows/designValidator/index.ts:generateDesignData`,
  line 100); nothing in the schema or model enforces cm. A photo→cm pipeline
  must decide a unit convention or add a unit field.
- **`custom_sizes` vs `size_sets` dual-write.** `createDesignStep` nulls
  `custom_sizes` when structured `size_sets` are provided
  (`apps/backend/src/workflows/designs/create-design.ts:createDesignStep`,
  line 73), but legacy `custom_sizes` is still written otherwise. A pipeline
  must target `size_sets`, not `custom_sizes`.
- **Segment/depth routes are stateless image transforms.** They take an image
  and return URLs; they do **not** persist anything to the design record
  (`apps/backend/src/api/admin/designs/[id]/segment/route.ts:POST` makes no
  DB call). The caller is responsible for storing results.
- **Moodboard is a full-scene replace.** `saveExcalidrawState` writes the
  entire Excalidraw scene as one JSON blob
  (`apps/backend/src/admin/hooks/use-moodboard.ts:saveExcalidrawState`,
  line 153). There is no incremental element append API; a photo-seeding
  step would have to read-merge-write the whole scene.
- **`imageExtraction` normalizes many key aliases** (e.g. `qty`, `count`,
  `amount`) — `apps/backend/src/mastra/workflows/imageExtraction/index.ts:extractItems`
  (lines 156–173) — but none map to garment dimensions.

---

## 6. The gap (grounded, not speculative)

Based **only** on the code read above:

### 6.1 No code seeds `design.moodboard` from a photo.

Every write of `moodboard` passes through user-supplied Excalidraw data:
- Admin UI: `apps/backend/src/admin/hooks/use-moodboard.ts:saveExcalidrawState`
  (line 153) — builds scene from the live Excalidraw editor.
- Create workflow: `apps/backend/src/workflows/designs/create-design.ts:createDesignStep`
  (line 81) — `moodboard: input.moodboard` (passthrough only).
- Update workflow: `apps/backend/src/workflows/designs/update-design.ts`
  (line 37) — `moodboard?: Record<string, any>` passthrough.
- Revise workflow: `apps/backend/src/workflows/designs/revise-design.ts`
  (line 205) — copies `original.moodboard` verbatim.
- Store/partner routes: `apps/backend/src/api/store/custom/designs/route.ts`
  (line 389), `apps/backend/src/api/store/custom/designs/[id]/route.ts`
  (line 130), `apps/backend/src/api/partners/designs/validators.ts` (line 84)
  — all accept arbitrary `moodboard` JSON from the client.

**No producer constructs a moodboard scene from an uploaded photo URL.**
(unverified — searched all `moodboard` references via grep across
`apps/backend/src/**/*.ts`; none transform a photo into scene elements.)

### 6.2 No landmark / keypoint / measurement-extraction code.

Searched `apps/backend/src/**/*.ts` for
`keypoint|landmark|measurement_extract|measure_extract|pose_estimate|pose-estimate`.
The only `landmark` hits are unrelated shipping-address fields
(`apps/backend/src/modules/shipping-providers/shiprocket/client.ts:575`,
`apps/backend/src/api/mcp/lib/registry.ts:435`). **None found (unverified —
searched via grep for the patterns above).**

### 6.3 Measurement fields with NO producer feeding them.

- `DesignSizeSet.measurements` — the only producer is the
  `designValidatorWorkflow` LLM text→JSON generator
  (`apps/backend/src/mastra/workflows/designValidator/index.ts:generateDesignData`,
  lines 82–100), which fabricates measurements from a text prompt with no
  image input. No vision/CV path writes to this field.
- `DesignSpecification.measurements` — no producer found at all in the code
  read (unverified — no write site located; only the model definition and
  migration were read).
- There is no field for `drop`, `hem`, `inseam`, etc. — these would have to
  be invented as keys inside `DesignSizeSet.measurements`.

### 6.4 No "tech-pack" concept exists.

Searched `apps/backend/src/**/*.ts` for `techpack|tech_pack|tech-pack|techPack`
— **no matches**. The tech-pack is an unbuilt artifact; the closest existing
structures are `DesignSpecification` (category `"Measurements"`) and
`DesignSizeSet.measurements`.

---

## 7. Open questions / (unverified)

- **Module link declarations** — `apps/backend/src/modules/designs/index.ts`
  was not read; whether `Design` is linked to other modules (e.g. product,
  inventory) via `Module.link()` is unverified.
- **`DesignSpecification.measurements` write sites** — only the model + a
  migration were read; no code path that populates this JSON field was
  located (unverified).
- **Depth/normal map persistence** — the depth route returns URLs but the
  audit did not find where (if anywhere) `depth_url`/`normal_url` are stored
  back onto a design record (unverified — no grep for `depth_url` storage
  performed).
- **Unit convention** — no `unit` field exists on `DesignSizeSet`; whether
  any downstream consumer assumes cm vs inches is unverified beyond the
  designValidator prompt asking for inches.
- **`canvas_snapshot` consumers** — the imagegen workflow accepts
  `canvas_snapshot` but the audit did not trace whether any caller passes a
  moodboard-derived snapshot into it (unverified).

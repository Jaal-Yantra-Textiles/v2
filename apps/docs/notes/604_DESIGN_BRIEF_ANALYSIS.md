# #604 — Design Brief / Collection Concept: grounded analysis

**Issue:** "Design module" (#604). The owner wants designers/partners to capture
**and share** a *design brief / collection concept* through the existing stack
(admin + partner-ui + storefront). The brief has three sections:

1. **Core Identity & Concept** — Concept/Theme (story), Mood Board (images,
   textures, palettes, typography), Aesthetic Anchor (3–5 keywords).
2. **Target Audience & Market Positioning** — Persona (age, lifestyle, values,
   pain points), Competitors, Price Point.
3. **Timeline & Budget** — Key Milestones (sketch/revision/tech-spec/sample
   dates), Design Budget (separate from manufacturing cost).

> Key question: *"how can we share this in a format that they can understand
> through our stack."*

Backend lives under `apps/backend/`. Paths below are relative to that root.

---

## (a) What already exists in the design module

### Core model — `src/modules/designs/models/design.ts`
The `design` model (`model.define("design", …)`) already carries most of
section 1 and all of the cost half of section 3:

| Brief need | Existing field | Line |
|---|---|---|
| Concept/story | `description` (translatable) + `designer_notes` | `design.ts:10,52` |
| Inspiration (Concept) | `inspiration_sources: model.json()` (URL/ref array) | `design.ts:11` |
| Mood Board canvas | `moodboard: model.json()` (Excalidraw `{elements, files, appState}`) | `design.ts:66` |
| Mood Board images | `media_files: model.json()` + linked media folder (see below) | `design.ts:65` |
| Color palette | `color_palette: model.json()` **and** structured `colors` hasMany | `design.ts:45,69` |
| Aesthetic keywords | `tags: model.json()` (string array) | `design.ts:46` |
| Thumbnail | `thumbnail_url` | `design.ts:43` |
| Timeline (single date) | `target_completion_date: model.dateTime()` | `design.ts:41` |
| Design budget (cost) | `estimated_cost`, `material_cost`, `production_cost` (bigNumber), `cost_breakdown` (json), `cost_currency` | `design.ts:47-51` |
| Status / priority | `status` (10-state enum), `priority` enum | `design.ts:18-35` |
| Revision lineage | `revised_from_id`, `revision_number`, `revision_notes`, `feedback_history` | `design.ts:53-56` |
| Partner ownership | `owner_partner_id` (nullable; partner self-serve) | `design.ts:63` |

### Sub-models (hasMany, cascade-deleted)
- `design_colors` — `name`, `hex_code`, `usage_notes`, `order`
  (`models/design_color.ts`). Structured palette already exists.
- `design_size_sets` — `size_label`, `measurements` json (`models/design_size_set.ts`).
- `design_specifications` — `title`, `category` enum, `details`, `materials_required`,
  `attachments`, `version`, `status`, `reviewer_notes` (`models/design_specification.ts`).
- `design_component` — self-referential bundle (parent/component) (`models/design_component.ts`).

Service: `src/modules/designs/service.ts` (plain `MedusaService({ Design, DesignSpecification, DesignColor, DesignSizeSet, DesignComponent })`).

### Media / images
Two parallel mechanisms, both already wired:
- **Direct** `media_files` json array on the design (`{id,url,isThumbnail}`),
  validated in `src/api/admin/designs/validators.ts:62-66`.
- **Linked media folder** via a module link to the `media` module:
  `POST/DELETE src/api/admin/designs/[id]/link-media-folder/route.ts` uses
  `remoteLink.create/dismiss` between `DESIGN_MODULE` and `MEDIA_MODULE`
  (one-to-one). Folder exposes `media_files.*` through `query.graph`.
- Moodboard images are stored *inside* the Excalidraw `files` map on the
  `moodboard` json (see `src/admin/routes/designs/[id]/@print/page.tsx`,
  which resolves `moodboard.files[fileId]`).

### Cost / budget (section 3, money half) — already modeled correctly
Typed `bigNumber` columns + a structured `cost_breakdown` json
(`{ items:[{inventory_item_id,title,quantity,unit_cost,line_total,cost_source}], calculated_at, source }`),
populated by `POST .../recalculate-cost`. Partner read at
`src/api/partners/designs/[designId]/cost/route.ts`. This is the template the
brief's **Design Budget** should follow — typed columns, not metadata.

### Tasks = the milestone substrate (section 3, timeline half)
There is a full `tasks` module (`src/modules/tasks/models/task.ts`): `title`,
`start_date`, `end_date`, `status`, `priority`, `estimated_cost`/`actual_cost`,
`completed_at`, dependencies, subtasks. Design tasks are exposed at
`src/api/admin/designs/[id]/tasks/` and `src/api/partners/designs/[designId]/tasks/`.
Milestones (sketch / first revision / tech-spec / sample dates) map naturally
onto tasks with `end_date` as the milestone date — no new milestone entity needed.

### Existing share / render surfaces (answers "share in a format they understand")
- **Admin print view** `src/admin/routes/designs/[id]/@print/page.tsx` — already
  renders colors, size sets, specs, moodboard (with image resolution) and media
  as an A4-print-styled tech pack. This is 80% of a "brief PDF" already.
- **Admin preview** `src/admin/routes/designs/@preview/[id]/page.tsx`.
- **Public opt-in share endpoint pattern** — `src/api/web/stats/panels/[id]/data/route.ts`
  (#341): NOT public by default; only `metadata.public === true` resolves, else
  identical 404 (no existence leak); `Cache-Control: s-maxage`. This is the exact
  pattern to reuse for a public brief link.
- **Partner-ui** already has design routes incl. a moodboard:
  `apps/partner-ui/src/routes/designs/{design-detail,design-moodboard,design-edit,design-create}`.
  Partner validators already accept `moodboard`, `color_palette`,
  `inspiration_sources`, `tags` (`src/api/partners/designs/validators.ts`).

---

## (b) Gap analysis per brief section

### Section 1 — Core Identity & Concept → ~90% EXISTS
- Concept/Theme → `description`/`designer_notes` (free text). **Gap:** a dedicated
  short **`concept_theme`** title field would read better than reusing description,
  but optional — reuse is acceptable for v1.
- Mood Board → `moodboard` (Excalidraw) + `media_files` + linked folder. **EXISTS.**
- Aesthetic Anchor (3–5 keywords) → `tags`. **EXISTS** (just constrain to ≤5 in UI).
- **No new columns strictly required for section 1.**

### Section 2 — Target Audience & Market Positioning → MISSING
Nothing models persona, competitors, or price-point positioning today.
- Persona (age range, lifestyle, values, pain points) → **NEW** (structured).
- Competitors (name + how-we-differ) → **NEW** (list).
- Price Point (luxury / mid-market / budget) → **NEW** (enum) — note this is a
  *positioning tier*, distinct from the numeric `*_cost` budget fields.

### Section 3 — Timeline & Budget → SPLIT
- Key Milestones → **EXISTS via tasks** (use `tasks` with dated `end_date`s; add a
  light `kind` tag/category to mark a task as a brief milestone). Optionally a
  typed `design_budget` is separate from the cost columns.
- Design Budget (separate from manufacturing) → **partial.** `estimated_cost` etc.
  conflate *manufacturing/material* cost. The brief wants a **design-phase budget**.
  **Gap:** a dedicated typed `design_budget` (bigNumber) + reuse `cost_currency`.

---

## (c) Proposed data model + migration approach (respects the no-metadata rule)

**Project rule (MEMORY): never put load-bearing/mutated state in `metadata`** —
Medusa replaces the whole metadata blob on update. The brief is load-bearing and
edited often, so it gets typed columns, not metadata.

Two viable shapes; recommend **Option A (typed columns on `design`)** for v1
because the brief is 1:1 with a design and small, and it keeps reads cheap.

### Option A — add typed columns to `design` (recommended for v1)
Add to `src/modules/designs/models/design.ts`:
```ts
// Section 1 (optional nicety)
concept_theme: model.text().translatable().nullable(),     // short story/title
// Section 2 — market positioning
persona: model.json().nullable(),        // { age_range, lifestyle, values[], pain_points[] }
competitors: model.json().nullable(),    // [{ name, url?, differentiator }]
price_point: model.enum(["luxury","mid_market","budget"]).nullable(),
// Section 3 — design-phase budget (distinct from material/production cost)
design_budget: model.bigNumber().nullable(),
// design_budget reuses existing cost_currency
```
`persona` and `competitors` are structured JSON **value objects** (read+written
as a whole through the design update route) — acceptable as `model.json()` because
they're not independently-mutated rows and are validated by Zod on write. They are
NOT in `metadata`, so the "metadata blob replace" hazard does not apply.

Milestones: **do not add a new model** — represent each milestone as a `task`
linked to the design with a `metadata.milestone_kind` *or* (cleaner) a new
`task` enum — but since tasks are shared, prefer filtering brief milestones by a
convention (e.g. a `kind` column add on task if needed, deferred). For v1, surface
the existing design tasks with dates as the "milestones" timeline.

### Option B — a linked `design_brief` sub-entity (if it should be 1:N or sharable independently)
`model.define("design_brief", { id, concept_theme, persona(json), competitors(json),
price_point(enum), design_budget(bigNumber), budget_currency, share_token, is_public,
public_set_by, public_set_at, design: belongsTo(Design) })`. Use only if you want
versioned briefs or a brief that can exist before a design. Heavier; defer unless
the 1:N need is real.

### Migration approach — hand-written incremental ALTER (mandatory)
Follow `src/modules/designs/migrations/Migration20260605065627.ts` exactly: the
auto-generator emits a `create table if not exists` snapshot that is a **no-op on
the existing prod `design` table** (documented hazard in MEMORY:
"create-if-not-exists hazard"). Hand-write:
```sql
alter table if exists "design" add column if not exists "concept_theme" text null;
alter table if exists "design" add column if not exists "persona" jsonb null;
alter table if exists "design" add column if not exists "competitors" jsonb null;
alter table if exists "design" add column if not exists "price_point" text null;
alter table if exists "design" add column if not exists "design_budget" numeric null;
```
Then regenerate + stage the `.snapshot-design.json`.

---

## (d) API + partner-ui surface

### Admin
- Extend `designSchema`/`UpdateDesignSchema` in `src/api/admin/designs/validators.ts`
  with zod for `concept_theme`, `persona`, `competitors`, `price_point`,
  `design_budget`. **Watch-out (MEMORY):** re-declare any `.default()` field as
  `.optional()` on the update schema — `.partial()` does NOT strip defaults and
  will inject values into partial updates.
- No new routes needed for the fields themselves — `PUT /admin/designs/:id`
  already persists arbitrary design columns via the update path. Milestones reuse
  the existing `[id]/tasks/` routes.

### Partner mirror (convention: `/partners/*` mirrors `/admin/*` wire shape)
- Add the same fields to `src/api/partners/designs/validators.ts` (it already
  mirrors moodboard/color_palette/tags). Partner write must stay scoped via
  `assertPartnerOwnsDesign` (already used across partner design routes).
- Partner read: include the new fields in `[designId]/route.ts` and a brief read,
  scoped to the owning partner.

### Partner-ui
- Add a **"Brief" tab/section** to `apps/partner-ui/src/routes/designs/design-detail`
  and the edit form (`design-edit/components/edit-design-form`): Concept (text),
  Aesthetic keywords (chips → `tags`), Moodboard (existing `design-moodboard`
  route), Persona/Competitors/Price-point form, Design Budget, and a Milestones
  list reading the design tasks. Reuse existing moodboard component.

---

## (e) Sharing / render approach ("a format they can understand")

Three concentric levels, cheapest first:

1. **Admin print/tech-pack (exists, extend).** `@print/page.tsx` already renders
   colors/sizes/specs/moodboard/media as A4. Add the brief sections (concept,
   keywords, persona, competitors, price point, budget, milestones) to it →
   one-click **Print → PDF** brief. Smallest lift, immediately shareable.
2. **Partner-ui brief view (exists surface, extend).** Same data rendered in the
   partner dashboard so collaborating partners read it natively in-app.
3. **Public opt-in share link (new, reuse #341 pattern).** Mirror
   `src/api/web/stats/panels/[id]/data/route.ts`: a `GET /web/designs/:id/brief`
   that returns the brief **only when explicitly shared** (typed `is_public`
   boolean or an unguessable `share_token` column — typed, not metadata), 404 on
   private/unknown (no existence leak), `Cache-Control: s-maxage`. A lightweight
   storefront/marketing page renders it for non-logged-in stakeholders. Strip
   internal fields (raw costs, internal notes) server-side, exactly like
   `stripExcludedColumns`.

Recommended sequence: ship 1 + 2 first (no auth surface), add 3 when an external
share is actually requested.

---

## (f) Phased PR build order

- **PR A — model + migration.** Add `concept_theme`, `persona`, `competitors`,
  `price_point`, `design_budget` to `design.ts`; hand-written ALTER migration
  (if-not-exists) + regenerated snapshot. Unit-test nothing UI; this is data.
- **PR B — admin validators + read/write.** Extend `validators.ts`
  (optional-not-default on update), ensure `PUT /admin/designs/:id` persists them,
  expose in admin design detail UI fields. Add brief sections to `@print/page.tsx`.
- **PR C — partner mirror.** Mirror validators + fields into
  `src/api/partners/designs/`, scoped via `assertPartnerOwnsDesign`; pure
  scope/serialize helper + unit tests (follows the existing partner-design test
  pattern, e.g. `__tests__/components-scope.unit.spec.ts`).
- **PR D — partner-ui Brief tab.** Brief section in design-detail + edit form;
  reuse existing moodboard route; milestones list from design tasks.
- **PR E — milestones polish (optional).** Light `kind`/category to flag a task as
  a brief milestone + a milestone-focused timeline view; or defer and just reuse
  dated tasks.
- **PR F — public share link (optional, on demand).** `is_public`/`share_token`
  typed columns + `GET /web/designs/:id/brief` (mirror #341 opt-in/404/cache +
  server-side field stripping) + a minimal storefront render page.

Each PR is independently shippable; A is the only hard prerequisite for B–D.

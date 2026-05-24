# Partner API ↔ Admin API parity audit

> Status: **LIVING DOC** — update on every partner-route PR.
> Date: 2026-05-24
> Owner: Saransh
> Companion to `apps/docs/notes/SAAS_TIERS.md` (tier strategy) and the convention memory `feedback_partner_api_mirrors_admin.md`.

## Why this doc exists

The tier-agnostic contract from `SAAS_TIERS.md` requires every `/partners/...` route that has a `/admin/...` counterpart to mirror the admin wire contract exactly — request body, response envelope, query params, verbs, error shape. Scoping logic (per-partner ownership, clone-on-write, ref-counted delete) lives inside the handler; it does not change the wire shape.

This doc is the **audit template** and the **drift detection mechanism**:
- **Audit template** — when adding a new partner route, fill in the comparison table below before writing code.
- **Drift detection** — every audited module gets a corresponding parity integration test under `integration-tests/http/partner-api-parity/`. The test hits admin and partner with equivalent inputs and asserts envelope-shape identity. When Medusa upgrades and admin's shape changes, the partner test fails and forces the partner shape to move with it.

## The 8-row audit template

When auditing a partner module against its admin counterpart, produce a table with these 8 rows. Source of truth = `apps/backend/node_modules/@medusajs/medusa/dist/api/admin/<module>/` (local Medusa source, not docs.medusajs.com — docs lag).

| Aspect | Admin (authoritative) | Partner today | Action |
|---|---|---|---|
| List response envelope | `{ <resource>s, count, offset, limit }` | | |
| Single response envelope | `{ <resource> }` | | |
| Delete response envelope | `{ id, object: "<resource>", deleted: true }` | | |
| Create body validator | `AdminCreate<Resource>` fields + .strict() | | |
| Update body validator | `AdminUpdate<Resource>` fields + .strict() | | |
| Update HTTP verb | (Medusa v2: usually POST, not PATCH) | | |
| Workflow / service call | `<verb><Resource>sWorkflow` from `@medusajs/medusa/core-flows` | | |
| Default `fields` selection | from admin `query-config.js` | | |
| List filters accepted | from admin list validator | | |
| Pagination defaults | from admin `listTransformQueryConfig` | | |

Two additional bookkeeping rows specific to the partner side:
| Partner-only addition | What | Notes |
|---|---|---|
| Scoping link | `partner_<module>` link table — source of truth for "this row belongs to this partner" | If missing, create it; M:N on both sides for symmetry |
| Enrichment fields | Inlined extras on single GET (e.g. `payment_providers` on region) | Allowed; not contract divergence. New top-level envelope keys are NOT allowed. |

**Intentional divergences** get a `// PARITY-NOTE:` comment in the route file and an entry in the per-module section below, so future audits don't "fix" them back.

## Audit register

One section per partner module. Status: ✅ matches admin / ⚠️ drift identified / 🔧 fix scheduled / 🆕 new audit needed.

### Region

- **Status:** 🔧 drift identified, scheduled in PR A (`feat/partner-regions-admin-parity`).
- **Admin source:** `apps/backend/node_modules/@medusajs/medusa/dist/api/admin/regions/`
- **Partner source:** `apps/backend/src/api/partners/stores/[id]/regions/`
- **Scoping link:** `apps/backend/src/links/partner-region.ts` ✓ exists
- **Drifts to fix in PR A:**
  - Create + update validators missing `is_tax_inclusive`, not `.strict()`
  - Update handler calls `regionService.updateRegions` directly instead of `updateRegionsWorkflow`
  - List endpoint hardcodes `offset/limit` and `fields` inside the handler — should pass through query middleware
  - List endpoint does not accept admin filters (`q`, `id`, `currency_code`, `name`, timestamp operators, `$and`/`$or`)
  - Single-region GET hardcodes its `fields` array — should respect `?fields=` query param
- **Partner-only additions:**
  - `payment_providers` inlined on single GET — enrichment, kept
  - Ownership filter via `partner_region` link on every verb
  - Clone-on-write inside update handler when link count > 1 — **constrained by the data-model finding below**
  - Ref-counted delete (only invoke `deleteRegionsWorkflow` when last partner linked)
- **Intentional divergences:** none in PR A.
- **Data-model constraint surfaced by tests:** Medusa's `country.region_id` is 1:N — each country belongs to exactly one region row. So clone-on-write *cannot* fire when a shared region has assigned countries (`createRegionsWorkflow` rejects with `"Countries with codes: ... are already assigned to a region"`, and giving up the countries on the original would break the other linked partners). The handler instead returns `NOT_ALLOWED` with a message explaining the situation and pointing the partner at the platform admin. Clone-on-write still works for the (rare) shared-without-countries case. This finding came directly from the parity test suite catching a 400 — exactly the drift-detection use case the suite was designed for. Follow-up consideration: admin-side workflow for "platform admin provisions a per-partner region" path (tracked in `feedback_partner_region_extend_not_lockdown` memory).

### Tax Region

- **Status:** 🔧 drift identified, scheduled in PR B.
- **Admin source:** `apps/backend/node_modules/@medusajs/medusa/dist/api/admin/tax-regions/`
- **Partner source:** `apps/backend/src/api/partners/stores/[id]/tax-regions/`
- **Scoping link:** ❌ `partner_tax_region` does **not** exist yet — PR B introduces it.
- **Drifts to fix in PR B:**
  - Create handler does not inject `created_by: req.auth_context.actor_id`
  - Update validator missing `provider_id`
  - Update handler calls `taxService.updateTaxRegions` directly instead of `updateTaxRegionsWorkflow`
  - List endpoint hardcodes filters and pagination; supports only `country_code`
  - Default fields don't include the full tree (`*children.tax_rates.rules`, `*parent`, etc.)
- **Partner-only additions:**
  - Ownership filter via the new `partner_tax_region` link on every verb
  - Clone-on-write + ref-counted delete (same recipe as regions)
- **Intentional divergences:**
  - Single-region GET throws `MedusaError.NOT_FOUND` when missing. Admin silently returns `{ tax_region: undefined }` (Medusa quirk). The partner side keeps the throw — better UX, and the parity test asserts shape-only on present rows. `// PARITY-NOTE:` in the route file will document this.

### Sales Channel

- **Status:** 🆕 audit not yet run — scheduled for PR C.

### Shipping Option

- **Status:** 🆕 audit not yet run — scheduled for PR C.

### Fulfillment Set / Location

- **Status:** 🆕 audit not yet run — scheduled for PR C.

### Product / Product Variant

- **Status:** ⚠️ partial — partner-side product routes already exist and have heavy custom logic for partner inventory. Full audit deferred; needs special-case treatment because the `inventory_items` scope is genuinely different per partner.

## Parity integration tests

### Where

`integration-tests/http/partner-api-parity/<module>.spec.ts`. One file per audited module. Lives in the existing integration-tests tree so it shares the dev-DB and bootstrap with the rest of the partner suite.

### Pattern

Each test seeds **the same fixture twice**: once via admin (the canonical row), once via partner (the partner-owned row). Then it hits the corresponding admin and partner endpoints and asserts that the **response envelope shape is identical** — same top-level keys, same nested object shape on the resource itself.

Values are allowed to differ (admin sees N rows, partner sees only their own; admin may see fields a partner shouldn't). The assertion is shape-equality, not value-equality.

### Test helper signature

```ts
// integration-tests/http/partner-api-parity/_helpers.ts
export function assertEnvelopeShape(admin: unknown, partner: unknown) {
  // Same top-level keys
  expect(Object.keys(admin as object).sort())
    .toEqual(Object.keys(partner as object).sort())
}

export function assertResourceShape<T extends object>(
  adminResource: T | undefined,
  partnerResource: T | undefined,
  options?: { ignoreKeys?: string[] }
) {
  if (!adminResource || !partnerResource) return  // tolerate absence
  const ignore = new Set(options?.ignoreKeys ?? [])
  const adminKeys = Object.keys(adminResource).filter(k => !ignore.has(k)).sort()
  const partnerKeys = Object.keys(partnerResource).filter(k => !ignore.has(k)).sort()
  expect(partnerKeys).toEqual(expect.arrayContaining(adminKeys))
  // partner is allowed to have ADDITIONAL keys (enrichment, e.g. payment_providers)
  // but must include every admin key
}
```

The `expect.arrayContaining` shape lets partner add enrichment fields (`payment_providers` inlined on region) without breaking the test. Top-level envelope keys are strict equality — adding a new top-level key on partner that doesn't exist on admin **should** fail.

### Test skeleton per route

```ts
// integration-tests/http/partner-api-parity/regions.spec.ts
describe("parity: GET /regions list", () => {
  it("envelope shape matches admin", async () => {
    const admin = await adminApi.get("/admin/regions?limit=5")
    const partner = await partnerApi.get(`/partners/stores/${storeId}/regions?limit=5`)
    assertEnvelopeShape(admin.data, partner.data)
    assertResourceShape(admin.data.regions[0], partner.data.regions[0], {
      ignoreKeys: ["payment_providers"]  // partner enrichment
    })
  })
})

describe("parity: POST /regions create", () => {
  it("request body validator accepts admin's body shape", async () => {
    const body = { name: "Test", currency_code: "usd", countries: ["us"], is_tax_inclusive: false }
    const admin = await adminApi.post("/admin/regions", body)
    const partner = await partnerApi.post(`/partners/stores/${storeId}/regions`, body)
    assertEnvelopeShape(admin.data, partner.data)
    assertResourceShape(admin.data.region, partner.data.region, {
      ignoreKeys: ["payment_providers"]
    })
  })
})
```

### What the parity tests do NOT cover

- **Per-partner ownership behavior** — covered by dedicated tests under `integration-tests/http/partner-regions/` (separate file, not the parity suite). Those tests check clone-on-write, ref-counted delete, ownership 404s.
- **Functional correctness of admin endpoints** — Medusa's own test suite is authoritative for admin.
- **Workflow internals** — covered by Medusa core tests.

The parity suite is purely a wire-contract drift detector.

### Running them

```bash
# Just the parity suite
pnpm test:integration:http:shared ./integration-tests/http/partner-api-parity

# Single module
pnpm test:integration:http:shared ./integration-tests/http/partner-api-parity/regions.spec.ts
```

Use `:shared` (shared DB) per CLAUDE.md — parallel workers exhaust PG locks otherwise.

## Workflow when adding a new partner route

1. Fill in the audit table for the module (8 standard rows + 2 partner-only).
2. Add a section under "Audit register" above with the drifts identified.
3. Implement the partner route to match admin shape, layering scoping logic inside.
4. Add a parity spec under `integration-tests/http/partner-api-parity/<module>.spec.ts` using the helper from above.
5. Add a per-partner behavior spec under `integration-tests/http/partner-<module>/` for ownership / clone-on-write / ref-counted delete.
6. Update the audit register status to ✅ when both test suites pass.

## When admin shape changes (Medusa upgrade)

When upgrading `@medusajs/medusa`, expect parity tests to fail. The failing assertion tells you which envelope key or resource key drifted. Update the partner validator / handler / query-config to match the new admin shape. Document any new intentional divergences here.

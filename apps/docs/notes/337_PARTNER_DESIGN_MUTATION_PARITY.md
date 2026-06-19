# #337 — Partner-design mutation parity: remaining decision-bearing routes

_Written 2026-06-19 (daemon chunk 4/10). Companion to the merged read/AI-parity
slices and PR #531 (`revise`)._

## Status of #337 design parity

| Admin subroute | Method | Partner mirror | Notes |
|---|---|---|---|
| `revisions` | GET | ✅ #520 | merged |
| `used-in` | GET | ✅ #524 | merged |
| `components` | GET | ✅ #527 | merged |
| `tasks` | GET | ✅ #528 (open) | read-only |
| `consumption-logs` / `inventory` / `production-runs` / `recalculate-cost` | GET/POST | ✅ earlier phases | self-serve already shipped |
| `segment` | POST | ✅ #529 (open) | fal BiRefNet, quota-gated |
| `segment/depth` | POST | ✅ #530 (open) | fal MiDaS, quota-gated |
| **`revise`** | **POST** | **✅ #531 (open)** | **this chunk — own-design fork, ownership preserved** |
| `approve` | POST | ❌ decision | see below |
| `notify-customer` | POST | ❌ decision | see below |
| `partner` | POST/DELETE | ❌ admin-only | see below |
| `cancel-partner-assignment` | POST | ❌ decision | see below |
| `link-media-folder` | POST/DELETE | ❌ near-clean | see below |

**All GET (read), both AI POSTs, and the own-design `revise` POST are now
mirrored.** What remains are 5 mutating routes that each raise a product
question. Recommendations below, ranked easiest → hardest.

---

## 1. `link-media-folder` (POST + DELETE) — **near-clean, build next**
`apps/backend/src/api/admin/designs/[id]/link-media-folder/route.ts`

Links/replaces (one-to-one) a media **folder** to the design via `remoteLink`.
Partner already has a `media` GET subroute, so managing their own design's
media folder is natural self-serve.

- **The one gap:** must add a **folder-ownership guard**. Today the admin route
  trusts any `folder_id`; a partner could otherwise link/steal-display another
  tenant's (or admin's) folder. Need an `assertPartnerOwnsFolder(req, folder_id)`
  helper (check folder's owning partner / store) alongside `assertPartnerOwnsDesign`.
- **Recommendation:** buildable once folder-ownership scoping exists. Confirm how
  media folders are owned/scoped per partner first (check `modules/media` +
  any `*_partner` link). If folders are not partner-scoped yet, this is blocked
  on that model work — escalate.

## 2. `revise` — **DONE this chunk (PR #531).** Reference implementation for "own-design mutation".

## 3. `approve` (POST) — **decision-bearing (heavy)**
`approve/route.ts`

Transitions design → `Approved`, **creates a real Medusa product/variant**
(`createProductFromDesignWorkflow`), and emits `design.approved`.

Open decisions before a partner mirror:
- **Should partners self-approve at all?** Approval publishes a sellable product
  to a storefront — this is the core "partner self-serve commerce" gate. Aligns
  with the SaaS vision but is a real authority decision.
- **Currency:** admin hardcodes `currency_code: "usd"`. A partner mirror MUST use
  `resolveStoreCurrency(container, {partnerId})` (the #485 helper, PR #505) — this
  is exactly the EUR-leak class of bug.
- **Sales channel:** the created product must be scoped to the **partner's** store
  sales channel, not the platform default (storefront isolation).
- **Customer link:** admin looks up a design→customer link; partner-owned designs
  may have no customer. Decide behaviour when absent (already handled as `""`).
- **Recommendation:** build only after a product call on (a) self-approve gating
  and (b) wiring currency + sales-channel from the partner store. Ties into #485.

## 4. `notify-customer` (POST) — **decision-bearing (depends on #332)**
`notify-customer/route.ts`

Sends/re-sends the "design assigned" email to the **customer** linked to the
design, with a URL hardcoded to `STORE_URL`/`cicilabel.com`.

- **Decisions:** which email template/branding for a partner-originated notice;
  the storefront URL must derive from the **partner's** storefront (the #377
  `resolvePartnerStorefrontUrl` pattern), not `cicilabel.com`.
- **Dependency:** partner email deliverability (#332) should be confirmed first.
- **Recommendation:** defer until #332 closes; then mirror with partner-storefront
  URL + partner-branded template.

## 5. `cancel-partner-assignment` (POST) — **reframe, not a direct mirror**
`cancel-partner-assignment/route.ts`

Admin action **about** a partner: cancels that partner's active production runs +
tasks and optionally unlinks. Semantically this is "admin pulls work from a partner".

- A partner doing this to **themselves** is conceptually "**decline / withdraw from
  this assignment**", which is a different UX and may need different side-effects
  (e.g. notify admin, leave the design assignable). Don't blindly mirror.
- **Recommendation:** design a partner-facing "decline assignment" route rather
  than mirroring the admin cancel verbatim. Decision-bearing.

## 6. `partner` (POST link / DELETE unlink) — **keep admin-only**
`partner/route.ts`

Links/unlinks **partners** to a design — i.e. assignment authority. A partner
managing design↔partner links (especially adding *other* partners) is a clear
authority violation; a partner linking *themselves* already happens implicitly at
design creation.

- **Recommendation:** do **not** mirror to partner-ui. Assignment stays an admin
  capability. Close this as out-of-scope for partner self-serve.

---

## Suggested build order (once decisions land)
1. `link-media-folder` — after confirming/adding partner folder ownership.
2. `approve` — after self-approve + currency/sales-channel decision (with #485 helper).
3. `notify-customer` — after #332 + partner-storefront URL.
4. `cancel-partner-assignment` — redesign as "decline assignment".
5. `partner` — keep admin-only (no mirror).

## Recipe reference
All partner-design routes follow the parity recipe in
`scripts/agent-daemon/CODEBASE_MAP.md` (§ Partner API parity): copy the admin
handler shape, add `assertPartnerOwnsDesign` (ownership = full boundary for
own-design ops; add a scope-filter only when a cross-design relation can leak),
register a per-route `authenticate("partner", …)` matcher in `middlewares.ts`,
extract pure helpers for unit tests (no integration harness exists).

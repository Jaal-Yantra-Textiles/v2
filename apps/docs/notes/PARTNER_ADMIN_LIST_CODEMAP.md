# Partner Admin List & Filter — Codemap

> The full request path behind the admin **Partners** listing page, its search box
> and filters, plus the sharp edges. Written while fixing the "intermittently the
> filter does not work" bug (2026-07-03). Keep this current when the list surface
> changes.

## TL;DR

- The Partners list is a **server-side** filtered/searched/paginated `DataTable`.
- Free-text search (`q`) → backend `$or`/`$ilike` over `name` + `handle`.
- Structured filters (`status`, `is_verified`, `name`, `handle`) → exact-match
  query params.
- **The bug we fixed:** the search box's `search` state was wired into
  `useDataTable` but never passed as `q` to `usePartners()`, so typing in the box
  did nothing while column filters worked → "intermittent". Fix = pass
  `q: search` + reset pagination to page 0 on search/filter change.

## Request path (top → bottom)

```
DataTable.Search / FilterMenu  (Medusa UI)
  → page.tsx  state: search, filtering, pagination, sorting
    → usePartners(query)                 src/admin/hooks/api/partners-admin.ts
      → sdk.client.fetch GET /admin/partners
        → middleware validateAndTransformQuery(listPartnersQuerySchema)
          → route.ts GET                 src/api/admin/partners/route.ts
            → buildQSearchFilter(q, [...]) src/lib/list-search-filters.ts
            → listPartnersWorkflow (filters, offset, limit, order)
              → { partners, count, offset, limit }
```

## Files

| Role | Path |
|------|------|
| **UI page (table + search + filters)** | `apps/backend/src/admin/routes/partners/page.tsx` |
| **Data hook** | `apps/backend/src/admin/hooks/api/partners-admin.ts` (`usePartners`, `AdminPartnersQuery`) |
| **Table columns** | `apps/backend/src/admin/hooks/columns/usePartnerTableColumns.ts` |
| **List route (GET) + create (POST)** | `apps/backend/src/api/admin/partners/route.ts` |
| **Query/body validators** | `apps/backend/src/api/admin/partners/validators.ts` (`listPartnersQuerySchema`) |
| **Middleware wiring** | `apps/backend/src/api/middlewares.ts` (`validateAndTransformQuery(wrapSchema(listPartnersQuerySchema))` for `GET /admin/partners`) |
| **Free-text search helper** | `apps/backend/src/lib/list-search-filters.ts` (`buildQSearchFilter`) |
| **Working reference (same pattern)** | `apps/backend/src/admin/routes/persons/page.tsx` + `admin/persons/partner/route.ts` |

## How search vs filters actually work

### Free-text search (`q`)
- UI: `<DataTable.Search />`; `useDataTable({ search: { state: search, onSearchChange: handleSearchChange } })`.
- `handleSearchChange` is a 300ms `debounce` that sets `search` **and** resets `pageIndex` to 0.
- `usePartners({ ..., ...(search ? { q: search } : {}) })` sends `q`.
- Backend: `buildQSearchFilter(q, ["name","handle"])` →
  `{ $or: [{ name: { $ilike: "%q%" } }, { handle: { $ilike: "%q%" } }] }`.
- **Case-insensitive, substring** match. `$ilike` at the DB layer keeps `count`
  (and therefore pagination) correct — do NOT filter in-app.

### Structured filters (FilterMenu)
- `filterHelper.accessor(...)` builds `select` filters for
  `status | is_verified | name | handle`.
- `handleFilterChange` (300ms debounce) sets `filtering` **and** resets page 0.
- `page.tsx` reduces `filtering` → flat query params (single value; arrays are
  unwrapped `value[0]`, `is_verified` coerced `"true"→true`).
- Backend does **exact match** on these (`req.query?.name` etc.), NOT `$ilike`.

### Order / pagination
- `order` param: `"field:DESC"` or `"-field"`; route's `parseOrder` defaults to
  `{ created_at: "DESC" }`.
- `offset = pageIndex * pageSize`; `limit = pageSize` (default 10 in UI, route
  caps `limit ≤ 200`).

## Validator contract (must stay in sync)

`listPartnersQuerySchema` MUST allow every param the UI sends, or
`validateAndTransformQuery` rejects with `Unrecognized fields: ...` and the table
renders empty. Currently allowed: `fields, offset, limit, q, name, handle,
status, is_verified`. `is_verified` is a **string enum** `"true"|"false"` on the
wire (coerced to bool server-side). `AdminPartnersQuery` (hook type) should mirror
this — it now includes `q?` and `order?`.

## Sharp edges / watch-outs

1. **Search state must reach the query.** Wiring `search` into `useDataTable`
   only drives the input UI — you must ALSO pass `q` into `usePartners`. This was
   the bug. Symptom: box types but nothing filters, while FilterMenu works.
2. **Reset pagination on search/filter change.** Otherwise a narrowed result set
   on page 2+ renders an empty table (looks like "filter broke"). Both debounced
   handlers now `setPagination(pageIndex → 0)`.
3. **`name` / `handle` select-filter options are derived from the CURRENT PAGE's
   `partners` only** (`partners.map(...)` in `page.tsx`). A partner not on the
   visible page won't appear as a dropdown option — genuinely "intermittent".
   Prefer the free-text search for finding a partner by name/handle; treat the
   `name`/`handle` selects as convenience for what's on screen. (Future: drop
   these two selects, or feed them from a dedicated distinct-values query.)
4. **`$ilike` needs escaping for literal `%`/`_`** if a partner name contains
   them — currently unescaped (low risk for partner names).
5. **Every `/admin/partners` list param needs a validator entry** (see contract
   above). Adding a filter = touch three places: `page.tsx` (send), hook type,
   validator (allow), route (apply).
6. Mirrors the **persons** list pattern — when in doubt, diff against
   `admin/routes/persons/page.tsx` + `admin/persons/partner/route.ts`.

## The fix (2026-07-03)

`apps/backend/src/admin/routes/partners/page.tsx`
- Pass `...(search ? { q: search } : {})` into `usePartners(...)`.
- Both `handleSearchChange` and `handleFilterChange` reset `pageIndex` to 0.

`apps/backend/src/admin/hooks/api/partners-admin.ts`
- `AdminPartnersQuery` gains `q?: string` and `order?: string` (were passed via
  spread, now first-class/typed).

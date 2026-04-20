---
title: "Stats Module — Analytics Dashboards & Panels"
sidebar_label: "Module"
sidebar_position: 0
---

# Stats Module

Internal analytics dashboards, modeled on Directus Insights. Operators create **dashboards** composed of **panels**; each panel is a serialized call against the existing `visual_flows` operation registry. No new source/query layer — panels reuse `read_data`, `aggregate_data`, `time_series`, and `aggregate_product_analytics`.

**Who it's for:** internal / admin-only. No end-user permissions. The same dashboards are also the source for numbers embedded in blog posts via Tiptap (see [Stats Panels in Blogs](./blog-integration)).

## System Overview

```
┌─────────────────────────────────┐
│ Admin UI: /stats                │
│   - list dashboards             │
│   - /stats/:id grid of panels   │
│   - panel editor (JSON + form)  │
└─────────────────┬───────────────┘
                  │
                  ▼
┌─────────────────────────────────┐
│ /admin/stats/*                  │
│   dashboards CRUD               │
│   panels CRUD                   │
│   /panels/:id/data  ← resolver  │
│   /panels/preview   ← dry-run   │
│   /operations       ← registry  │
└─────────────────┬───────────────┘
                  │
                  ▼
┌─────────────────────────────────┐
│ Stats service                   │
│   resolvePanel(panel):          │
│     1. lookup operation in      │
│        visual_flows registry    │
│     2. build stub context       │
│     3. execute(options, ctx)    │
│     4. apply TTL cache          │
└─────────────────┬───────────────┘
                  │
                  ▼
┌─────────────────────────────────┐
│ operationRegistry               │
│   (shared with visual_flows)    │
│   - read_data                   │
│   - aggregate_data   (new)      │
│   - time_series      (new)      │
│   - aggregate_product_analytics │
└─────────────────────────────────┘
```

## Data Model

Two tables in `src/modules/stats/`.

### `stats_dashboard`

| Field | Type | Notes |
|---|---|---|
| `id` | id, prefix `dash` | PK |
| `name` | text | Display name |
| `description` | text nullable | |
| `icon` | text nullable | Medusa icon slug |
| `color` | text nullable | Accent |
| `metadata` | json default `{}` | Dashboard-level extras |
| `panels` | hasMany → stats_panel | |

### `stats_panel`

| Field | Type | Notes |
|---|---|---|
| `id` | id, prefix `panel` | PK |
| `dashboard_id` | text | FK → stats_dashboard |
| `name` | text | Header title |
| `type` | enum | `metric` \| `list` \| `table` \| `bar` \| `line` \| `area` \| `label` |
| `x`, `y`, `width`, `height` | int | Grid units (12-col) |
| `operation_type` | text | Key from `operationRegistry` |
| `operation_options` | json | Validated by the operation's `optionsSchema` on write |
| `display` | json default `{}` | `{ field, label, format, prefix, suffix, color, xAxis, yAxis, groupBy, dateField, precision, limit, decimals, conditionalFormatting[] }` |
| `cache_ttl_seconds` | int nullable | null = no cache |
| `metadata` | json default `{}` | |

Migration: `src/modules/stats/migrations/Migration20260420091906.ts`.

## Shared Operations

Live in `src/modules/visual_flows/operations/` so flows can also use them.

### `aggregate_data`

File: `src/modules/visual_flows/operations/aggregate-data.ts`

```typescript
{
  entity: string,
  fields?: string[],
  filters?: Record<string, any>,
  aggregate: {
    fn: "count" | "sum" | "avg" | "min" | "max" | "count_distinct",
    field?: string,                   // required for non-count
  },
  groupBy?: string | string[],
  limit?: number,
  fetchLimit?: number,                // default 10_000
  sort?: "asc" | "desc"               // default desc
}
```

Returns `{ value, row_count, truncated }` or `{ groups: [{ key, keys, value }], row_count, group_count, truncated }`.

### `time_series`

File: `src/modules/visual_flows/operations/time-series.ts`

```typescript
{
  entity: string,
  dateField: string,
  filters?: Record<string, any>,
  aggregate: { fn, field? },
  precision: "day" | "week" | "month",
  range: { from: ISO, to: ISO } | { last_days: number },
  groupBy?: string,                   // series split
  fetchLimit?: number,                // default 50_000
  fillGaps?: boolean                  // default true
}
```

Returns `{ buckets: [{ date, value, series? }], row_count, truncated, precision, from, to }`.

Both registered in `src/modules/visual_flows/operations/index.ts` alongside `read_data` and `aggregate_product_analytics`.

### Query.graph limitation

`query.graph` doesn't support DB aggregations (count/sum/group-by). Both new ops fetch rows then aggregate in-process. For partner/design volumes (hundreds to thousands) this is fine. For large tables prefer an already-rolled entity (e.g. `analytics_daily_stats` instead of `analytics_event`). If a single panel needs raw aggregation over millions of rows, add a typed service method with `@InjectManager()` + `manager.execute(...)` and register a new operation.

## Panel → Operation Context Adapter

`src/modules/stats/resolver.ts`:

```typescript
function buildPanelContext(container, panel): OperationContext {
  return {
    container,
    dataChain: { $trigger: {...}, $accountability: { triggered_by: "stats_panel" }, $env: {}, $last: null },
    flowId: `panel:${panel.dashboard_id ?? "preview"}`,
    executionId: `panel-render-${panel.id}-${Date.now()}`,
    operationId: panel.id,
    operationKey: panel.id,
  }
}
```

Template interpolation (`{{ $trigger.foo }}`) is not meaningful for panels — don't use templated strings in `operation_options`.

## Caching

`src/modules/stats/cache.ts` — in-process `Map` keyed by `{panel.id}:{hash(operation_options)}`. TTL per panel. Invalidated on panel update / delete. Single-process only; swap for Medusa's cache module if multi-instance ever matters.

## API Routes

All under `src/api/admin/stats/`. Zod-validated inline.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/admin/stats/dashboards` | List (with `q`, `limit`, `offset`) |
| `POST` | `/admin/stats/dashboards` | Create |
| `GET` | `/admin/stats/dashboards/:id` | Read (includes panels) |
| `PUT` | `/admin/stats/dashboards/:id` | Update |
| `DELETE` | `/admin/stats/dashboards/:id` | Delete (cascades panels) |
| `POST` | `/admin/stats/dashboards/:id/duplicate` | Clone dashboard + panels |
| `POST` | `/admin/stats/dashboards/:id/panels` | Create panel (validates options against op schema) |
| `GET` | `/admin/stats/panels/:id` | Read |
| `PUT` | `/admin/stats/panels/:id` | Update (re-validates options, busts cache) |
| `DELETE` | `/admin/stats/panels/:id` | Delete |
| `POST` | `/admin/stats/panels/:id/data` | Resolve — returns `{ data, display, resolved_at, cache_hit }` (supports `?skip_cache=true`) |
| `POST` | `/admin/stats/panels/preview` | Dry-run resolve without persisting |
| `GET` | `/admin/stats/operations` | List data-category ops for the panel editor |

## Admin UI

`/stats` — dashboards list with create/delete/duplicate + search.
`/stats/:id` — grid of panels, **Add panel** button, per-panel refresh/edit/delete.
- Dashboard name resolves via a loader so the breadcrumb shows the title.
- Loading states use `HeadingSkeleton`, `TextSkeleton`, and a per-panel-type `PanelSkeleton`.

### Panel editor

File: `src/admin/components/stats/panel-editor-drawer.tsx`

- Form fields: name, type (7 options), width, height, cache TTL
- Operation dropdown (fed by `/admin/stats/operations`)
- Two JSON textareas: `operation_options` and `display`
- **Preview** button calls `/admin/stats/panels/preview` and renders the result inline using the same `PanelRenderer` used on the grid

### Renderers

`src/admin/components/stats/panel-renderer.tsx` switches on panel type:
- `metric` — big number with optional prefix/suffix/label
- `list` — divs with key + badge value
- `table` — HTML table
- `bar` / `line` / `area` — recharts
- `label` — static text block

## Seed Script

`src/scripts/seed-stats-dashboards.ts` — idempotent (skips by name). Seeds three dashboards:

- **JYT Overview** — 7 panels: partner/design/order counts, bar charts by status, 30-day sessions area chart
- **Partners & Production** — 4 panels: verified partners, run counts, by-status bar, 30-day trend line
- **Website Traffic** — 5 panels: visitor/pageview/bounce-rate metrics + daily pageviews + sessions charts (pulls from `analytics_daily_stats`)

Run:
```bash
yarn medusa exec ./src/scripts/seed-stats-dashboards.ts
```

Example panel `operation_options`:

| Goal | Config |
|---|---|
| Total partners | `{ "entity": "partner", "aggregate": { "fn": "count" } }` |
| Active partners | `{ "entity": "partner", "aggregate": { "fn": "count" }, "filters": { "status": "active" } }` |
| Designs per partner (top 10) | `{ "entity": "design", "aggregate": { "fn": "count" }, "groupBy": "partner_id", "limit": 10 }` |
| Daily sessions, last 30 days | `{ "entity": "analytics_daily_stats", "dateField": "date", "aggregate": { "fn": "sum", "field": "sessions" }, "precision": "day", "range": { "last_days": 30 } }` |

## File Layout

```
src/modules/stats/
  index.ts                                # Module(STATS_MODULE, { service })
  service.ts                              # MedusaService({ StatsDashboard, StatsPanel })
  resolver.ts                             # resolvePanel(), invalidatePanelCache()
  cache.ts                                # in-process TTL map
  inject-panel-data.ts                    # walks tiptap doc, injects resolved data
  models/
    stats-dashboard.ts
    stats-panel.ts
    index.ts
  migrations/Migration20260420091906.ts

src/modules/visual_flows/operations/
  aggregate-data.ts                       # shared
  time-series.ts                          # shared
  index.ts                                # registers both

src/api/admin/stats/
  validators.ts
  dashboards/route.ts
  dashboards/[id]/route.ts
  dashboards/[id]/duplicate/route.ts
  dashboards/[id]/panels/route.ts
  panels/[id]/route.ts
  panels/[id]/data/route.ts
  panels/preview/route.ts
  operations/route.ts

src/admin/hooks/api/stats.ts              # useDashboards, usePanelData, etc.
src/admin/routes/stats/page.tsx
src/admin/routes/stats/[id]/page.tsx
src/admin/routes/stats/[id]/loader.ts     # dashboard prefetch for breadcrumb
src/admin/components/stats/
  panel-renderer.tsx                      # metric / list / table / bar / line / area / label
  panel-card.tsx
  panel-editor-drawer.tsx
  stats-panel-picker.tsx                  # used by the tiptap editor

src/scripts/seed-stats-dashboards.ts
```

## Known risks

1. **In-process aggregation** — documented above. Mitigation: prefer rolled entities; add typed service methods for hot paths.
2. **Operation context stub** — panels pass a pseudo `flowId` and empty `dataChain`. Operations in the panel editor are filtered to `category: "data"` which don't inspect those fields today. A new op that reads `flowId` would fail silently against panels.
3. **Schema evolution on `operation_options`** — a free-form JSON blob. Renaming an option field breaks panels silently. Add an operation-level version later if this bites.

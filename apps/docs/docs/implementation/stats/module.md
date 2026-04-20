---
title: "Stats Module — Analytics Dashboards & Panels"
sidebar_label: "Module Plan"
sidebar_position: 0
---

# Stats Module — Implementation Plan

Internal analytics dashboards, modelled on Directus Insights. Operators create **dashboards** composed of **panels**; each panel is a serialized call against the existing `visual_flows` operation registry. No new source/query layer — reuses `read_data`, `aggregate_product_analytics`, and two new aggregation operations added to `visual_flows/operations`.

## Goals

- Operators can assemble dashboards of metrics, lists, time-series, and simple charts without writing code.
- Surface data already in Medusa: partners, designs, orders, production runs, website sessions.
- Be the go-to source for blog-ready numbers ("N partners, M designs produced last month") and day-to-day observability.

## Non-goals

- Self-serve BI. No arbitrary SQL, no cross-module joins beyond what `query.graph` already gives us.
- End-user / customer-facing dashboards. This is admin-only, so **no panel-level permissions** — inherits admin auth.
- Real-time streaming. Panels are pull-on-render with optional TTL cache.

## Architecture

```
┌────────────────────────────────┐
│  Admin UI                      │
│  /stats → dashboards list      │
│  /stats/:id → panel grid       │
└──────────────┬─────────────────┘
               │ GET /admin/stats/panels/:id/data
               ▼
┌────────────────────────────────┐
│  Stats service                 │
│  resolvePanel(panel) →         │
│   1. lookup operation in       │
│      visual_flows registry     │
│   2. build stub context        │
│   3. execute(options, ctx)     │
│   4. apply display mapping     │
└──────────────┬─────────────────┘
               │
               ▼
┌────────────────────────────────┐
│  operationRegistry             │
│  (shared with visual_flows)    │
│  - read_data                   │
│  - aggregate_data   (new)      │
│  - time_series      (new)      │
│  - aggregate_product_analytics │
│  - ...future sources           │
└────────────────────────────────┘
```

A panel = **one operation invocation plus display metadata**. Everything upstream of "display" already exists.

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
| `metadata` | json default `{}` | Per-dashboard filters (e.g. default date range) |
| `panels` | hasMany → stats_panel | |

Indexes: `name`.

### `stats_panel`

| Field | Type | Notes |
|---|---|---|
| `id` | id, prefix `panel` | PK |
| `dashboard_id` | text | FK → stats_dashboard |
| `name` | text | Header title |
| `type` | enum | `metric` \| `list` \| `table` \| `bar` \| `line` \| `area` \| `label` |
| `x`, `y`, `width`, `height` | int | Grid units (Directus-style) |
| `operation_type` | text | Key from `operationRegistry` |
| `operation_options` | json | Validated by the operation's `optionsSchema` on write |
| `display` | json default `{}` | `{ field, label, format, prefix, suffix, color, xAxis, yAxis, groupBy, dateField, precision, limit, conditionalFormatting[] }` |
| `cache_ttl_seconds` | int nullable | null = no cache |
| `metadata` | json default `{}` | |

Indexes: `dashboard_id`, `operation_type`.

The `display` blob is panel-render-time concern only — never interpreted by the operation. The operation returns **rows** (for `list` / `table`) or **aggregates** (for `metric`) or **buckets** (for `time_series`); `display` tells the frontend which field to render as the value, which as the label, how to format it, etc.

## Shared Operations (added to `visual_flows/operations/`)

Both live in `visual_flows` so flows can also use them (e.g. "compute yesterday's metric, send to Slack").

### `aggregate_data`

```typescript
{
  entity: string,                 // "partner" | "design" | "order" | "production_run" | ...
  fields?: string[],              // passthrough to query.graph if needed
  filters?: Record<string, any>,  // same shape as read_data
  aggregate: {
    fn: "count" | "sum" | "avg" | "min" | "max" | "count_distinct",
    field?: string,               // required for non-count
  },
  groupBy?: string | string[],    // optional group-by; returns [{ key, value }]
  limit?: number,
}
```

Returns: `{ value: number }` when no groupBy, `{ groups: [{ key, value }] }` otherwise.

Execution: uses `query.graph` to fetch rows, then aggregates in-process. Fine for our volume today. If any single panel ever returns > 50k rows it gets switched to a module-service query — defer until we hit it.

### `time_series`

```typescript
{
  entity: string,
  dateField: string,              // e.g. "created_at", "started_at"
  filters?: Record<string, any>,
  aggregate: { fn, field? },
  precision: "day" | "week" | "month",
  range: { from: ISODate, to: ISODate } | { last_days: number },
  groupBy?: string,               // optional series split (e.g. by status)
}
```

Returns: `{ buckets: [{ date: ISODate, value: number, series?: string }] }`.

Both operations sit in `category: "data"` alongside `read_data`. They are **pure reads** — no compensation needed, no writes.

## Registered Sources (existing — no new code)

| Thing to visualize | Operation | Notes |
|---|---|---|
| Total partners | `aggregate_data` | `entity: "partner", aggregate: { fn: "count" }` |
| Partners by status | `aggregate_data` + groupBy | `groupBy: "status"` |
| Total designs / active designs | `aggregate_data` | |
| Designs per partner | `aggregate_data` | `entity: "design", groupBy: "partner_id"` |
| Orders per partner | `aggregate_data` | `entity: "order", groupBy: "partner_id"` |
| Inventory orders count | `aggregate_data` | filtered by whatever field marks inventory orders |
| Website sessions / visitors (daily/weekly) | `aggregate_data` over `analytics_daily_stats` | uses pre-rolled stats — no expensive scan |
| Top pages / referrers | `read_data` on `analytics_daily_stats.top_pages` | JSON field; reshape in `display` |
| Pageviews time series | `time_series` on `analytics_event` or `analytics_daily_stats` | |
| Product pageview rollups | `aggregate_product_analytics` | already exists |

**Website sessions/visitors specifically**: `custom_analytics` module ships `analytics_session`, `analytics_event`, `analytics_daily_stats`. Prefer `analytics_daily_stats` for dashboard panels since daily rollups are already computed — reduces each panel to a tiny read.

## Panel → Operation Context Adapter

Operations expect an `OperationContext` with `dataChain`, `flowId`, etc. For panels we stub:

```typescript
// src/modules/stats/resolver.ts
function buildPanelContext(container: MedusaContainer, panel: StatsPanel): OperationContext {
  return {
    container,
    dataChain: { $trigger: { payload: {}, timestamp: new Date().toISOString() }, $accountability: { triggered_by: "stats_panel" }, $env: {}, $last: null },
    flowId: `panel:${panel.dashboard_id}`,
    executionId: `panel-render-${panel.id}-${Date.now()}`,
    operationId: panel.id,
    operationKey: panel.id,
  }
}
```

Interpolation (`{{ $trigger.foo }}`) isn't meaningful for panels — just don't use templated strings in `operation_options`. If we later want dashboard-level variables (date range picker), they go into `dataChain.$trigger.payload` and templates in `operation_options` interpolate normally.

## API Routes

All under `src/api/admin/stats/`:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/admin/stats/dashboards` | List |
| `POST` | `/admin/stats/dashboards` | Create |
| `GET` | `/admin/stats/dashboards/:id` | Read (with panels) |
| `PATCH` | `/admin/stats/dashboards/:id` | Update |
| `DELETE` | `/admin/stats/dashboards/:id` | Delete |
| `POST` | `/admin/stats/dashboards/:id/duplicate` | Clone |
| `POST` | `/admin/stats/dashboards/:id/panels` | Create panel |
| `PATCH` | `/admin/stats/panels/:id` | Update (position, options, display) |
| `DELETE` | `/admin/stats/panels/:id` | Delete |
| `POST` | `/admin/stats/panels/:id/data` | **Resolve** — returns `{ data, resolved_at, cache_hit }` |
| `POST` | `/admin/stats/panels/preview` | Dry-run resolve without persisting (for editor) |
| `GET` | `/admin/stats/operations` | List available operations for the panel editor — same as `/admin/visual-flows/operations` but filtered to `category: "data"` |

All use `validateAndTransformBody(wrapSchema(...))` per project convention.

## Caching

Per-panel `cache_ttl_seconds`:
- null → always fresh
- > 0 → cached in memory keyed by `{panel.id, hash(operation_options)}`. Flush on panel update.

Start with an in-process Map. If multi-instance becomes relevant later, swap for cache module (Medusa's `cacheService`). Not day-one.

## Admin UI

Split into two PRs.

### Phase 1 — read-only + JSON editor
- `/stats` → dashboards list, create/delete/duplicate
- `/stats/:id` → grid of panels rendering via `POST /admin/stats/panels/:id/data`
- Panel editor: form for name/type/grid/TTL + **raw JSON textarea** for `operation_options` and `display`, validated server-side against the operation's Zod schema
- Enough to ship useful dashboards while Phase 2 is built

### Phase 2 — visual panel editor
- Pick operation from a dropdown → form auto-generated from `optionsSchema` (the visual-flows properties-panel already does this — reuse `src/admin/components/visual-flows/panels/properties-panel.tsx`)
- Entity/filter pickers
- Live preview using `/admin/stats/panels/preview`
- Drag-to-resize + position via `react-grid-layout`

## File Layout

```
src/modules/stats/
  index.ts                                # Module(STATS_MODULE, { service })
  service.ts                              # MedusaService({ StatsDashboard, StatsPanel }) + resolvePanel()
  resolver.ts                             # buildPanelContext(), applyDisplay()
  cache.ts                                # in-process TTL cache
  models/
    stats-dashboard.ts
    stats-panel.ts
    index.ts
  migrations/
    Migration<timestamp>.ts               # generated via `yarn medusa db:generate stats`
  __tests__/
    resolver.test.ts
    aggregate-data.integration.test.ts

src/modules/visual_flows/operations/
  aggregate-data.ts                       # NEW — shared
  time-series.ts                          # NEW — shared
  index.ts                                # register both in operationRegistry

src/api/admin/stats/
  dashboards/
    route.ts
    [id]/route.ts
    [id]/duplicate/route.ts
    [id]/panels/route.ts
  panels/
    [id]/route.ts
    [id]/data/route.ts
    preview/route.ts
  operations/route.ts
  middlewares.ts                          # zod schemas per route

src/admin/routes/stats/
  page.tsx                                # dashboards list
  [id]/page.tsx                           # dashboard grid
src/admin/components/stats/
  panel-grid.tsx
  panel-renderer.tsx                      # switches on panel.type
  panel-editor.tsx                        # Phase 1: JSON; Phase 2: form
  renderers/
    metric-panel.tsx
    list-panel.tsx
    table-panel.tsx
    bar-chart-panel.tsx
    line-chart-panel.tsx
    area-chart-panel.tsx
```

## Medusa config

Add module to `medusa-config.ts`:
```typescript
{
  resolve: "./src/modules/stats",
  key: STATS_MODULE,
}
```

Nothing to link — stats module is self-contained; it pulls data via `query.graph` / other modules' services through the container.

## Phased rollout

| Phase | Scope | Acceptance |
|---|---|---|
| 1 | Models + migrations + service | `yarn dev` boots, `yarn medusa db:migrate` clean |
| 2 | `aggregate_data` + `time_series` ops in `visual_flows`, with integration tests | Ops callable from a visual flow |
| 3 | All admin CRUD routes + resolver + cache | `POST /panels/:id/data` returns data for a seeded panel |
| 4 | Admin UI Phase 1 (read-only grid + JSON editor) | Operator can build a dashboard with partners-count, designs-count, weekly-sessions |
| 5 | Admin UI Phase 2 (form editor, drag-to-resize, preview) | Dog-food for blog numbers — author builds dashboards without JSON |
| 6 | Seed a default "JYT Overview" dashboard via a migration or init script | New environments get a useful dashboard out-of-the-box |

## Testing

- **Unit**: `resolver.ts` display mapping, cache expiry.
- **Integration (modules)**: new operations against real query.graph with seeded partners/designs/orders.
- **Integration (HTTP)**: `/admin/stats/panels/:id/data` happy path + invalid options rejected by Zod.

Run via `pnpm test:integration:http:shared ./integration-tests/http/stats` per project convention.

## Open risks

1. **In-process aggregation** of `aggregate_data` loads rows into memory. Fine for partners/designs (hundreds), questionable for analytics events (millions). Mitigate by preferring `analytics_daily_stats` for visitor panels. If a panel targets `analytics_event` directly it's the operator's responsibility to filter — document in the editor.
2. **Operation context stub** — if a future operation ever reads `context.flowId` to look up flow metadata it'll get a panel pseudo-id and likely return empty. We only expose `category: "data"` operations in the panel editor; those shouldn't do that.
3. **Schema evolution**: `operation_options` is a JSON blob. Renaming an operation's option field breaks existing panels silently. Add a version field per-operation later if this bites — defer.

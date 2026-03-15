# Index Engine — Setup, Troubleshooting & Sync

The Index Module enables high-performance cross-module queries by ingesting data into a central data store. This guide covers how it works in JYT, common issues, and how to fix them.

## Architecture

JYT runs two Railway services:

| Service | `MEDUSA_WORKER_MODE` | Role |
|---|---|---|
| `medusa-server` | `server` | HTTP requests only |
| `medusa-worker` | `worker` | Background jobs + **index sync** |

**Critical:** The index engine only syncs in worker mode. If `MEDUSA_WORKER_MODE=server`, no sync happens.

## Required Configuration

### Environment Variables

```bash
MEDUSA_FF_INDEX_ENGINE=true    # Enable index engine feature flag
MEDUSA_FF_CACHING=true         # Optional: enables result caching
MEDUSA_WORKER_MODE=worker      # On worker service (or "shared" for single-instance)
```

### medusa-config.ts

```ts
import { Modules } from "@medusajs/framework/utils"

module.exports = defineConfig({
  featureFlags: {
    index_engine: true,
  },
  modules: [
    {
      resolve: "@medusajs/index",
    },
  ],
})
```

### Package Installation

```bash
pnpm add @medusajs/index
pnpm medusa db:migrate
```

## How Sync Works

### On Server Startup (Worker Mode)

1. Index module's `onApplicationStart` fires
2. Checks `index_metadata` table for entities with `status != done` or changed `fields_hash`
3. For each changed entity, ingests all records from the source module into `index_data`
4. Updates `index_metadata.status = done`

### On Data Changes (Runtime)

The index module listens to entity events (e.g., `product.created`, `product.updated`) via the Redis event bus and automatically updates the index data store.

### Ingested Entities (Default)

Medusa ingests these by default:
- `Product`, `ProductVariant`
- `Price`, `PriceSet`
- `SalesChannel`
- `LinkProductSalesChannel`, `LinkProductVariantPriceSet`

JYT also ingests custom entities: `Partner`, `Design`, `Task`, `InventoryOrders`, `Agreement`, `Feedback`, `Person`, etc.

## Database Tables

| Table | Purpose |
|---|---|
| `index_metadata` | Tracks which entities are indexed, their field hash, and sync status (`pending`, `processing`, `done`, `error`) |
| `index_sync` | Tracks the last synced key per entity for incremental sync |
| `index_data` | Partitioned table storing the actual indexed data as JSONB |
| `index_relation` | Partitioned table storing relationships between indexed entities |

## Admin API Routes

### `GET /admin/index/details`

Returns sync status for all indexed entities.

```bash
curl https://api.jaalyantra.com/admin/index/details \
  -H "Authorization: Bearer <token>"
```

Response:
```json
{
  "metadata": [
    {
      "id": "idxmeta_...",
      "entity": "Product",
      "status": "done",
      "fields": ["id", "title", "status", ...],
      "updated_at": "2026-03-15T06:23:40.581Z",
      "last_synced_key": "prod_01KKN..."
    }
  ]
}
```

### `POST /admin/index/sync`

Triggers a manual re-sync. Accepts a `strategy` in the body:

| Strategy | Behavior |
|---|---|
| *(none)* | Continue sync — re-processes entities with `pending` or `error` status |
| `"full"` | Sets all entities to `pending` and clears `last_key` → full re-ingest without data loss |
| `"reset"` | **Truncates all 4 index tables** (`index_data`, `index_relation`, `index_metadata`, `index_sync`) → complete wipe + re-ingest |

```bash
# Full re-sync (recommended)
curl -X POST https://api.jaalyantra.com/admin/index/sync \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"strategy": "full"}'

# Nuclear reset (clears all indexed data first)
curl -X POST https://api.jaalyantra.com/admin/index/sync \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"strategy": "reset"}'
```

**Important:** On a server/worker split deployment, the sync API call goes to the **server** which sets metadata to `pending` and emits an event. The **worker** picks up the event and performs the actual sync. Both services must be running.

## How Admin/Store Product Routes Use the Index

With `MEDUSA_FF_INDEX_ENGINE=true`:

### Admin (`GET /admin/products`)
- **No filters:** Uses `query.graph` (direct DB) → returns all products
- **With filters:** Uses `query.index` (index data store) → returns only indexed products

### Store (`GET /store/products`)
- Always uses `query.index` when index engine is enabled
- Falls back to `query.graph` for `tags` and `categories` filters (not yet supported by index)

This is why you may see different product counts between filtered and unfiltered views — if the index is out of sync.

## Troubleshooting

### Problem: Products missing from filtered list / store

**Symptoms:** Admin shows 42 products unfiltered but only 17 when filtering. Store shows fewer products than expected.

**Cause:** Index data store is out of sync with the actual database.

**Fix:**
```bash
# Option 1: Use the admin API (recommended)
curl -X POST https://api.jaalyantra.com/admin/index/sync \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"strategy": "reset"}'

# Option 2: Manual SQL (if API doesn't work)
psql $DATABASE_URL -c "
  DELETE FROM index_metadata;
  DELETE FROM index_sync;
  TRUNCATE index_data CASCADE;
  TRUNCATE index_relation CASCADE;
"
# Then restart the worker service
```

After either approach, check worker logs for:
```
[Index engine] Checking for index changes
[Index engine] Found 24 index changes that are either pending or processing
[Index engine] syncing entity 'Product'
[Index engine] syncing entity 'Product' done (+XX.XXms)
```

### Problem: "Found 0 index changes" after restart

**Cause:** `index_metadata` still has `status: done` for all entities. The engine thinks everything is synced.

**Fix:** Must clear `index_metadata` too, not just `index_data` and `index_sync`. Use `POST /admin/index/sync` with `strategy: "reset"` or truncate all 4 tables manually.

### Problem: Index sync not running at all (no log messages)

**Cause:** `MEDUSA_WORKER_MODE` is set to `"server"`. Index sync only runs when `worker_mode !== "server"`.

**Fix:** Set `MEDUSA_WORKER_MODE=worker` (or `shared` for single-instance deployments).

### Problem: Deleted products still appear in store

**Cause:** Product was deleted using direct `productService.deleteProducts()` instead of `deleteProductsWorkflow`. The workflow handles index cleanup; direct service calls don't.

**Fix:** All partner DELETE routes now use core-flow workflows. For existing stale data:
```sql
-- Find ghost products in the index
SELECT id, data->>'title' as title
FROM index_data
WHERE name = 'Product'
AND id NOT IN (SELECT id FROM product WHERE deleted_at IS NULL);

-- Or just trigger a full reset
curl -X POST /admin/index/sync -d '{"strategy": "reset"}'
```

## Key Learnings

1. **Always use workflows for deletions** — `deleteProductsWorkflow`, `deleteCustomersWorkflow`, etc. Direct service calls skip index cleanup.
2. **`index_metadata` is the source of truth** — clearing `index_data` alone won't trigger re-sync. The metadata must also be reset.
3. **Server/worker split requires Redis event bus** — the server sets metadata to `pending`, the worker picks up the event and syncs. Without Redis, events don't flow between processes.
4. **The `estimate_count` field** — when using the index engine, responses include `estimate_count` instead of exact `count`. This is a PostgreSQL estimate for performance.

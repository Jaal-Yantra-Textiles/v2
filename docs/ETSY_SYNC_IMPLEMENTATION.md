# Etsy Product Sync Implementation

## Overview

Complete implementation of a long-running workflow system for syncing MedusaJS products to Etsy, following the person-import pattern with confirmation-based execution.

---

## Architecture

### Module: `etsysync`

**Location:** `src/modules/etsysync/`

**Models:**

1. **`etsy_account`** - OAuth credentials and shop information
   - `shop_id`, `shop_name`
   - `access_token`, `refresh_token`, `token_expires_at`
   - `api_config` (JSON for additional settings)
   - `is_active` (boolean)

2. **`etsy_sync_job`** - Tracks batch sync operations
   - `transaction_id` (workflow transaction ID)
   - `status` (enum: pending, confirmed, processing, completed, failed)
   - `total_products`, `synced_count`, `failed_count`
   - `error_log` (JSON)
   - `started_at`, `completed_at`

**Module Constant:** `ETSYSYNC_MODULE = "etsysync"`

---

## Module Link: Product ↔ Etsy

**File:** `src/links/product-etsy-link.ts`

Links `Product` (core) with `EtsyAccount` (etsysync module) using `extraColumns` to store per-product sync data:

- `etsy_listing_id` - Etsy listing ID
- `etsy_url` - Public Etsy listing URL
- `sync_status` - Current status (pending, synced, failed, out_of_sync)
- `last_synced_at` - Timestamp of last successful sync
- `sync_error` - Error message if sync failed
- `metadata` - Additional sync metadata (JSON)

**Pattern:**
```typescript
defineLink(
  { linkable: ProductModule.linkable.product, isList: true },
  { linkable: EtsysyncModule.linkable.etsyAccount, isList: false },
  { database: { extraColumns: { ... } } }
)
```

---

## Workflows

### 1. Main Long-Running Workflow

**File:** `src/workflows/etsy_sync/workflows/sync-products-to-etsy.ts`

**ID:** `"sync-products-to-etsy"`

**Input:**
```typescript
{
  product_ids: string[]
  etsy_account_id: string
}
```

**Flow:**

1. **Create Sync Job** (`createEtsySyncJobStep`)
   - Creates `etsy_sync_job` record with `transaction_id` from workflow context
   - Status: `pending`
   - Stores product count and initializes counters

2. **Create Product Links** (`createProductEtsyLinksStep`)
   - Creates link records for all products with status `pending`
   - Uses module link with extraColumns
   - Rollback: dismisses created links

3. **Wait for Confirmation** (`waitConfirmationEtsySyncStep`)
   - Async step with 1-hour timeout
   - Makes this a long-running workflow
   - Admin must confirm via API before proceeding

4. **Failure Notification** (`notifyOnFailureStep`)
   - Sends admin UI feed notification if workflow fails

5. **Background Batch Sync** (`batchSyncProductsWorkflow.runAsStep`)
   - Runs asynchronously in background
   - `config({ async: true, backgroundExecution: true })`
   - Processes products and updates link records + sync job

6. **Success Notification** (`sendNotificationsStep`)
   - Sends admin UI feed notification when sync starts

**Returns:** `{ total: number }`

---

### 2. Batch Sync Workflow

**File:** `src/workflows/etsy_sync/workflows/batch-sync-products.ts`

**ID:** `"batch-sync-products-to-etsy"`

**Input:**
```typescript
{
  product_ids: string[]
  etsy_account_id: string
  sync_job_id: string
}
```

**Step:** `batchSyncProductsStep`

**Logic:**

1. Update sync job status to `processing`
2. For each product:
   - Call Etsy API (currently stubbed with mock data)
   - On success:
     - Dismiss old link
     - Create new link with: `sync_status: "synced"`, listing ID, URL, timestamp
     - Increment `synced_count`
   - On failure:
     - Dismiss old link
     - Create new link with: `sync_status: "failed"`, error message
     - Increment `failed_count`
3. Update sync job with final counts and status (`completed` or `failed`)

**Note:** Links don't have an `update` method, so we use dismiss + create pattern.

---

## API Endpoints

### 1. Start Sync

**Route:** `POST /admin/products/etsy-sync`

**File:** `src/api/admin/products/etsy-sync/route.ts`

**Request Body:**
```typescript
{
  product_ids: string[]
  etsy_account_id: string
}
```

**Response:** `202 Accepted`
```json
{
  "transaction_id": "wf_01...",
  "summary": {
    "total": 5
  }
}
```

**Flow:**
1. Validates `product_ids` and `etsy_account_id`
2. Runs `syncProductsToEtsyWorkflow`
3. Returns transaction ID for confirmation

---

### 2. Confirm Sync

**Route:** `POST /admin/products/etsy-sync/{transaction_id}/confirm`

**File:** `src/api/admin/products/etsy-sync/[transaction_id]/confirm/route.ts`

**Response:** `200 OK`
```json
{
  "success": true
}
```

**Flow:**
1. Resolves `IWorkflowEngineService`
2. Calls `setStepSuccess` with:
   - `workflowId: syncProductsToEtsyWorkflowId`
   - `stepId: waitConfirmationEtsySyncStepId`
   - `transactionId` from URL params
3. Unblocks the waiting workflow to proceed with background sync

---

## Workflow Steps

### Core Steps

**Location:** `src/workflows/etsy_sync/steps/`

1. **`wait-confirmation-etsy-sync.ts`**
   - Async step that pauses workflow execution
   - 1-hour timeout
   - Unblocked by confirm API

2. **`create-product-etsy-links.ts`**
   - Creates pending link records for all products
   - Uses `remoteLink.create` with extraColumns data
   - Compensation: dismisses created links

3. **`batch-sync-products.ts`**
   - Processes each product sequentially
   - Calls Etsy API (stubbed)
   - Updates link records via dismiss + create
   - Updates sync job counts and status

---

## Usage Flow

### Admin Workflow

1. **Initiate Sync:**
   ```bash
   POST /admin/products/etsy-sync
   {
     "product_ids": ["prod_123", "prod_456"],
     "etsy_account_id": "etsy_acc_789"
   }
   ```
   Response: `{ transaction_id: "wf_01ABC..." }`

2. **Review & Confirm:**
   - Admin reviews products to be synced
   - Confirms via:
   ```bash
   POST /admin/products/etsy-sync/wf_01ABC.../confirm
   ```

3. **Background Processing:**
   - Workflow proceeds automatically
   - Products synced to Etsy
   - Link records updated with results
   - Admin receives feed notification

4. **Check Status:**
   - Query `etsy_sync_job` by transaction_id
   - Query product-etsy links for per-product status

---

## Data Flow

### Link Record Lifecycle

1. **Created (pending):**
   ```typescript
   {
     sync_status: "pending",
     etsy_listing_id: null,
     etsy_url: null,
     last_synced_at: null,
     sync_error: null,
     metadata: {}
   }
   ```

2. **Synced (success):**
   ```typescript
   {
     sync_status: "synced",
     etsy_listing_id: "etsy_listing_...",
     etsy_url: "https://www.etsy.com/listing/...",
     last_synced_at: "2025-01-14T12:00:00Z",
     sync_error: null,
     metadata: {}
   }
   ```

3. **Failed:**
   ```typescript
   {
     sync_status: "failed",
     etsy_listing_id: null,
     etsy_url: null,
     last_synced_at: null,
     sync_error: "API error: ...",
     metadata: {}
   }
   ```

---

## Next Steps

### TODO: Etsy API Integration

**File to implement:** `src/modules/etsysync/etsy-api-service.ts`

**Required methods:**

1. **`createListing(accountId, productData)`**
   - POST to Etsy API v3: `/shops/{shop_id}/listings`
   - Maps MedusaJS product to Etsy listing format
   - Returns listing ID and URL

2. **`updateListing(listingId, productData)`**
   - PUT to Etsy API v3: `/listings/{listing_id}`
   - Updates existing listing

3. **`uploadImages(listingId, imageUrls)`**
   - POST to Etsy API v3: `/listings/{listing_id}/images`
   - Uploads product images

4. **`refreshAccessToken(accountId)`**
   - OAuth token refresh logic
   - Updates `etsy_account` record

**Replace stub in `batch-sync-products.ts`:**
```typescript
// Current stub:
const mockListingId = `etsy_listing_${Date.now()}...`
const mockUrl = `https://www.etsy.com/listing/${mockListingId}`

// Replace with:
const etsyService = container.resolve("etsy-api-service")
const { listingId, url } = await etsyService.createListing(
  input.etsy_account_id,
  productData
)
```

---

### TODO: OAuth Flow

**Endpoints to add:**

1. **`GET /admin/etsy/auth`**
   - Redirects to Etsy OAuth
   - Scopes: `listings_w`, `listings_r`, `shops_r`

2. **`GET /admin/etsy/callback`**
   - Handles OAuth callback
   - Exchanges code for tokens
   - Creates `etsy_account` record

---

### TODO: Validators

**File:** `src/api/admin/products/etsy-sync/validators.ts`

```typescript
import { z } from "zod"

export const AdminSyncProductsToEtsyReq = z.object({
  product_ids: z.array(z.string()).min(1),
  etsy_account_id: z.string(),
})
```

Update route to use: `req.validatedBody`

---

### TODO: UI Components

1. **Product List:**
   - "Sync to Etsy" bulk action
   - Sync status badge per product

2. **Product Detail:**
   - Etsy sync status section
   - Etsy listing URL link
   - Last synced timestamp
   - Re-sync button

3. **Sync Jobs Dashboard:**
   - List all sync jobs
   - Real-time status updates
   - Error logs
   - Retry failed syncs

---

## Testing

### Manual Test Flow

1. **Setup:**
   ```bash
   # Run migrations
   yarn medusa db:migrate
   
   # Create test Etsy account
   # (via admin UI or direct DB insert)
   ```

2. **Start Sync:**
   ```bash
   curl -X POST http://localhost:9000/admin/products/etsy-sync \
     -H "Content-Type: application/json" \
     -d '{
       "product_ids": ["prod_123"],
       "etsy_account_id": "etsy_acc_789"
     }'
   ```

3. **Confirm:**
   ```bash
   curl -X POST http://localhost:9000/admin/products/etsy-sync/{transaction_id}/confirm
   ```

4. **Check Results:**
   - Query `etsy_sync_job` table
   - Query product-etsy link table
   - Check admin UI feed for notifications

---

## Key Patterns Used

1. **Long-Running Workflow:**
   - Async step with confirmation
   - Background execution
   - Transaction ID tracking

2. **Module Links with extraColumns:**
   - Stores relationship data directly on link
   - No separate mapping model needed
   - Dismiss + create pattern for updates

3. **Workflow Composition:**
   - Main workflow orchestrates
   - Batch workflow runs in background
   - Proper step isolation

4. **Error Handling:**
   - Per-product error tracking
   - Job-level status aggregation
   - Feed notifications for admins

---

## Files Created

### Module
- `src/modules/etsysync/index.ts`
- `src/modules/etsysync/service.ts`
- `src/modules/etsysync/models/etsy_account.ts`
- `src/modules/etsysync/models/etsy_sync_job.ts`

### Link
- `src/links/product-etsy-link.ts`

### Workflows
- `src/workflows/etsy_sync/index.ts`
- `src/workflows/etsy_sync/workflows/sync-products-to-etsy.ts`
- `src/workflows/etsy_sync/workflows/batch-sync-products.ts`
- `src/workflows/etsy_sync/steps/index.ts`
- `src/workflows/etsy_sync/steps/wait-confirmation-etsy-sync.ts`
- `src/workflows/etsy_sync/steps/create-product-etsy-links.ts`
- `src/workflows/etsy_sync/steps/batch-sync-products.ts`

### API
- `src/api/admin/products/etsy-sync/route.ts`
- `src/api/admin/products/etsy-sync/[transaction_id]/confirm/route.ts`

---

## Configuration

### Module Registration

Already added to `medusa-config.ts` and `medusa-config.prod.ts`:

```typescript
modules: [
  // ...
  {
    resolve: "./src/modules/etsysync",
  },
]
```

### Link Registration

Links are auto-discovered from `src/links/` directory.

---

## Summary

✅ **Complete:**
- Module with 2 models (etsy_account, etsy_sync_job)
- Product-Etsy link with extraColumns for sync data
- Long-running workflow with confirmation pattern
- Background batch sync workflow
- Admin API endpoints (start + confirm)
- Proper error handling and notifications

⏳ **Pending:**
- Etsy OAuth flow
- Etsy API service implementation
- Request validators
- Admin UI components
- Integration tests

The core infrastructure is ready. Next step is integrating with Etsy's actual API and building the UI layer.

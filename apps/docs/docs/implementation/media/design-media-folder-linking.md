---
title: "Design → Media Folder Linking"
sidebar_label: "Design–Media Folder Link"
sidebar_position: 4
---

# Design → Media Folder Linking

Connects a design to a media folder so that when the design is promoted to **Commerce Ready**, its photoshoot images automatically build a draft product — no manual product creation required.

## Architecture

```
Design ──────────────── MediaFolder (1-to-1 link)
        defineLink
             │
             │  design.updated event (status → Commerce_Ready)
             ▼
        Subscriber fires
             │
             ├── pull image files from linked folder
             ├── map design fields → product fields
             ├── createProductsWorkflow (draft)
             └── product-design-link created + feed notification
```

## Module Link

**File:** `src/links/design-media-folder-link.ts`

```typescript
import { defineLink } from "@medusajs/framework/utils"
import DesignModule from "../modules/designs"
import MediaModule from "../modules/media"

export default defineLink(
  { linkable: DesignModule.linkable.design, isList: false },
  { linkable: MediaModule.linkable.folder, isList: false }
)
```

One design maps to one folder. Medusa auto-generates the join table and exposes the relationship via the query graph.

After adding this file, run:

```bash
npx medusa db:generate design_media_folder_link
npx medusa db:migrate
```

## API Routes

**File:** `src/api/admin/designs/[id]/link-media-folder/route.ts`

### `POST /admin/designs/:id/link-media-folder`

Links a folder to a design. Replaces any existing link (one-to-one enforcement).

**Request body:**
```json
{ "folder_id": "folder_01ABC..." }
```

**Response:**
```json
{ "design_id": "design_01...", "folder_id": "folder_01...", "linked": true }
```

### `DELETE /admin/designs/:id/link-media-folder`

Removes the link. No body required.

**Response:**
```json
{ "design_id": "design_01...", "linked": false }
```

**Middleware entries** (`src/api/middlewares.ts`):
```typescript
{ matcher: "/admin/designs/:id/link-media-folder", method: "POST",   middlewares: [] },
{ matcher: "/admin/designs/:id/link-media-folder", method: "DELETE", middlewares: [] },
```

## Promote-to-Product Workflow

**File:** `src/workflows/designs/promote-design-to-product.ts`

The core workflow called by the subscriber. Fully idempotent.

### Input
```typescript
type PromoteDesignToProductInput = {
  design_id: string
}
```

### Step logic (`promote-design-to-product-step`)

1. **Query design** via graph — fetches linked products, linked folder, and folder's media files in one call
2. **Idempotency checks** — skips if:
   - Design already has a linked product
   - No media folder is linked
   - Linked folder has no image files
3. **Build product payload** from design fields:

   | Product field | Source |
   |---|---|
   | `title` | `design.name` |
   | `description` | `design.description` + color palette suffix |
   | `thumbnail` | First image file in folder |
   | `images` | All image files in folder |
   | `status` | `"draft"` always |
   | `metadata.design_id` | `design.id` |
   | `metadata.source_folder_id` | `folder.id` |
   | `sales_channels` | Store's default sales channel |

4. **Create product** via `createProductsWorkflow` (Medusa core flow)
5. **Create `product-design-link`** via `remoteLink.create`
6. **Notify** admin feed via `sendNotificationsStep`

### Compensation

On failure, the step rolls back:
- Dismisses the `product-design-link`
- Deletes the created product

### Skip output

When skipped, the workflow returns:
```typescript
{ skipped: true, skip_reason: "Design already has a linked product" }
```

No error is thrown — skips are expected and non-fatal.

## Subscriber

**File:** `src/subscribers/design-commerce-ready.ts`

```typescript
export const config: SubscriberConfig = {
  event: "design.updated",
}
```

The `design.updated` event is emitted automatically by Medusa's `MedusaService` whenever `updateDesigns()` is called. The subscriber:

1. Fetches the current design status from the graph
2. Returns early if status is not `Commerce_Ready`
3. Fires `promoteDesignToProductWorkflow`

**Why fetch status instead of reading from event data?**
Medusa's automatic events carry `{ id }` only. The subscriber re-queries to get the current state, ensuring it always acts on the latest committed value.

## Admin UI

### Hook — `src/admin/hooks/api/use-design-media-folder.ts`

```typescript
// Fetch the linked folder for a design
useDesignMediaFolder(designId: string)
  → AdminMediaFolder | null

// Link a folder
useLinkDesignMediaFolder(designId: string)
  → mutate(folder_id: string)

// Unlink the current folder
useUnlinkDesignMediaFolder(designId: string)
  → mutate()
```

`useDesignMediaFolder` queries via the graph endpoint:
```
entity: "design" → fields: ["folders.*", "folders.media_files.*"]
```

### Section — `src/admin/components/designs/design-media-folder-section.tsx`

Displayed at the **top of the sidebar** on every design detail page (`src/admin/routes/designs/[id]/page.tsx`).

**States:**

| State | UI |
|---|---|
| No folder linked | Empty state + "Link folder" primary button + explanation |
| Folder linked | Folder name, path, image count, 6-image preview grid, "Change" + "Unlink" actions |
| Loading | Text placeholder |

**Image preview grid:**
- First image spans `col-span-2 row-span-2` (larger, marked "Thumbnail")
- Up to 6 images shown; if more, last tile shows `+N` overlay
- First image becomes the product thumbnail when promoted

**Folder picker modal:**
- Search input filters folders by name
- Each row shows folder thumbnail, name, path, and file count
- Selecting a folder calls `useLinkDesignMediaFolder` and closes the modal

## Data Flow — End to End

```
1. Design created (any status)

2. Admin opens Design detail page
   → DesignMediaFolderSection shows "No folder linked"

3. Admin clicks "Link folder"
   → FolderPickerModal opens, lists all media folders
   → Admin selects the photoshoot folder
   → POST /admin/designs/:id/link-media-folder
   → design-media-folder-link created in DB
   → Section refreshes, shows folder preview

4. Design progresses through status workflow
   (Conceptual → In_Development → Technical_Review → Approved → ...)

5. Admin sets status to "Commerce_Ready"
   → design.updated event emitted by Medusa
   → design-commerce-ready subscriber fires
   → Status confirmed as Commerce_Ready
   → promoteDesignToProductWorkflow runs

6. Workflow:
   → Queries design + linked folder + folder images
   → Checks: no existing product, folder has images
   → Creates draft product with folder images
   → Creates product-design-link
   → Sends admin feed notification

7. Admin sees notification: "Design promoted to draft product"
   → Navigates to /products to review, set pricing, publish
```

## Field Mapping Reference

```
design.name            → product.title
design.description     → product.description (+ color palette suffix)
design.color_palette   → appended to description: "Available in: Navy, White"
design.design_type     → product.metadata.design_type
folder first image     → product.thumbnail
folder all images      → product.images[]
design.id              → product.metadata.design_id
folder.id              → product.metadata.source_folder_id
```

## Related Files

| File | Purpose |
|---|---|
| `src/links/design-media-folder-link.ts` | Medusa link definition |
| `src/api/admin/designs/[id]/link-media-folder/route.ts` | POST/DELETE handlers |
| `src/api/middlewares.ts` | Route middleware entries |
| `src/workflows/designs/promote-design-to-product.ts` | Core promotion workflow |
| `src/subscribers/design-commerce-ready.ts` | Event subscriber |
| `src/admin/hooks/api/use-design-media-folder.ts` | React Query hooks |
| `src/admin/components/designs/design-media-folder-section.tsx` | Sidebar UI section |
| `src/admin/routes/designs/[id]/page.tsx` | Design detail page (section added) |

## Related Concepts

- **`product-design-link`** (`src/links/product-design-link.ts`) — many-to-many link created after promotion
- **`design-variant-link`** (`src/links/design-variant-link.ts`) — one-to-one link used for custom customer designs at checkout
- **`create-product-from-design.ts`** — separate workflow for customer-initiated custom orders (not the same as this promotion flow)

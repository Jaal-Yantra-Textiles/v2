---
title: "Design to Draft Product"
sidebar_label: "Design to Draft Product"
sidebar_position: 1
---

# Design to Draft Product

This guide covers the full workflow for turning an internal design into a published product — from linking a photoshoot folder to the design, through to reviewing the auto-generated draft product.

## Overview

When a design is marked **Commerce Ready**, the system automatically:

1. Pulls all images from the linked media folder
2. Creates a **draft product** pre-filled with design data
3. Links the product back to the design
4. Sends you an admin feed notification

No manual product creation is needed.

---

## Step 1 — Upload photoshoot media

Before linking, upload your photoshoot photos to a media folder.

1. Go to **Media** in the admin sidebar
2. Create a new folder (e.g. `SS25-shirt-linen-photoshoot`)
3. Upload your product photos — the **first image uploaded** becomes the product thumbnail

:::tip Image order matters
The first image in the folder is used as the product thumbnail when the draft is created. Upload your hero shot first.
:::

---

## Step 2 — Link the folder to the design

1. Open the design in **Designs → [Design name]**
2. In the sidebar, find the **Media Folder** section at the top
3. Click **Link folder**
4. Search for and select your photoshoot folder
5. The section updates to show a preview of the folder's images

You can change or unlink the folder at any time before promoting.

---

## Step 3 — Progress the design

Continue your normal design review process. The design goes through its status workflow:

```
Conceptual → In_Development → Technical_Review → Sample_Production
  → Revision → Approved → Commerce_Ready
```

The promotion to a draft product only triggers at **Commerce_Ready**. You can link the folder at any point before that.

---

## Step 4 — Set status to Commerce Ready

When the design is approved and ready to sell:

1. Open the design detail page
2. Update the **Status** field to `Commerce_Ready`
3. Save the change

The system detects this status change and automatically runs the promotion workflow in the background.

:::info What happens automatically
- Draft product created with your design's name, description, and images
- Product linked back to this design (`product-design-link`)
- Admin feed notification sent: "Design promoted to draft product"
:::

---

## Step 5 — Review and publish the draft product

1. Click the notification in the admin feed, or navigate to **Products**
2. Find the new draft product (status: `Draft`)
3. Review and complete the product details:

| Field | Auto-filled from | You need to |
|---|---|---|
| Title | Design name | Review / adjust |
| Description | Design description + colors | Expand, add sizing info |
| Images | All folder images | Reorder if needed |
| Thumbnail | First folder image | Change if needed |
| Variants | Default (no price) | **Add pricing** |
| Sales channel | Store default | Confirm |
| Collections / Tags | — | Add manually |

4. Set prices on the Default variant (or add size/color variants)
5. Change status from `Draft` → `Published`

---

## Media folder — what qualifies as product images

Only **image files** from the folder are used (JPEG, PNG, WebP, GIF). Videos, documents, and other file types in the folder are ignored.

All images in the folder become product images. If the folder has more photos than you want, either:
- Remove unwanted photos from the folder before setting Commerce Ready, or
- Delete the extra images from the product after it's created

---

## Changing the linked folder

You can swap the linked folder at any time before the design reaches Commerce Ready.

1. Go to the design's **Media Folder** section
2. Click **Change**
3. Pick the new folder

If the design is already Commerce Ready and already has a product linked, changing the folder will **not** re-trigger product creation (the workflow is idempotent — it skips if a product already exists). In that case, update the product images manually from the product detail page.

---

## Troubleshooting

### No draft product was created after setting Commerce Ready

Check the following:

1. **Is a folder linked?** — The Media Folder section on the design must show a linked folder. If it shows "No folder linked", the workflow skips silently.

2. **Does the folder have images?** — If the folder only contains videos or documents, the workflow skips. Add image files to the folder.

3. **Does the design already have a product?** — The workflow is idempotent. If the design already had a product linked from a previous promotion, it will not create a second one. Check the design's linked products.

4. **Check the admin feed** — A failure notification appears in the feed if the workflow encountered an error.

### Product was created but has wrong images

This means the folder had a different set of images at the time of promotion. You can update product images manually:

1. Go to the product in **Products**
2. Edit the Images section
3. Add or remove images as needed

### I need a product with multiple variants (sizes, colors)

The promotion creates a single **Default** variant with no price as a starting point. After promotion:

1. Open the product
2. Add product options (Size, Color, etc.)
3. Add variant combinations
4. Set prices per variant

---

## FAQ

**Can I link the same folder to multiple designs?**

No — the link is one-to-one. Each folder can only be linked to one design at a time. If you need to reuse photos, duplicate the folder first.

**What if my design has no description?**

The product description falls back to the design name. You should add a description to the design before promoting, or edit the product description after creation.

**Does changing the design's color palette update the product?**

No — the product is a snapshot taken at the moment of promotion. Subsequent changes to the design do not propagate to the product automatically.

**Can I manually trigger the promotion without setting Commerce Ready?**

Not via the UI. The trigger is the status change. If you need to re-run it (e.g. after fixing a missing folder), unlink the product from the design, then re-set the status to Commerce Ready. The workflow will re-run.

---

## Related

- [Media Folder Management](../../implementation/media/design-media-folder-linking.md) — Technical implementation
- [Product Media Widget](../../implementation/media/product-media.md) — Adding media to existing products
- [Create Product from Media Photos](../../implementation/media/product-media.md) — Creating products directly from selected folder photos

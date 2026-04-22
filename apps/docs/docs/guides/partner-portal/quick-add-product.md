---
title: "Quick Add Product (with AI description)"
sidebar_label: "Quick Add Product"
sidebar_position: 5
---

# Quick Add Product

Quick Add is a one-screen form for partners who sell a single-variant product with one price and one stock number. It also lets you draft the title and description from a photo using AI — so you can ship a new listing in under a minute.

## When to use it

Pick **Quick add** when all of the following are true:

- The product has **no size/colour variants** (one SKU).
- You price it in a **single currency** (your store's default).
- You keep stock at **one warehouse** (your store's default location).

Pick **Advanced** instead when you need variants, per-region pricing, or multiple locations.

## How to create a product

1. Go to **Products** → click **Create**.
2. In the "How do you want to create this product?" screen, click **Quick add**.
3. Upload one or more photos. The first one becomes the thumbnail.
4. (Optional) Click **✨ Describe from image** once a photo is uploaded. The AI reads the photo and fills in the **Title** and **Description**. You can edit both before saving.
5. Fill in:
   - **Title** — e.g. "Handmade cotton dari"
   - **Description** — a few sentences
   - **Price** — in your store's default currency (shown on the right of the field)
   - **Stock** — how many you have in your default warehouse
6. Click **Create**. You land back on the product list with the new product visible.

## The AI "Describe from image" button

When you upload at least one photo, a small **Describe from image** button appears next to the Title label, along with a counter like `3/10 free`.

- Clicking it sends the first photo to our AI provider. ~5–15 seconds later the Title and Description fields are pre-filled.
- If you had already typed a title, we keep your title and only replace the description.
- You can click again to regenerate — each click counts as one use.

### The free quota

Every partner gets **10 free AI descriptions per calendar month**. The counter resets on the 1st of the month.

When you hit 10, the button is disabled and a warning card appears at the top of the form:

> 10/10 free AI descriptions used this month. Upgrade your plan to keep generating descriptions.

Click **See plans** to go to **Settings → Plan** and upgrade.

You can still create products while at the limit — the AI button is the only thing that's gated. You can type your own title/description and save as normal.

### Tips for best results

- Use a **well-lit, uncluttered photo** of the product alone. Stock photos confuse the AI.
- The description is **grounded in what's visible**. The AI is instructed not to invent materials or measurements it can't see, so if your photo is dark or abstract the output will be brief.
- Run it, edit, save — don't trust the output blindly. Partners are responsible for accuracy (especially materials and sizing).

## What Quick Add creates behind the scenes

One call creates:

- A **product** in `published` status assigned to your store's sales channel.
- A single **variant** named "Default variant" under a single option ("Default option").
- One **price** in your store's default currency.
- One **stock level** at your store's default warehouse (if you entered a stock number > 0).

If you later need variants or regional prices, open the product from the list and use the regular edit flow — nothing about the Quick-Add output is special; it's a normal Medusa product under the hood.

## Troubleshooting

**"No AI description provider configured"**
: An admin hasn't added the AI platform yet. Ask them to set it up in **Settings → External Platforms** on the admin side. See the [implementation doc](../../implementation/partner-portal/quick-add-product) for setup steps.

**"Store has no default currency configured"**
: Your store doesn't have a supported currency marked as default. Go to **Settings → Store** (or have an admin fix it).

**Describe button is disabled but I only used it 2 times**
: Check the counter. If it reads `X/10 free` with X &lt; 10, the disabled state is from the AI call in flight — wait for the spinner to finish. If it still looks stuck, refresh the page.

**The AI description is wrong / generic**
: Use a better photo (bright, product-only background) and run again, or just edit the description manually. Each re-run counts as one use against your quota.

# Partner Portal Troubleshooting

Common issues and fixes for the partner dashboard and storefront.

## Partner UI

### 404 on page refresh
**Cause**: SPA routing — the static host doesn't know about client-side routes.
**Fix**: Add `public/_redirects` with `/*    /index.html   200`. On Render, also add the rewrite rule in the dashboard (Redirects/Rewrites → `/*` → `/index.html` → Rewrite).

### CORS errors when editing products/variants
**Cause**: The partner UI is calling admin API endpoints (`/admin/...`) that only allow admin CORS origin.
**Fix**: Ensure the relevant hooks use `sdk.client.fetch("/partners/...")` instead of `sdk.admin.*`.

### Variant edit shows 404
**Cause**: The `edit-variant` route was missing from the partner route map.
**Fix**: Added to `get-partner-route.map.tsx` in the products children.

### Option edit shows 404
**Cause**: Route param mismatch — route uses `:optionId` but code used `useParams().option_id`.
**Fix**: Changed to `useParams().optionId`.

### Product table missing Collection/Variants columns
**Cause**: The product list API didn't fetch `collection.*`, `sales_channels.*`, or `variants.*`.
**Fix**: Updated `list-store-products.ts` workflow to include these relations.

### Shipping option creation fails with "Field 'type' is required"
**Cause**: Backend validator required `type: { label, code }` inline object, but the form sends `type_id`.
**Fix**: Made `type` optional in the validator and added `type_id` as an alternative field.

## Storefront

### Cart creation 500 error (SQL syntax error)
**Cause**: `@devx-commerce/razorpay` pulled in `@mikro-orm/core@6.4.3` alongside Medusa's `6.4.16`, breaking MikroORM's `raw()` SQL function in the promotion module.
**Fix**: Removed `@devx-commerce/razorpay` from dependencies. After clean install, only one MikroORM version exists.

### Index Engine "tuple concurrently updated" error
**Cause**: Multiple concurrent requests during startup trigger parallel partition creation in PostgreSQL.
**Fix**: Run `npx medusa db:migrate --execute-all-links` before the app starts. Use `predeploy` script. Ensure single-instance during deploys.

### Theme changes not reflected in storefront
**Cause**: `getWebsite()` uses `cache: "force-cache"` — the storefront caches theme data aggressively.
**Fix**: The layout detects iframe loading (`Sec-Fetch-Dest: iframe`) and uses `cache: "no-store"`. The home page uses `noCache` when `?theme_editor=true` is present.

### Vercel preview domain returns "website not found"
**Cause**: Vercel generates preview URLs that don't match the stored custom domain.
**Fix**: The `find-website-by-domain` workflow has fallbacks that extract the partner handle from Vercel preview URL patterns.

### Storefront infinite redirect loop in editor iframe
**Cause**: Cross-origin iframe can't set cookies, so the middleware keeps redirecting.
**Fix**: Middleware detects `?visual_editor=true` or `?theme_editor=true` and uses `NextResponse.next()` with cookie set instead of redirect.

### Delhivery not showing as fulfillment provider
**Cause**: Provider was disabled in the database (`is_enabled = false`).
**Fix**: `UPDATE fulfillment_provider SET is_enabled = true WHERE id = 'delhivery_delhivery';`

## Scripts Reference

| Script | Purpose | Command |
|--------|---------|---------|
| Seed partner plans | Creates Simple/Pro/Max plans | `npx medusa exec src/scripts/seed-partner-plans.ts` |
| Assign plan to partner | Sets plan + payment provider | `npx medusa exec src/scripts/assign-plan-to-partner.ts` |
| Assign PayU to regions | Links PayU to INR regions | `npx medusa exec src/scripts/assign-payu-to-partner.ts` |
| Check promotions | Lists automatic promotions | `npx medusa exec src/scripts/check-promotions.ts` |
| Check providers | Lists fulfillment + payment providers | `npx medusa exec src/scripts/check-providers.ts` |
| Test cart creation | Tests computeActions + providers | `npx medusa exec src/scripts/test-cart-create.ts` |

# @jytextiles/medusa-plugin-etsy-sync

A [Medusa v2](https://medusajs.com) plugin that syncs your Medusa products to a
personal [Etsy](https://www.etsy.com) shop via the [Etsy Open API v3](https://developers.etsy.com/documentation).
It handles the OAuth2 (PKCE) connect flow, draft-listing creation, listing
updates, image uploads, and keeps a per-product sync record so you can publish
to Etsy from the Medusa Admin.

## Features

- **OAuth2 PKCE connect flow** — connect/disconnect an Etsy shop from
  **Settings → Etsy** in the Admin; tokens are stored and auto-refreshed.
- **Product → Etsy sync** — create draft listings, update them, and upload
  product images (single or bulk).
- **Readiness checks** — surfaces what's missing (shop connection, shipping
  profile, return policy, taxonomy) before you publish.
- **Sync records** — every sync is tracked per product with status and the
  remote Etsy listing id.
- **Scheduled token refresh** — a background job keeps the Etsy access token
  fresh so syncs don't fail mid-session.

## Requirements

- Medusa **2.17.x**
- Node.js **>= 22**
- An Etsy app (keystring + shared secret) from the
  [Etsy developer portal](https://www.etsy.com/developers/your-apps)

## Install

```bash
npm install @jytextiles/medusa-plugin-etsy-sync
# or
yarn add @jytextiles/medusa-plugin-etsy-sync
# or
pnpm add @jytextiles/medusa-plugin-etsy-sync
```

## Configure

Register the plugin in `medusa-config.ts`:

```ts
module.exports = defineConfig({
  // ...
  plugins: [
    {
      resolve: "@jytextiles/medusa-plugin-etsy-sync",
      options: {
        keystring: process.env.ETSY_KEYSTRING,
        sharedSecret: process.env.ETSY_SHARED_SECRET,
        redirectUri:
          process.env.ETSY_REDIRECT_URI ??
          "http://localhost:9000/app/settings/oauth/etsy/callback",
        scope:
          process.env.ETSY_SCOPE ?? "listings_r listings_w listings_d shops_r",
      },
    },
  ],
})
```

Options can be supplied via the `options` object above **or** the matching
environment variables (env takes precedence):

| Option         | Env var              | Required | Description                                                        |
| -------------- | -------------------- | -------- | ------------------------------------------------------------------ |
| `keystring`    | `ETSY_KEYSTRING`     | yes      | Your Etsy app's keystring (API key).                               |
| `sharedSecret` | `ETSY_SHARED_SECRET` | yes      | Your Etsy app's shared secret.                                     |
| `redirectUri`  | `ETSY_REDIRECT_URI`  | no       | OAuth callback URL. Must match your Etsy app's registered callback. |
| `scope`        | `ETSY_SCOPE`         | no       | Space-separated Etsy OAuth scopes.                                 |

Add the callback URL (`redirectUri`) to your Etsy app's allowed redirect URIs in
the Etsy developer portal.

After installing, run your project's migrations so the plugin's tables are
created:

```bash
npx medusa db:migrate
```

## Usage

1. In the Admin, go to **Settings → Etsy** and click **Connect** to authorize
   your Etsy shop.
2. Configure your sync settings (shipping profile, return policy, taxonomy).
3. From a product page, use the **Etsy** widget to sync the product, or sync in
   bulk from the Etsy settings page.

### Admin API routes

| Method     | Route                          | Purpose                              |
| ---------- | ------------------------------ | ------------------------------------ |
| GET        | `/admin/etsy/status`           | Connection + readiness status        |
| GET / POST | `/admin/etsy/settings`         | Read / save sync settings            |
| GET        | `/admin/etsy/auth/authorize`   | Start the OAuth2 PKCE flow           |
| GET        | `/admin/etsy/auth/callback`    | OAuth2 callback                      |
| POST       | `/admin/etsy/auth/disconnect`  | Disconnect the shop                  |
| POST       | `/admin/etsy/sync/product/:id` | Sync a single product                |
| POST       | `/admin/etsy/sync/bulk`        | Sync multiple products               |
| GET        | `/admin/etsy/syncs`            | List sync records                    |
| GET        | `/admin/etsy/taxonomy`         | Etsy taxonomy lookup                 |
| GET        | `/admin/etsy/shipping-profiles`| Etsy shipping profiles               |
| GET        | `/admin/etsy/return-policies`  | Etsy return policies                 |

## Development

```bash
# Build the plugin (compiles to .medusa/server)
npm run build

# Watch mode while developing against a local Medusa app
npm run dev

# Generate a migration after changing a model
npm run db:generate

# Run tests
npm run test
```

## License

[MIT](./LICENSE)

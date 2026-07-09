# @jytextiles/medusa-plugin-faire-store-sync

A [Medusa v2](https://medusajs.com) plugin that **bidirectionally** syncs your
Medusa products, inventory and orders with a [Faire](https://www.faire.com)
brand account via the [Faire External Platform API](https://developer.faire.com)
(OAuth 2.0). It handles the OAuth connect flow, product push (create/update +
inventory), bulk product sync, bulk order ingestion, and inbound Faire webhooks
for order/inventory/product events.

> ⚠️ **Note on API specifics.** Faire's developer portal is access-gated, so
> this plugin's endpoint paths, payload shapes and webhook signature scheme
> reflect the publicly documented v2 surface and standard OAuth2 conventions.
> If your Faire app uses a different base URL, token header, or signing scheme,
> override via the options/env vars below — the client is intentionally
> permissive. Verify against your Faire app's documentation before going live.

## Features

- **OAuth 2.0 redirect connect flow** — connect/disconnect a Faire brand from
  **Settings → Faire** in the Admin; tokens are stored and auto-refreshed when
  applicable.
- **Product → Faire sync** — create/update Faire products, push variant
  inventory, upload images via URL (single or bulk).
- **Faire → Medusa order ingestion** — bulk-pull Faire orders and create
  matching Medusa orders (idempotent, payment marked captured).
- **Readiness checks** — surfaces what's missing (brand, wholesale-pricing
  strategy, shipping policy) before publishing.
- **Sync records** — every sync is tracked per product with status and the
  remote Faire product token.
- **Long-running bulk workflows** — both bulk product push and bulk order pull
  run as background workflows (`backgroundExecution`) with a pollable batch id.
- **Event-driven** — inbound Faire webhooks (order placed/canceled/shipped,
  inventory updated, product updated) are verified, recorded idempotently and
  re-emitted as Medusa events; `product.updated` re-syncs linked products when
  their status actually changes.

## Requirements

- Medusa **2.17.x**
- Node.js **>= 22**
- A Faire app (client id + client secret) from the Faire developer portal, with
  the OAuth redirect URL registered.

## Install

```bash
npm install @jytextiles/medusa-plugin-faire-store-sync
# or
yarn add @jytextiles/medusa-plugin-faire-store-sync
# or
pnpm add @jytextiles/medusa-plugin-faire-store-sync
```

## Configure

Register the plugin in `medusa-config.ts`:

```ts
module.exports = defineConfig({
  // ...
  plugins: [
    {
      resolve: "@jytextiles/medusa-plugin-faire-store-sync",
      options: {
        clientId: process.env.FAIRE_APP_ID,
        clientSecret: process.env.FAIRE_APP_SECRET,
        redirectUri:
          process.env.FAIRE_REDIRECT_URI ??
          "http://localhost:9000/app/settings/oauth/faire/callback",
        // Optional overrides (defaults shown):
        // apiBase: "https://faire.com/external-api/v2",
        // authUrl: "https://faire.com/oauth2/authorize",
        // tokenUrl: "https://www.faire.com/api/external-api-oauth2/token",
      },
    },
  ],
})
```

Options can be supplied via the `options` object above **or** the matching
environment variables (env takes precedence):

| Option          | Env var               | Required | Description                                                        |
| --------------- | --------------------- | -------- | ------------------------------------------------------------------ |
| `clientId`      | `FAIRE_APP_ID`        | yes      | Your Faire app's application id.                                    |
| `clientSecret`  | `FAIRE_APP_SECRET`    | yes      | Your Faire app's application secret.                                |
| `redirectUri`   | `FAIRE_REDIRECT_URI`  | no       | OAuth callback URL. Must match your Faire app's registered redirect. |
| `apiBase`       | `FAIRE_API_BASE`      | no       | Override the Faire API base URL (e.g. for sandbox).                |
| `authUrl`       | `FAIRE_AUTH_URL`      | no       | Override the OAuth authorize URL.                                  |
| `tokenUrl`      | `FAIRE_TOKEN_URL`     | no       | Override the OAuth token URL.                                      |

After installing, run your project's migrations so the plugin's tables are
created:

```bash
npx medusa db:migrate
```

### Optional behavior flags

| Env var                       | Default | Effect                                                      |
| ----------------------------- | ------- | ----------------------------------------------------------- |
| `FAIRE_INGEST_ORDERS`         | `true`  | Set `false` to disable creating Medusa orders from Faire.   |
| `FAIRE_DECREMENT_INVENTORY`   | `false` | Set `true` to decrement Medusa stock on Faire order ingest. |
| `FAIRE_AUTO_INGEST_ORDERS`    | `true`  | Set `false` to disable the scheduled order-pull job.        |

## Usage

1. In the Admin, go to **Settings → Faire** and click **Connect** to authorize
   your Faire brand.
2. Configure sync settings (brand, wholesale markup %, shipping policy).
3. From a product page, use the **Faire Sync** widget to sync the product, or
   sync in bulk from the Faire settings page (Bulk operations card).
4. Pull Faire orders into Medusa with the **Start order pull** button (also runs
   on a 30-minute schedule).

### Admin API routes

| Method | Route                              | Purpose                                            |
| ------ | ---------------------------------- | -------------------------------------------------- |
| GET    | `/admin/faire/status`              | Connection + readiness status                      |
| GET/POST | `/admin/faire/settings`          | Read / save sync settings                          |
| GET    | `/admin/faire/auth/authorize`      | Start the OAuth2 flow                              |
| POST   | `/admin/faire/auth/callback`       | OAuth2 callback (called by the SPA)                |
| POST   | `/admin/faire/auth/disconnect`     | Disconnect the brand                               |
| POST   | `/admin/faire/sync/product/:id`    | Sync a single product                              |
| POST   | `/admin/faire/sync/bulk`           | Sync multiple products (background workflow, 202)  |
| GET    | `/admin/faire/sync/bulk/:batchId`  | Poll bulk product-sync progress                    |
| POST   | `/admin/faire/ingest/orders`       | Pull Faire orders (background workflow, 202)       |
| GET    | `/admin/faire/ingest/orders/:batchId` | Poll bulk order-ingest progress                 |
| GET    | `/admin/faire/syncs`               | List sync records                                  |
| GET/POST | `/admin/faire/syncs/:id`          | Fetch / retry a sync record                        |
| GET    | `/admin/faire/brand`               | The connected Faire brand                          |
| GET    | `/admin/faire/products`            | Products already on Faire                          |

## Development

```bash
# Build the plugin (compiles to .medusa/server, then restructures via postbuild)
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

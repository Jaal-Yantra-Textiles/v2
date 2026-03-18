# Partner API Scoping

The partner UI (`partner.jaalyantra.com`) uses partner-scoped API endpoints instead of admin endpoints to avoid CORS issues and ensure data isolation.

## Why Partner Scoping Matters

- **CORS**: Admin API only allows `admin.jaalyantra.com` origin. Partner UI at `partner.jaalyantra.com` is blocked.
- **Data isolation**: Partners should only see their own data (products, orders, customers).
- **Security**: Admin API has full access; partner API validates ownership.

## Partner API Pattern

All partner endpoints follow the pattern:
```
/partners/...              → partner-level resources
/partners/stores/:id/...   → store-scoped resources
```

Authentication: `authenticate("partner", ["session", "bearer"])` middleware with partner CORS.

## Scoped Resources

### Products
| Operation | Endpoint | Notes |
|-----------|----------|-------|
| List | `GET /partners/stores/:id/products` | Via sales channel link |
| Detail | `GET /partners/stores/:id/products/:productId` | Includes variants, options, collection, images, tags |
| Create | `POST /partners/stores/:id/products` | Auto-assigns store's sales channel |
| Update | `POST /partners/stores/:id/products/:productId` | |
| Delete | `DELETE /partners/stores/:id/products/:productId` | Uses `deleteProductsWorkflow` |

### Product Variants
| Operation | Endpoint |
|-----------|----------|
| List all | `GET /partners/stores/:id/product-variants` |
| Detail | `GET /partners/stores/:id/products/:productId/variants/:variantId` |
| Create | `POST /partners/stores/:id/products/:productId/variants` |
| Update | `POST /partners/stores/:id/products/:productId/variants/:variantId` |
| Delete | `DELETE /partners/stores/:id/products/:productId/variants/:variantId` |

### Product Metadata
| Resource | Endpoint | Scoping |
|----------|----------|---------|
| Collections | `GET /partners/product-collections` | Store-scoped via sales channel |
| Types | `GET/POST /partners/product-types` | Global (partners can use any) |
| Tags | `GET/POST/DELETE /partners/product-tags` | Global with partner auth |

### Customers
| Operation | Endpoint |
|-----------|----------|
| List | `GET /partners/customers` |
| Detail | `GET /partners/customers/:id` |
| Create | `POST /partners/customers` |
| Update | `POST /partners/customers/:id` |

### Orders
| Operation | Endpoint |
|-----------|----------|
| List | `GET /partners/orders` |
| Detail | `GET /partners/orders/:id` |
| Claims/Returns/Exchanges | `POST /partners/orders/:id/claims`, etc. |

### Fulfillment & Shipping
| Resource | Endpoint |
|----------|----------|
| Fulfillment providers | `GET /partners/fulfillment-providers` |
| Stock locations | `GET /partners/stock-locations` |
| Shipping options | `GET/POST /partners/stores/:id/shipping-options` |

## Migrated Calls (admin → partner)

The following partner UI files were migrated from `sdk.admin.*` to `sdk.client.fetch("/partners/...")`:

### Loaders
- `collections/collection-detail/loader.ts`
- `product-types/product-type-detail/loader.ts`
- `product-tags/product-tag-detail/loader.ts` + `product-tag-list/loader.ts`
- `product-variants/product-variant-edit/loader.ts` + `product-variant-detail/loader.ts`
- `customers/customer-detail/loader.ts`

### Hooks
- `hooks/api/product-variants.tsx` — variant listing
- `hooks/api/tags.tsx` — create/update/delete operations

### Order Flows
- `order-create-fulfillment` — stock location list
- `order-create-return` — variant retrieval
- `order-create-claim` — variant list (claim/outbound sections)
- `order-create-exchange` — variant list (inbound/outbound sections)
- `order-request-transfer` — customer list
- `inventory/manage-locations` — stock location list

## Remaining Admin API Calls

These are in features not critical to partner operations:

- **Campaigns/Promotions** — marketing features
- **Currencies/Locales** — read-only global data
- **Price Lists** — advanced pricing
- **Views/Workflow Executions** — internal admin tooling
- **Invites/Users** — separate auth system
- **Refund/Return Reasons** — global lookup data
- **Notifications/Plugins** — system-level

These can be migrated as partners need access to these features.

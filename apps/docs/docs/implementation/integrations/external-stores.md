---
title: "External Stores Module"
sidebar_label: "External Stores"
sidebar_position: 4
---

# External Stores Module

## Overview

The `external_stores` module provides a unified interface for integrating with external e-commerce platforms (Etsy, Shopify, Amazon, etc.), following the same pattern as the `social_provider` module.

---

## Architecture

### Module Structure

```
src/modules/external_stores/
├── index.ts                          # Module definition & exports
├── service.ts                        # ExternalStoresService (provider registry)
├── types.ts                          # Common interfaces
├── store-provider-registry.ts        # Provider registry implementation
├── etsy-service.ts                   # Etsy API v3 implementation
└── (future) shopify-service.ts       # Shopify implementation
```

### Key Components

1. **ExternalStoresService** - Main service that manages store providers
2. **StoreProviderRegistry** - Registry for provider instances
3. **Store Providers** - Individual platform implementations (EtsyService, etc.)

---

## Store Provider Interface

All store providers must implement the `StoreProvider` interface:

```typescript
interface StoreProvider {
  name: string
  
  // OAuth methods
  getAuthorizationUrl(redirectUri: string, scope: string, state: string): Promise<string>
  exchangeCodeForToken(code: string, redirectUri: string, state?: string): Promise<TokenData>
  refreshAccessToken(refreshToken: string): Promise<TokenData>
  
  // Store info
  getShopInfo(accessToken: string): Promise<ShopInfo>
}
```

### Common Types

```typescript
interface TokenData {
  access_token: string
  refresh_token?: string
  token_type: string
  expires_in?: number
  scope?: string
  retrieved_at?: number
}

interface ShopInfo {
  shop_id: string
  shop_name: string
  shop_url?: string
  currency?: string
  country?: string
  [key: string]: any
}

interface ListingData {
  title: string
  description: string
  price: number
  quantity: number
  images?: string[]
  tags?: string[]
  category_id?: string
  [key: string]: any
}

interface ListingResponse {
  listing_id: string
  listing_url: string
  status: string
  [key: string]: any
}
```

---

## Etsy Service Implementation

### Features

- **OAuth 2.0** - Full authorization flow with token refresh
- **Shop Management** - Get shop information
- **Listing Management** - Create, update listings
- **Image Upload** - Upload product images to listings

### Environment Variables

```bash
# Required
ETSY_CLIENT_ID=your_etsy_keystring
ETSY_CLIENT_SECRET=your_etsy_secret

# OAuth
ETSY_REDIRECT_URI=http://localhost:9000/admin/oauth/etsy/callback
ETSY_SCOPE=listings_r listings_w shops_r  # Optional, has defaults
```

### API Methods

#### OAuth

```typescript
// Get authorization URL
const authUrl = await etsyService.getAuthorizationUrl(
  redirectUri,
  scope,
  state
)

// Exchange code for token
const tokenData = await etsyService.exchangeCodeForToken(
  code,
  redirectUri
)

// Refresh expired token
const newTokenData = await etsyService.refreshAccessToken(
  refreshToken
)
```

#### Shop Info

```typescript
const shopInfo = await etsyService.getShopInfo(accessToken)
// Returns: { shop_id, shop_name, shop_url, currency, country, ... }
```

#### Listings

```typescript
// Create listing
const listing = await etsyService.createListing(
  accessToken,
  shopId,
  {
    title: "Product Title",
    description: "Product description",
    price: 29.99,
    quantity: 10,
    tags: ["handmade", "vintage"],
  }
)

// Update listing
const updated = await etsyService.updateListing(
  accessToken,
  listingId,
  { price: 24.99, quantity: 5 }
)

// Upload images
const images = await etsyService.uploadImages(
  accessToken,
  shopId,
  listingId,
  ["https://example.com/image1.jpg", "https://example.com/image2.jpg"]
)
```

---

## OAuth Integration

### Unified OAuth Routes

The existing OAuth routes (`/admin/oauth/[platform]`) have been extended to support external stores:

#### Initiate OAuth

**Endpoint:** `GET /admin/oauth/:platform`

**Supported platforms:**
- Social: `facebook`, `instagram`, `twitter`, `linkedin`, `bluesky`
- Stores: `etsy`, `shopify`, `amazon`

**Response:**
```json
{
  "location": "https://www.etsy.com/oauth/connect?...",
  "state": "csrf_token_123"
}
```

**Flow:**
1. Frontend calls `/admin/oauth/etsy`
2. Backend generates authorization URL
3. Frontend redirects user to Etsy
4. User authorizes app
5. Etsy redirects to callback URL with code

#### OAuth Callback

**Endpoint:** `POST /admin/oauth/:platform/callback`

**Request Body:**
```json
{
  "id": "etsy_account_id",
  "code": "authorization_code_from_etsy",
  "state": "csrf_token_123"
}
```

**Response:**
```json
{
  "success": true,
  "account": { /* updated etsy_account record */ },
  "shop_info": {
    "shop_id": "12345",
    "shop_name": "My Etsy Shop",
    "shop_url": "https://www.etsy.com/shop/MyEtsyShop",
    ...
  }
}
```

**Flow:**
1. Frontend receives authorization code from Etsy
2. Frontend posts to `/admin/oauth/etsy/callback` with code and account ID
3. Backend exchanges code for access token
4. Backend fetches shop information
5. Backend updates `etsy_account` record with tokens and shop data
6. Frontend receives confirmation

---

## Usage in Workflows

### Resolving the Service

```typescript
import { EXTERNAL_STORES_MODULE, ExternalStoresService } from "../../../modules/external_stores"

// In a workflow step
const externalStores = container.resolve(EXTERNAL_STORES_MODULE) as ExternalStoresService

// Get specific provider
const etsyProvider = externalStores.getProvider("etsy")
```

### Example: Batch Sync Step

```typescript
import { EXTERNAL_STORES_MODULE } from "../../../modules/external_stores"
import { ETSYSYNC_MODULE } from "../../../modules/etsysync"

export const batchSyncProductsStep = createStep(
  "batch-sync-products-step",
  async (input, { container }) => {
    const externalStores = container.resolve(EXTERNAL_STORES_MODULE)
    const etsysyncService = container.resolve(ETSYSYNC_MODULE)
    
    // Get Etsy provider
    const etsyProvider = externalStores.getProvider("etsy")
    
    // Get account details
    const [account] = await etsysyncService.listEtsy_accounts({
      id: input.etsy_account_id,
    })
    
    for (const product_id of input.product_ids) {
      try {
        // Create listing on Etsy
        const listing = await etsyProvider.createListing(
          account.access_token,
          account.shop_id,
          {
            title: productData.title,
            description: productData.description,
            price: productData.price,
            quantity: productData.quantity,
            images: productData.images,
          }
        )
        
        // Update link with success
        // ...
      } catch (error) {
        // Handle error
        // ...
      }
    }
  }
)
```

---

## Adding New Store Providers

### 1. Create Service File

```typescript
// src/modules/external_stores/shopify-service.ts
import { StoreProvider, TokenData, ShopInfo, ListingData, ListingResponse } from "./types"

export default class ShopifyService implements StoreProvider {
  name = "shopify"
  
  async getAuthorizationUrl(redirectUri: string, scope: string, state: string): Promise<string> {
    // Implement Shopify OAuth
  }
  
  async exchangeCodeForToken(code: string, redirectUri: string): Promise<TokenData> {
    // Implement token exchange
  }
  
  async refreshAccessToken(refreshToken: string): Promise<TokenData> {
    // Implement token refresh
  }
  
  async getShopInfo(accessToken: string): Promise<ShopInfo> {
    // Implement shop info fetch
  }
  
  // Add Shopify-specific methods
  async createProduct(accessToken: string, productData: any) {
    // Shopify product creation
  }
}
```

### 2. Register Provider

```typescript
// src/modules/external_stores/service.ts
import ShopifyService from "./shopify-service"

constructor(container: any, options?: any) {
  super(...arguments)
  
  this.registry = new StoreProviderRegistry()
  
  this.registerProvider("etsy", new EtsyService())
  this.registerProvider("shopify", new ShopifyService())  // Add here
}
```

### 3. Update OAuth Routes

```typescript
// src/api/admin/oauth/[platform]/route.ts
const externalStorePlatforms = ["etsy", "shopify", "amazon"]  // Add platform
```

### 4. Add Environment Variables

```bash
SHOPIFY_CLIENT_ID=...
SHOPIFY_CLIENT_SECRET=...
SHOPIFY_REDIRECT_URI=...
SHOPIFY_SCOPE=...
```

---

## Integration with Etsy Sync

The `etsysync` module uses the `external_stores` module for all Etsy API interactions:

### Data Flow

1. **OAuth** → `external_stores` handles authentication
2. **Token Storage** → `etsysync` stores tokens in `etsy_account` model
3. **API Calls** → `external_stores` provides Etsy API methods
4. **Sync Logic** → `etsysync` workflows orchestrate the sync process

### Module Separation

- **`external_stores`** - Platform-agnostic store provider implementations
- **`etsysync`** - Business logic for syncing products to external stores
- **OAuth routes** - Unified authentication for both social and store platforms

---

## Testing

### Manual OAuth Test

1. **Setup environment:**
   ```bash
   export ETSY_CLIENT_ID=your_keystring
   export ETSY_CLIENT_SECRET=your_secret
   export ETSY_REDIRECT_URI=http://localhost:9000/admin/oauth/etsy/callback
   ```

2. **Create etsy_account record:**
   ```sql
   INSERT INTO etsy_account (id) VALUES ('test_account_123');
   ```

3. **Initiate OAuth:**
   ```bash
   curl http://localhost:9000/admin/oauth/etsy
   ```

4. **Visit returned URL in browser**

5. **After authorization, Etsy redirects to callback**

6. **Frontend posts to callback:**
   ```bash
   curl -X POST http://localhost:9000/admin/oauth/etsy/callback \
     -H "Content-Type: application/json" \
     -d '{
       "id": "test_account_123",
       "code": "code_from_etsy"
     }'
   ```

7. **Verify account updated with tokens and shop info**

### Testing Listing Creation

```typescript
const externalStores = container.resolve(EXTERNAL_STORES_MODULE)
const etsyProvider = externalStores.getProvider("etsy")

const listing = await etsyProvider.createListing(
  accessToken,
  shopId,
  {
    title: "Test Product",
    description: "Test description",
    price: 19.99,
    quantity: 1,
  }
)

console.log("Created listing:", listing.listing_url)
```

---

## Error Handling

### Common Errors

1. **Missing Environment Variables**
   ```
   [EtsyService] Missing ETSY_CLIENT_ID or ETSY_CLIENT_SECRET
   ```
   → Add environment variables

2. **Invalid Authorization Code**
   ```
   Failed to exchange code for token: invalid_grant
   ```
   → Code expired or already used, restart OAuth flow

3. **Expired Access Token**
   ```
   Failed to create listing: Unauthorized
   ```
   → Use `refreshAccessToken()` to get new token

4. **Provider Not Found**
   ```
   Store provider "xyz" not found
   ```
   → Check provider is registered in service constructor

---

## Future Enhancements

### Planned Features

1. **Shopify Integration**
   - OAuth flow
   - Product sync
   - Inventory management

2. **Amazon Integration**
   - MWS/SP-API authentication
   - Listing management
   - Order sync

3. **eBay Integration**
   - OAuth 2.0
   - Listing creation
   - Auction management

4. **Token Auto-Refresh**
   - Background job to refresh expiring tokens
   - Automatic retry on 401 errors

5. **Webhook Support**
   - Listen for store events
   - Update local data on changes

6. **Multi-Store Sync**
   - Sync same product to multiple stores
   - Inventory synchronization across stores

---

## API Reference

### ExternalStoresService

```typescript
class ExternalStoresService {
  // Register a provider
  registerProvider(name: string, provider: StoreProvider): void
  
  // Get a provider (throws if not found)
  getProvider(name: string): StoreProvider
  
  // Check if provider exists
  hasProvider(name: string): boolean
  
  // List all registered providers
  listProviders(): string[]
}
```

### EtsyService

```typescript
class EtsyService implements StoreProvider {
  // OAuth
  getAuthorizationUrl(redirectUri, scope, state): Promise<string>
  exchangeCodeForToken(code, redirectUri): Promise<TokenData>
  refreshAccessToken(refreshToken): Promise<TokenData>
  
  // Shop
  getShopInfo(accessToken): Promise<ShopInfo>
  
  // Listings
  createListing(accessToken, shopId, listingData): Promise<ListingResponse>
  updateListing(accessToken, listingId, listingData): Promise<ListingResponse>
  uploadImages(accessToken, shopId, listingId, imageUrls): Promise<any[]>
}
```

---

## Summary

✅ **Complete:**
- External stores module with provider registry
- Etsy service with OAuth and API methods
- Unified OAuth routes for social + store platforms
- Type-safe interfaces for all providers
- Comprehensive error handling

⏳ **Next Steps:**
- Add Shopify provider
- Implement token auto-refresh
- Add webhook handlers
- Build admin UI for store management

The `external_stores` module provides a clean, scalable foundation for integrating with any external e-commerce platform, following established patterns from your `social_provider` module.

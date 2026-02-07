---
title: "External API Management System"
sidebar_label: "External API"
sidebar_position: 3
---

# External API Management System

## Overview

Transform the current `social-platforms` module into a comprehensive **External API Management System** that stores API configurations, credentials, and metadata in the database instead of environment variables. This enables dynamic API integration without code changes or deployments.

---

## Current Problems

### 1. **Hardcoded in Environment Variables**
```bash
# Current approach - inflexible
FACEBOOK_APP_ID=123456
FACEBOOK_APP_SECRET=secret123
TWITTER_API_KEY=abc123
TWITTER_API_SECRET=xyz789
```

**Issues**:
- ❌ Requires deployment to change credentials
- ❌ Can't have multiple configurations per environment
- ❌ No audit trail of changes
- ❌ Difficult to manage across teams
- ❌ No per-tenant/per-partner configurations

### 2. **Limited to Social Platforms**
Current `social-platforms` module only handles social media. Can't easily add:
- Payment gateways (Stripe, PayPal)
- Shipping providers (FedEx, UPS)
- Email services (SendGrid, Mailgun)
- SMS providers (Twilio, Vonage)
- Analytics (Google Analytics, Mixpanel)

---

## Proposed Architecture

### Rename & Restructure

```
social-platforms  →  external-apis
├── models/
│   ├── external-api.ts           (renamed from social-platform)
│   ├── external-api-connection.ts (renamed from social-platform-account)
│   └── external-api-credential.ts (new - for OAuth tokens)
├── service.ts
└── index.ts
```

---

## Database Schema

### 1. **External API** (Provider Definition)

```typescript
// Replaces: social_platform
// Stores: API provider configuration

interface ExternalApi {
  id: string
  
  // Identification
  name: string                    // "Facebook", "Stripe", "Twilio"
  slug: string                    // "facebook", "stripe", "twilio"
  category: ApiCategory           // "social", "payment", "shipping", etc.
  provider: string                // "facebook", "meta", "stripe"
  
  // API Configuration (encrypted)
  api_config: {
    // Base configuration
    base_url?: string             // "https://graph.facebook.com/v18.0"
    api_version?: string          // "v18.0", "2024-01-01"
    
    // Authentication method
    auth_type: "oauth2" | "oauth1" | "api_key" | "basic" | "bearer"
    
    // OAuth 2.0 configuration
    oauth2?: {
      client_id_encrypted: EncryptedData
      client_secret_encrypted: EncryptedData
      authorization_url: string
      token_url: string
      scopes: string[]
      redirect_uri: string
    }
    
    // OAuth 1.0a configuration
    oauth1?: {
      consumer_key_encrypted: EncryptedData
      consumer_secret_encrypted: EncryptedData
      request_token_url: string
      authorization_url: string
      access_token_url: string
    }
    
    // API Key configuration
    api_key?: {
      key_encrypted: EncryptedData
      header_name: string         // "X-API-Key", "Authorization"
      key_prefix?: string         // "Bearer ", "ApiKey "
    }
    
    // Rate limiting
    rate_limit?: {
      requests_per_second?: number
      requests_per_minute?: number
      requests_per_hour?: number
      requests_per_day?: number
    }
    
    // Webhook configuration
    webhook?: {
      url: string
      secret_encrypted?: EncryptedData
      events: string[]
    }
    
    // Additional settings
    timeout_ms?: number
    retry_config?: {
      max_retries: number
      backoff_ms: number
    }
  }
  
  // Metadata
  status: "active" | "inactive" | "deprecated"
  is_sandbox: boolean             // For test environments
  environment: "production" | "staging" | "development"
  
  // Multi-tenancy support
  sales_channel_id?: string       // For tenant isolation
  partner_id?: string             // For partner-specific configs
  
  // Audit
  created_at: Date
  updated_at: Date
  deleted_at?: Date
  created_by?: string
  updated_by?: string
}
```

### 2. **External API Connection** (User/Account Connection)

```typescript
// Replaces: social_platform_account
// Stores: User's connection to an API (OAuth tokens, etc.)

interface ExternalApiConnection {
  id: string
  
  // Relations
  external_api_id: string         // Which API provider
  user_id?: string                // Which user (if user-specific)
  partner_id?: string             // Which partner (if partner-specific)
  sales_channel_id?: string       // Which tenant (if tenant-specific)
  
  // Connection details
  connection_name: string         // "My Facebook Page", "Production Stripe"
  
  // Credentials (encrypted)
  credentials: {
    // OAuth 2.0 tokens
    access_token_encrypted?: EncryptedData
    refresh_token_encrypted?: EncryptedData
    token_type?: string
    expires_at?: string
    scopes?: string[]
    
    // OAuth 1.0a tokens
    oauth_token_encrypted?: EncryptedData
    oauth_token_secret_encrypted?: EncryptedData
    
    // API Key
    api_key_encrypted?: EncryptedData
    
    // Additional credentials
    additional_data?: Record<string, any>
  }
  
  // Provider-specific data
  provider_data: {
    // Facebook
    user_id?: string
    page_id?: string
    page_name?: string
    ig_user_id?: string
    
    // Stripe
    account_id?: string
    account_type?: string
    
    // Twilio
    account_sid?: string
    phone_number?: string
    
    // Generic
    [key: string]: any
  }
  
  // Status
  status: "active" | "expired" | "revoked" | "error"
  last_used_at?: Date
  last_sync_at?: Date
  error_message?: string
  
  // Audit
  created_at: Date
  updated_at: Date
  deleted_at?: Date
  authenticated_at: Date
}
```

### 3. **API Category Enum**

```typescript
enum ApiCategory {
  SOCIAL = "social",              // Facebook, Twitter, Instagram
  PAYMENT = "payment",            // Stripe, PayPal, Square
  SHIPPING = "shipping",          // FedEx, UPS, DHL
  EMAIL = "email",                // SendGrid, Mailgun, SES
  SMS = "sms",                    // Twilio, Vonage, MessageBird
  ANALYTICS = "analytics",        // Google Analytics, Mixpanel
  CRM = "crm",                    // Salesforce, HubSpot
  STORAGE = "storage",            // AWS S3, Google Cloud Storage
  COMMUNICATION = "communication", // Slack, Discord, Teams
  AUTHENTICATION = "authentication", // Auth0, Okta
  OTHER = "other"
}
```

---

## Example Configurations

### Facebook API

```typescript
{
  id: "ext_api_facebook_001",
  name: "Facebook Graph API",
  slug: "facebook",
  category: "social",
  provider: "meta",
  api_config: {
    base_url: "https://graph.facebook.com/v18.0",
    api_version: "v18.0",
    auth_type: "oauth2",
    oauth2: {
      client_id_encrypted: { encrypted: "...", iv: "...", authTag: "...", keyVersion: 1 },
      client_secret_encrypted: { encrypted: "...", iv: "...", authTag: "...", keyVersion: 1 },
      authorization_url: "https://www.facebook.com/v18.0/dialog/oauth",
      token_url: "https://graph.facebook.com/v18.0/oauth/access_token",
      scopes: ["pages_show_list", "pages_manage_posts", "instagram_basic"],
      redirect_uri: "https://yourdomain.com/api/admin/oauth/facebook/callback"
    },
    rate_limit: {
      requests_per_hour: 200
    },
    webhook: {
      url: "https://yourdomain.com/api/webhooks/facebook",
      secret_encrypted: { encrypted: "...", iv: "...", authTag: "...", keyVersion: 1 },
      events: ["feed", "comments", "reactions"]
    }
  },
  status: "active",
  is_sandbox: false,
  environment: "production"
}
```

### Stripe API

```typescript
{
  id: "ext_api_stripe_001",
  name: "Stripe Payment Gateway",
  slug: "stripe",
  category: "payment",
  provider: "stripe",
  api_config: {
    base_url: "https://api.stripe.com/v1",
    api_version: "2024-01-01",
    auth_type: "bearer",
    api_key: {
      key_encrypted: { encrypted: "...", iv: "...", authTag: "...", keyVersion: 1 },
      header_name: "Authorization",
      key_prefix: "Bearer "
    },
    rate_limit: {
      requests_per_second: 100
    },
    webhook: {
      url: "https://yourdomain.com/api/webhooks/stripe",
      secret_encrypted: { encrypted: "...", iv: "...", authTag: "...", keyVersion: 1 },
      events: ["payment_intent.succeeded", "charge.failed"]
    },
    timeout_ms: 30000,
    retry_config: {
      max_retries: 3,
      backoff_ms: 1000
    }
  },
  status: "active",
  is_sandbox: false,
  environment: "production"
}
```

### Twilio SMS API

```typescript
{
  id: "ext_api_twilio_001",
  name: "Twilio SMS Service",
  slug: "twilio",
  category: "sms",
  provider: "twilio",
  api_config: {
    base_url: "https://api.twilio.com/2010-04-01",
    api_version: "2010-04-01",
    auth_type: "basic",
    api_key: {
      key_encrypted: { encrypted: "account_sid:auth_token", iv: "...", authTag: "...", keyVersion: 1 },
      header_name: "Authorization",
      key_prefix: "Basic "
    },
    rate_limit: {
      requests_per_second: 10
    }
  },
  status: "active",
  is_sandbox: false,
  environment: "production"
}
```

---

## Service Layer

### External API Service

**File**: `/src/modules/external-apis/service.ts`

```typescript
import { MedusaError } from "@medusajs/utils"
import { getEncryptionService } from "../../services/encryption-service"

export class ExternalApiService {
  
  /**
   * Get API configuration with decrypted credentials
   */
  async getApiConfig(apiId: string): Promise<DecryptedApiConfig> {
    const api = await this.retrieveExternalApi(apiId)
    
    if (!api) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `External API ${apiId} not found`
      )
    }
    
    // Decrypt credentials
    const decryptedConfig = this.decryptApiConfig(api.api_config)
    
    return {
      ...api,
      api_config: decryptedConfig
    }
  }
  
  /**
   * Get user connection with decrypted tokens
   */
  async getConnection(connectionId: string): Promise<DecryptedConnection> {
    const connection = await this.retrieveConnection(connectionId)
    
    if (!connection) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Connection ${connectionId} not found`
      )
    }
    
    // Check if expired
    if (connection.credentials.expires_at) {
      const expiresAt = new Date(connection.credentials.expires_at)
      if (expiresAt < new Date()) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Connection has expired. Please re-authenticate."
        )
      }
    }
    
    // Decrypt credentials
    const decryptedCredentials = this.decryptCredentials(connection.credentials)
    
    return {
      ...connection,
      credentials: decryptedCredentials
    }
  }
  
  /**
   * Create API configuration
   */
  async createExternalApi(data: CreateExternalApiInput): Promise<ExternalApi> {
    // Encrypt sensitive data
    const encryptedConfig = this.encryptApiConfig(data.api_config)
    
    // Validate configuration
    const validation = ExternalApiConfigSchema.safeParse(encryptedConfig)
    if (!validation.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Invalid API configuration: ${validation.error.message}`
      )
    }
    
    return await this.externalApiRepository.create({
      ...data,
      api_config: encryptedConfig
    })
  }
  
  /**
   * Store OAuth connection
   */
  async createConnection(data: CreateConnectionInput): Promise<ExternalApiConnection> {
    // Encrypt credentials
    const encryptedCredentials = this.encryptCredentials(data.credentials)
    
    return await this.connectionRepository.create({
      ...data,
      credentials: encryptedCredentials,
      authenticated_at: new Date()
    })
  }
  
  /**
   * Refresh OAuth token
   */
  async refreshToken(connectionId: string): Promise<ExternalApiConnection> {
    const connection = await this.getConnection(connectionId)
    const api = await this.getApiConfig(connection.external_api_id)
    
    if (api.api_config.auth_type !== "oauth2") {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Token refresh only supported for OAuth 2.0"
      )
    }
    
    if (!connection.credentials.refresh_token) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "No refresh token available"
      )
    }
    
    // Call token endpoint
    const newTokens = await this.refreshOAuthToken(
      api.api_config.oauth2.token_url,
      connection.credentials.refresh_token,
      api.api_config.oauth2.client_id,
      api.api_config.oauth2.client_secret
    )
    
    // Update connection with new tokens
    const encryptedCredentials = this.encryptCredentials({
      ...connection.credentials,
      access_token: newTokens.access_token,
      expires_at: newTokens.expires_at
    })
    
    return await this.updateConnection(connectionId, {
      credentials: encryptedCredentials,
      status: "active"
    })
  }
  
  /**
   * Get API client for making requests
   */
  async getApiClient(connectionId: string): Promise<ApiClient> {
    const connection = await this.getConnection(connectionId)
    const api = await this.getApiConfig(connection.external_api_id)
    
    return new ApiClient({
      baseUrl: api.api_config.base_url,
      authType: api.api_config.auth_type,
      credentials: connection.credentials,
      rateLimit: api.api_config.rate_limit,
      timeout: api.api_config.timeout_ms,
      retryConfig: api.api_config.retry_config
    })
  }
  
  // Private helper methods
  private decryptApiConfig(config: any): any {
    const encryptionService = getEncryptionService()
    
    // Decrypt based on auth type
    if (config.oauth2) {
      return {
        ...config,
        oauth2: {
          ...config.oauth2,
          client_id: encryptionService.decrypt(config.oauth2.client_id_encrypted),
          client_secret: encryptionService.decrypt(config.oauth2.client_secret_encrypted)
        }
      }
    }
    
    if (config.api_key) {
      return {
        ...config,
        api_key: {
          ...config.api_key,
          key: encryptionService.decrypt(config.api_key.key_encrypted)
        }
      }
    }
    
    return config
  }
  
  private encryptApiConfig(config: any): any {
    const encryptionService = getEncryptionService()
    
    if (config.oauth2) {
      return {
        ...config,
        oauth2: {
          ...config.oauth2,
          client_id_encrypted: encryptionService.encrypt(config.oauth2.client_id),
          client_secret_encrypted: encryptionService.encrypt(config.oauth2.client_secret),
          client_id: undefined,
          client_secret: undefined
        }
      }
    }
    
    if (config.api_key) {
      return {
        ...config,
        api_key: {
          ...config.api_key,
          key_encrypted: encryptionService.encrypt(config.api_key.key),
          key: undefined
        }
      }
    }
    
    return config
  }
  
  private decryptCredentials(credentials: any): any {
    const encryptionService = getEncryptionService()
    
    return {
      ...credentials,
      access_token: credentials.access_token_encrypted 
        ? encryptionService.decrypt(credentials.access_token_encrypted)
        : undefined,
      refresh_token: credentials.refresh_token_encrypted
        ? encryptionService.decrypt(credentials.refresh_token_encrypted)
        : undefined,
      api_key: credentials.api_key_encrypted
        ? encryptionService.decrypt(credentials.api_key_encrypted)
        : undefined
    }
  }
  
  private encryptCredentials(credentials: any): any {
    const encryptionService = getEncryptionService()
    
    return {
      ...credentials,
      access_token_encrypted: credentials.access_token
        ? encryptionService.encrypt(credentials.access_token)
        : undefined,
      refresh_token_encrypted: credentials.refresh_token
        ? encryptionService.encrypt(credentials.refresh_token)
        : undefined,
      api_key_encrypted: credentials.api_key
        ? encryptionService.encrypt(credentials.api_key)
        : undefined,
      access_token: undefined,
      refresh_token: undefined,
      api_key: undefined
    }
  }
}
```

---

## Generic API Client

**File**: `/src/services/api-client.ts`

```typescript
import axios, { AxiosInstance } from "axios"
import { RateLimiter } from "./rate-limiter"

export class ApiClient {
  private client: AxiosInstance
  private rateLimiter?: RateLimiter
  
  constructor(config: ApiClientConfig) {
    // Create axios instance
    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: config.timeout || 30000,
      headers: this.buildHeaders(config)
    })
    
    // Setup rate limiting
    if (config.rateLimit) {
      this.rateLimiter = new RateLimiter(config.rateLimit)
    }
    
    // Setup retry logic
    if (config.retryConfig) {
      this.setupRetry(config.retryConfig)
    }
  }
  
  async get(path: string, params?: any): Promise<any> {
    await this.rateLimiter?.waitForSlot()
    return this.client.get(path, { params })
  }
  
  async post(path: string, data?: any): Promise<any> {
    await this.rateLimiter?.waitForSlot()
    return this.client.post(path, data)
  }
  
  async put(path: string, data?: any): Promise<any> {
    await this.rateLimiter?.waitForSlot()
    return this.client.put(path, data)
  }
  
  async delete(path: string): Promise<any> {
    await this.rateLimiter?.waitForSlot()
    return this.client.delete(path)
  }
  
  private buildHeaders(config: ApiClientConfig): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    }
    
    // Add authentication header
    switch (config.authType) {
      case "bearer":
        headers["Authorization"] = `Bearer ${config.credentials.access_token}`
        break
      
      case "api_key":
        const keyPrefix = config.apiKeyPrefix || ""
        headers[config.apiKeyHeader || "X-API-Key"] = `${keyPrefix}${config.credentials.api_key}`
        break
      
      case "basic":
        const basicAuth = Buffer.from(
          `${config.credentials.username}:${config.credentials.password}`
        ).toString("base64")
        headers["Authorization"] = `Basic ${basicAuth}`
        break
      
      case "oauth1":
        // OAuth 1.0a signature generation
        headers["Authorization"] = this.generateOAuth1Header(config)
        break
    }
    
    return headers
  }
  
  private setupRetry(retryConfig: RetryConfig): void {
    // Implement retry logic with exponential backoff
    // ... implementation
  }
  
  private generateOAuth1Header(config: ApiClientConfig): string {
    // OAuth 1.0a signature generation
    // ... implementation
    return ""
  }
}
```

---

## Usage Examples

### 1. Publishing to Facebook (Using External API)

```typescript
// In workflow step
export const publishToFacebookStep = createStep(
  "publish-to-facebook",
  async (input: PublishInput, { container }) => {
    const externalApiService = container.resolve("externalApiService")
    
    // Get the connection (decrypts tokens automatically)
    const connection = await externalApiService.getConnection(input.connection_id)
    
    // Get API client
    const client = await externalApiService.getApiClient(input.connection_id)
    
    // Make API call
    const response = await client.post(`/${connection.provider_data.page_id}/photos`, {
      url: input.image_url,
      caption: input.caption,
      access_token: connection.credentials.access_token
    })
    
    return new StepResponse({ post_id: response.data.id })
  }
)
```

### 2. Processing Stripe Payment

```typescript
export const processStripePaymentStep = createStep(
  "process-stripe-payment",
  async (input: PaymentInput, { container }) => {
    const externalApiService = container.resolve("externalApiService")
    
    // Get Stripe connection
    const connection = await externalApiService.getConnection(input.stripe_connection_id)
    
    // Get API client
    const client = await externalApiService.getApiClient(input.stripe_connection_id)
    
    // Create payment intent
    const response = await client.post("/payment_intents", {
      amount: input.amount,
      currency: input.currency,
      customer: input.customer_id
    })
    
    return new StepResponse({ payment_intent_id: response.data.id })
  }
)
```

### 3. Sending SMS via Twilio

```typescript
export const sendSmsStep = createStep(
  "send-sms",
  async (input: SmsInput, { container }) => {
    const externalApiService = container.resolve("externalApiService")
    
    // Get Twilio connection
    const connection = await externalApiService.getConnection(input.twilio_connection_id)
    
    // Get API client
    const client = await externalApiService.getApiClient(input.twilio_connection_id)
    
    // Send SMS
    const response = await client.post(
      `/Accounts/${connection.provider_data.account_sid}/Messages.json`,
      {
        From: connection.provider_data.phone_number,
        To: input.to_number,
        Body: input.message
      }
    )
    
    return new StepResponse({ message_sid: response.data.sid })
  }
)
```

---

## Admin UI

### API Management Dashboard

```typescript
// List all external APIs
GET /admin/external-apis
Response: [
  {
    id: "ext_api_facebook_001",
    name: "Facebook Graph API",
    category: "social",
    status: "active",
    connections_count: 5
  },
  {
    id: "ext_api_stripe_001",
    name: "Stripe Payment Gateway",
    category: "payment",
    status: "active",
    connections_count: 1
  }
]

// Create new API configuration
POST /admin/external-apis
Body: {
  name: "SendGrid Email",
  slug: "sendgrid",
  category: "email",
  api_config: {
    base_url: "https://api.sendgrid.com/v3",
    auth_type: "bearer",
    api_key: {
      key: "SG.xxx",  // Will be encrypted
      header_name: "Authorization",
      key_prefix: "Bearer "
    }
  }
}

// List user connections
GET /admin/external-apis/{api_id}/connections
Response: [
  {
    id: "conn_001",
    connection_name: "My Facebook Page",
    status: "active",
    last_used_at: "2024-01-15T10:30:00Z"
  }
]

// Initiate OAuth flow
GET /admin/external-apis/{api_id}/oauth/authorize
Redirects to provider's OAuth page

// OAuth callback
GET /admin/external-apis/{api_id}/oauth/callback?code=xxx
Creates connection with encrypted tokens
```

---

## Migration Strategy

### Phase 1: Create External APIs Module
1. Create new module structure
2. Define models and schemas
3. Implement service layer
4. Add encryption support

### Phase 2: Migrate Social Platforms
1. Create migration script
2. Transform `social_platform` → `external_api`
3. Transform `social_platform_account` → `external_api_connection`
4. Encrypt all credentials
5. Update references in code

### Phase 3: Add New API Types
1. Add Stripe configuration
2. Add Twilio configuration
3. Add SendGrid configuration
4. Test each integration

### Phase 4: Update Workflows
1. Update social publishing workflows
2. Create payment workflows
3. Create notification workflows
4. Test end-to-end

---

## Benefits

### 1. **Flexibility**
- ✅ Add new APIs without code changes
- ✅ Multiple configurations per API
- ✅ Per-tenant/per-partner configurations
- ✅ Easy to test with sandbox environments

### 2. **Security**
- ✅ All credentials encrypted
- ✅ No secrets in environment variables
- ✅ Audit trail of changes
- ✅ Granular access control

### 3. **Scalability**
- ✅ Support any external API
- ✅ Reusable API client
- ✅ Built-in rate limiting
- ✅ Automatic retry logic

### 4. **Maintainability**
- ✅ Centralized API management
- ✅ Easy to update credentials
- ✅ Clear separation of concerns
- ✅ Self-documenting configurations

### 5. **Multi-Tenancy**
- ✅ Per-tenant API configurations
- ✅ Partner-specific integrations
- ✅ Sales channel isolation
- ✅ Flexible credential management

---

## Conclusion

This **External API Management System** provides:
- ✅ **Database-driven** API configurations
- ✅ **Encrypted credentials** at rest
- ✅ **Generic API client** for any integration
- ✅ **Multi-tenant support** out of the box
- ✅ **Scalable architecture** for future integrations

It transforms the rigid, environment-variable-based approach into a flexible, secure, and maintainable system that can handle any external API integration.

---

## Next Steps

1. Review this design
2. Decide on migration approach
3. Implement alongside encryption service
4. Migrate social platforms first
5. Add new API types incrementally

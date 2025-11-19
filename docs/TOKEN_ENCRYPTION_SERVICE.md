# Token Encryption Service

## Overview

Implement an encryption service to protect sensitive tokens (access tokens, refresh tokens, OAuth secrets) stored in the database. This prevents token exposure in case of database breaches, logs, or backups.

---

## Security Requirements

### 1. **What to Encrypt**
- ✅ Access tokens (OAuth 2.0)
- ✅ Refresh tokens
- ✅ Page access tokens (Facebook)
- ✅ OAuth 1.0a secrets (Twitter)
- ✅ API keys and consumer secrets
- ❌ Non-sensitive metadata (user IDs, usernames, timestamps)

### 2. **Encryption Standards**
- **Algorithm**: AES-256-GCM (Galois/Counter Mode)
- **Key Management**: Environment variables with rotation support
- **IV (Initialization Vector)**: Unique per encryption
- **Authentication**: Built-in with GCM mode

### 3. **Key Management**
- Store encryption keys in environment variables
- Support key rotation without data loss
- Never commit keys to version control
- Use different keys for dev/staging/production

---

## Implementation

### 1. Encryption Service

**File**: `/src/services/encryption-service.ts`

```typescript
import crypto from "crypto"
import { MedusaError } from "@medusajs/utils"

interface EncryptedData {
  encrypted: string      // Base64 encoded encrypted data
  iv: string            // Base64 encoded initialization vector
  authTag: string       // Base64 encoded authentication tag
  keyVersion: number    // For key rotation support
}

export class EncryptionService {
  private readonly algorithm = "aes-256-gcm"
  private readonly keyVersion: number
  private readonly encryptionKey: Buffer

  constructor() {
    // Get encryption key from environment
    const keyString = process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY_V1
    
    if (!keyString) {
      throw new Error(
        "ENCRYPTION_KEY not found in environment variables. " +
        "Generate one with: openssl rand -base64 32"
      )
    }

    // Validate key length (must be 32 bytes for AES-256)
    const keyBuffer = Buffer.from(keyString, "base64")
    if (keyBuffer.length !== 32) {
      throw new Error(
        `Invalid encryption key length: ${keyBuffer.length} bytes. ` +
        "Must be 32 bytes (256 bits) for AES-256."
      )
    }

    this.encryptionKey = keyBuffer
    this.keyVersion = parseInt(process.env.ENCRYPTION_KEY_VERSION || "1", 10)
  }

  /**
   * Encrypt sensitive data
   */
  encrypt(plaintext: string): EncryptedData {
    if (!plaintext) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Cannot encrypt empty string"
      )
    }

    try {
      // Generate random IV (12 bytes recommended for GCM)
      const iv = crypto.randomBytes(12)

      // Create cipher
      const cipher = crypto.createCipheriv(this.algorithm, this.encryptionKey, iv)

      // Encrypt data
      let encrypted = cipher.update(plaintext, "utf8", "base64")
      encrypted += cipher.final("base64")

      // Get authentication tag
      const authTag = cipher.getAuthTag()

      return {
        encrypted,
        iv: iv.toString("base64"),
        authTag: authTag.toString("base64"),
        keyVersion: this.keyVersion,
      }
    } catch (error) {
      console.error("Encryption failed:", error)
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Encryption failed: ${error.message}`
      )
    }
  }

  /**
   * Decrypt encrypted data
   */
  decrypt(encryptedData: EncryptedData): string {
    if (!encryptedData || !encryptedData.encrypted) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Cannot decrypt empty data"
      )
    }

    try {
      // Get the appropriate key for this data's version
      const key = this.getKeyForVersion(encryptedData.keyVersion)

      // Convert from base64
      const iv = Buffer.from(encryptedData.iv, "base64")
      const authTag = Buffer.from(encryptedData.authTag, "base64")

      // Create decipher
      const decipher = crypto.createDecipheriv(this.algorithm, key, iv)
      decipher.setAuthTag(authTag)

      // Decrypt data
      let decrypted = decipher.update(encryptedData.encrypted, "base64", "utf8")
      decrypted += decipher.final("utf8")

      return decrypted
    } catch (error) {
      console.error("Decryption failed:", error)
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Decryption failed: ${error.message}`
      )
    }
  }

  /**
   * Get encryption key for a specific version (supports key rotation)
   */
  private getKeyForVersion(version: number): Buffer {
    if (version === this.keyVersion) {
      return this.encryptionKey
    }

    // Support for old keys during rotation
    const oldKeyString = process.env[`ENCRYPTION_KEY_V${version}`]
    if (!oldKeyString) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Encryption key version ${version} not found. Cannot decrypt data.`
      )
    }

    return Buffer.from(oldKeyString, "base64")
  }

  /**
   * Check if data needs re-encryption (old key version)
   */
  needsReEncryption(encryptedData: EncryptedData): boolean {
    return encryptedData.keyVersion < this.keyVersion
  }

  /**
   * Re-encrypt data with current key version
   */
  reEncrypt(encryptedData: EncryptedData): EncryptedData {
    const plaintext = this.decrypt(encryptedData)
    return this.encrypt(plaintext)
  }
}

// Singleton instance
let encryptionServiceInstance: EncryptionService | null = null

export function getEncryptionService(): EncryptionService {
  if (!encryptionServiceInstance) {
    encryptionServiceInstance = new EncryptionService()
  }
  return encryptionServiceInstance
}
```

---

### 2. Platform Config with Encryption

**File**: `/src/schemas/platform-api-config.ts` (Updated)

```typescript
import { z } from "zod"

// Encrypted field schema
const EncryptedFieldSchema = z.object({
  encrypted: z.string(),
  iv: z.string(),
  authTag: z.string(),
  keyVersion: z.number(),
})

export type EncryptedField = z.infer<typeof EncryptedFieldSchema>

// Base schema with encrypted tokens
const BasePlatformConfigSchema = z.object({
  // Encrypted fields
  access_token_encrypted: EncryptedFieldSchema,
  refresh_token_encrypted: EncryptedFieldSchema.optional(),
  
  // Non-sensitive fields (not encrypted)
  token_type: z.enum(["USER", "PAGE", "APP"]),
  expires_at: z.string().optional(),
  scopes: z.array(z.string()).optional(),
  authenticated_at: z.string(),
  last_refreshed_at: z.string().optional(),
})

// Facebook schema with encrypted tokens
const FacebookApiConfigSchema = BasePlatformConfigSchema.extend({
  platform: z.literal("facebook"),
  token_type: z.literal("PAGE"),
  
  // Encrypted tokens
  page_access_token_encrypted: EncryptedFieldSchema,
  user_access_token_encrypted: EncryptedFieldSchema.optional(),
  
  // Non-sensitive metadata
  user_id: z.string(),
  user_name: z.string().optional(),
  page_id: z.string(),
  page_name: z.string().optional(),
  
  metadata: z.object({
    pages: z.array(z.object({
      id: z.string(),
      name: z.string(),
      access_token_encrypted: EncryptedFieldSchema,
      category: z.string().optional(),
    })).optional(),
  }).optional(),
})

// Twitter schema with encrypted OAuth secrets
const TwitterApiConfigSchema = BasePlatformConfigSchema.extend({
  platform: z.enum(["twitter", "x"]),
  token_type: z.literal("USER"),
  
  // Encrypted OAuth 1.0a credentials
  oauth1_credentials_encrypted: z.object({
    access_token: EncryptedFieldSchema,
    access_token_secret: EncryptedFieldSchema,
  }).optional(),
  
  // Encrypted app credentials
  oauth1_app_credentials_encrypted: z.object({
    consumer_key: EncryptedFieldSchema,
    consumer_secret: EncryptedFieldSchema,
  }).optional(),
  
  // Non-sensitive metadata
  user_id: z.string(),
  username: z.string().optional(),
  name: z.string().optional(),
})

export const PlatformApiConfigSchema = z.discriminatedUnion("platform", [
  FacebookApiConfigSchema,
  InstagramApiConfigSchema,
  FBINSTAApiConfigSchema,
  TwitterApiConfigSchema,
])
```

---

### 3. Helper Functions for Token Management

**File**: `/src/utils/token-encryption.ts`

```typescript
import { getEncryptionService } from "../services/encryption-service"
import type { EncryptedField } from "../schemas/platform-api-config"

/**
 * Encrypt a token for storage
 */
export function encryptToken(token: string): EncryptedField {
  const encryptionService = getEncryptionService()
  return encryptionService.encrypt(token)
}

/**
 * Decrypt a token for use
 */
export function decryptToken(encryptedToken: EncryptedField): string {
  const encryptionService = getEncryptionService()
  return encryptionService.decrypt(encryptedToken)
}

/**
 * Encrypt all tokens in platform config before storage
 */
export function encryptPlatformConfig(config: any): any {
  const encryptionService = getEncryptionService()

  switch (config.platform) {
    case "facebook":
      return {
        ...config,
        access_token_encrypted: encryptionService.encrypt(config.access_token),
        page_access_token_encrypted: encryptionService.encrypt(config.page_access_token),
        user_access_token_encrypted: config.user_access_token
          ? encryptionService.encrypt(config.user_access_token)
          : undefined,
        // Remove plaintext tokens
        access_token: undefined,
        page_access_token: undefined,
        user_access_token: undefined,
        // Encrypt tokens in metadata
        metadata: config.metadata ? {
          ...config.metadata,
          pages: config.metadata.pages?.map((page: any) => ({
            ...page,
            access_token_encrypted: encryptionService.encrypt(page.access_token),
            access_token: undefined,
          })),
        } : undefined,
      }

    case "twitter":
    case "x":
      return {
        ...config,
        access_token_encrypted: encryptionService.encrypt(config.access_token),
        refresh_token_encrypted: config.refresh_token
          ? encryptionService.encrypt(config.refresh_token)
          : undefined,
        oauth1_credentials_encrypted: config.oauth1_credentials ? {
          access_token: encryptionService.encrypt(config.oauth1_credentials.access_token),
          access_token_secret: encryptionService.encrypt(config.oauth1_credentials.access_token_secret),
        } : undefined,
        // Remove plaintext tokens
        access_token: undefined,
        refresh_token: undefined,
        oauth1_credentials: undefined,
      }

    default:
      return config
  }
}

/**
 * Decrypt all tokens in platform config for use
 */
export function decryptPlatformConfig(config: any): any {
  const encryptionService = getEncryptionService()

  switch (config.platform) {
    case "facebook":
      return {
        ...config,
        access_token: encryptionService.decrypt(config.access_token_encrypted),
        page_access_token: encryptionService.decrypt(config.page_access_token_encrypted),
        user_access_token: config.user_access_token_encrypted
          ? encryptionService.decrypt(config.user_access_token_encrypted)
          : undefined,
        // Decrypt tokens in metadata
        metadata: config.metadata ? {
          ...config.metadata,
          pages: config.metadata.pages?.map((page: any) => ({
            ...page,
            access_token: encryptionService.decrypt(page.access_token_encrypted),
          })),
        } : undefined,
      }

    case "twitter":
    case "x":
      return {
        ...config,
        access_token: encryptionService.decrypt(config.access_token_encrypted),
        refresh_token: config.refresh_token_encrypted
          ? encryptionService.decrypt(config.refresh_token_encrypted)
          : undefined,
        oauth1_credentials: config.oauth1_credentials_encrypted ? {
          access_token: encryptionService.decrypt(config.oauth1_credentials_encrypted.access_token),
          access_token_secret: encryptionService.decrypt(config.oauth1_credentials_encrypted.access_token_secret),
        } : undefined,
      }

    default:
      return config
  }
}
```

---

### 4. Updated OAuth Callback with Encryption

**File**: `/src/api/admin/oauth/[platform]/callback/route.ts` (Updated)

```typescript
import { encryptPlatformConfig } from "../../../../utils/token-encryption"
import { PlatformApiConfigSchema } from "../../../../schemas/platform-api-config"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const platform = req.params.platform
  const { code } = req.query

  // Exchange code for tokens (plaintext)
  const tokens = await exchangeCodeForToken(code, platform)

  // Build platform config (plaintext)
  const plaintextConfig = await buildPlatformConfig(platform, tokens)

  // Encrypt sensitive tokens
  const encryptedConfig = encryptPlatformConfig(plaintextConfig)

  // Validate encrypted config against schema
  const validation = PlatformApiConfigSchema.safeParse(encryptedConfig)
  
  if (!validation.success) {
    console.error("API config validation failed:", validation.error)
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Invalid API config: ${validation.error.message}`
    )
  }

  // Store encrypted config
  await socials.updateSocialPlatforms([{
    selector: { id: platformId },
    data: {
      api_config: validation.data,  // Encrypted tokens stored
      status: "active",
    },
  }])

  res.redirect("/admin/social-platforms")
}
```

---

### 5. Updated Workflow Step with Decryption

**File**: `/src/workflows/socials/steps/validate-platform.ts` (Updated)

```typescript
import { createStep, StepResponse } from "@medusajs/workflows-sdk"
import { MedusaError } from "@medusajs/utils"
import { PlatformApiConfigSchema } from "../../../schemas/platform-api-config"
import { decryptPlatformConfig } from "../../../utils/token-encryption"

export const validatePlatformAndCredentialsStep = createStep(
  "validate-platform-and-credentials",
  async (input: ValidatePlatformInput) => {
    const platform = input.post.platform

    if (!platform) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Post has no associated platform"
      )
    }

    const platformName = (platform.name || "").toLowerCase()
    const encryptedConfig = platform.api_config

    if (!encryptedConfig) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Platform has no API configuration"
      )
    }

    // Validate encrypted config structure
    const validation = PlatformApiConfigSchema.safeParse(encryptedConfig)
    
    if (!validation.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Invalid platform configuration: ${validation.error.message}`
      )
    }

    // Decrypt tokens for use in workflow
    const decryptedConfig = decryptPlatformConfig(validation.data)
    const userAccessToken = decryptedConfig.access_token

    // Check token expiration
    if (decryptedConfig.expires_at) {
      const expiresAt = new Date(decryptedConfig.expires_at)
      if (expiresAt < new Date()) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Access token has expired. Please re-authenticate."
        )
      }
    }

    return new StepResponse({
      platform,
      platformName,
      apiConfig: decryptedConfig,  // Decrypted for workflow use
      userAccessToken,
    })
  }
)
```

---

## Environment Variables

### Required Configuration

```bash
# .env file

# Primary encryption key (generate with: openssl rand -base64 32)
ENCRYPTION_KEY=your-32-byte-base64-encoded-key-here
ENCRYPTION_KEY_VERSION=1

# For key rotation (keep old keys for decryption)
# ENCRYPTION_KEY_V1=old-key-for-decryption
# ENCRYPTION_KEY_V2=new-key-for-encryption
```

### Generate Encryption Key

```bash
# Generate a secure 256-bit (32-byte) key
openssl rand -base64 32

# Example output:
# 8xKzP2mN5qR9tV3wY6bC1dE4fG7hJ0kL8mN5pQ2rS4t=
```

---

## Key Rotation Strategy

### When to Rotate Keys
- ✅ Annually (recommended)
- ✅ After suspected compromise
- ✅ When team members leave
- ✅ During security audits

### How to Rotate Keys

**Step 1: Generate New Key**
```bash
openssl rand -base64 32
```

**Step 2: Update Environment Variables**
```bash
# Keep old key for decryption
ENCRYPTION_KEY_V1=old-key-here

# Set new key as primary
ENCRYPTION_KEY=new-key-here
ENCRYPTION_KEY_VERSION=2
```

**Step 3: Re-encrypt Existing Data**
```typescript
// Migration script
import { getEncryptionService } from "./services/encryption-service"
import { SOCIALS_MODULE } from "./modules/socials"

async function reEncryptAllPlatforms(container: any) {
  const socials = container.resolve(SOCIALS_MODULE)
  const encryptionService = getEncryptionService()

  const [platforms] = await socials.listSocialPlatforms({})

  for (const platform of platforms) {
    const config = platform.api_config

    // Check if needs re-encryption
    if (config.access_token_encrypted.keyVersion < encryptionService.keyVersion) {
      // Decrypt with old key, encrypt with new key
      const decrypted = decryptPlatformConfig(config)
      const reEncrypted = encryptPlatformConfig(decrypted)

      await socials.updateSocialPlatforms([{
        selector: { id: platform.id },
        data: { api_config: reEncrypted },
      }])

      console.log(`Re-encrypted platform ${platform.id}`)
    }
  }
}
```

**Step 4: Remove Old Key (After Migration)**
```bash
# After all data is re-encrypted
# Remove old key from environment
unset ENCRYPTION_KEY_V1
```

---

## Security Best Practices

### 1. **Key Storage**
- ✅ Store keys in environment variables
- ✅ Use secrets management (AWS Secrets Manager, HashiCorp Vault)
- ✅ Never commit keys to version control
- ✅ Use different keys per environment
- ❌ Never hardcode keys in code

### 2. **Access Control**
- ✅ Limit access to encryption keys
- ✅ Audit key access logs
- ✅ Use IAM roles for key access
- ✅ Rotate keys regularly

### 3. **Logging**
- ✅ Never log decrypted tokens
- ✅ Log encryption/decryption events
- ✅ Mask tokens in error messages
- ❌ Never log plaintext tokens

### 4. **Database**
- ✅ Encrypted tokens stored in JSON fields
- ✅ No plaintext tokens in database
- ✅ Regular database backups (encrypted)
- ✅ Encrypted database connections (SSL/TLS)

---

## Testing

### Unit Tests

```typescript
import { EncryptionService } from "./services/encryption-service"

describe("EncryptionService", () => {
  let service: EncryptionService

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = Buffer.from("a".repeat(32)).toString("base64")
    service = new EncryptionService()
  })

  it("should encrypt and decrypt data correctly", () => {
    const plaintext = "my-secret-token-12345"
    const encrypted = service.encrypt(plaintext)
    const decrypted = service.decrypt(encrypted)

    expect(decrypted).toBe(plaintext)
    expect(encrypted.encrypted).not.toBe(plaintext)
  })

  it("should generate unique IVs for each encryption", () => {
    const plaintext = "same-token"
    const encrypted1 = service.encrypt(plaintext)
    const encrypted2 = service.encrypt(plaintext)

    expect(encrypted1.iv).not.toBe(encrypted2.iv)
    expect(encrypted1.encrypted).not.toBe(encrypted2.encrypted)
  })

  it("should fail decryption with wrong auth tag", () => {
    const plaintext = "my-token"
    const encrypted = service.encrypt(plaintext)
    
    // Tamper with auth tag
    encrypted.authTag = Buffer.from("wrong").toString("base64")

    expect(() => service.decrypt(encrypted)).toThrow()
  })

  it("should support key rotation", () => {
    // Encrypt with old key
    process.env.ENCRYPTION_KEY_V1 = Buffer.from("b".repeat(32)).toString("base64")
    process.env.ENCRYPTION_KEY_VERSION = "1"
    const oldService = new EncryptionService()
    const encrypted = oldService.encrypt("my-token")

    // Decrypt with new key (should use old key for decryption)
    process.env.ENCRYPTION_KEY = Buffer.from("c".repeat(32)).toString("base64")
    process.env.ENCRYPTION_KEY_VERSION = "2"
    const newService = new EncryptionService()
    const decrypted = newService.decrypt(encrypted)

    expect(decrypted).toBe("my-token")
  })
})
```

---

## Migration Plan

### Phase 1: Implement Encryption Service
1. Create `EncryptionService` class
2. Add helper functions for token encryption
3. Add unit tests
4. Generate encryption keys for all environments

### Phase 2: Update Schemas
1. Update platform config schemas with encrypted fields
2. Update validators
3. Test schema validation

### Phase 3: Update OAuth Flow
1. Encrypt tokens in OAuth callback
2. Test OAuth flow with encryption
3. Verify encrypted storage in database

### Phase 4: Update Workflows
1. Decrypt tokens in workflow steps
2. Test publishing workflows
3. Verify no plaintext tokens in logs

### Phase 5: Migrate Existing Data
1. Create migration script
2. Re-encrypt existing platform configs
3. Verify all platforms work after migration
4. Remove plaintext tokens from database

---

## Benefits

### 1. **Security**
- ✅ Tokens encrypted at rest
- ✅ Protection against database breaches
- ✅ No plaintext tokens in backups
- ✅ Authentication with GCM mode

### 2. **Compliance**
- ✅ GDPR compliance (data protection)
- ✅ PCI DSS compliance (if applicable)
- ✅ SOC 2 compliance requirements
- ✅ Industry best practices

### 3. **Key Rotation**
- ✅ Support for key rotation
- ✅ No downtime during rotation
- ✅ Backward compatibility with old keys
- ✅ Gradual migration

### 4. **Auditability**
- ✅ Track encryption/decryption events
- ✅ Key version tracking
- ✅ Compliance audit trails
- ✅ Security monitoring

---

## Conclusion

Implementing token encryption provides:
- ✅ **Strong security** with AES-256-GCM
- ✅ **Key rotation** support without downtime
- ✅ **Compliance** with security standards
- ✅ **Protection** against database breaches
- ✅ **Auditability** for security monitoring

This is a **critical security enhancement** that should be implemented before storing any production tokens.

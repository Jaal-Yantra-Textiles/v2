---
title: "Token Encryption via Event Subscriber"
sidebar_label: "Encryption Subscriber"
sidebar_position: 3
---

# Token Encryption via Event Subscriber

## 🎯 Overview

Token encryption is now handled automatically via an **event subscriber** that listens to platform creation and update events. This is a cleaner, more maintainable approach than embedding encryption logic in workflows.

---

## 🏗️ Architecture

### Event-Driven Encryption

```
User creates/updates platform
         ↓
Platform saved to database (plaintext tokens)
         ↓
Event emitted: "social_platform.created" or "social_platform.updated"
         ↓
Subscriber triggered
         ↓
Subscriber checks for plaintext tokens
         ↓
Encrypts tokens if found
         ↓
Updates platform with encrypted tokens
         ↓
Database: Tokens now encrypted ✅
```

### Benefits

✅ **Separation of Concerns** - Encryption logic separate from business logic  
✅ **Automatic** - Works for all platform creation/update paths  
✅ **No Workflow Changes** - Workflows remain simple and focused  
✅ **Consistent** - Same encryption logic for create and update  
✅ **Resilient** - Doesn't break platform creation if encryption fails  

---

## 📁 Implementation

### File: `/src/subscribers/social-platform-credentials-encryption.ts`

**Events Listened To**:
- `social_platform.created`
- `social_platform.updated`

**What It Does**:
1. Fetches the platform by ID
2. Checks `api_config` for plaintext tokens
3. Encrypts tokens if not already encrypted
4. Updates platform with encrypted tokens
5. Removes plaintext tokens

**Tokens Encrypted**:
- `access_token` → `access_token_encrypted`
- `refresh_token` → `refresh_token_encrypted`
- `oauth1_credentials` → `oauth1_credentials_encrypted`
- `oauth1_app_credentials` → `oauth1_app_credentials_encrypted`

---

## 🔐 Encryption Logic

### Detection

The subscriber only encrypts tokens that are **not already encrypted**:

```typescript
// Check if access_token needs encryption
if (apiConfig.access_token && typeof apiConfig.access_token === 'string') {
  // Only encrypt if not already encrypted
  if (!apiConfig.access_token_encrypted) {
    encryptedConfig.access_token_encrypted = encryptionService.encrypt(apiConfig.access_token)
    delete encryptedConfig.access_token // Remove plaintext
    needsUpdate = true
  }
}
```

### Encryption Process

1. **Check for plaintext** - Is there a plaintext token?
2. **Check for encrypted** - Is it already encrypted?
3. **Encrypt** - Use `EncryptionService.encrypt()`
4. **Store encrypted** - Save as `*_encrypted` field
5. **Remove plaintext** - Delete original plaintext field
6. **Update** - Save to database

---

## 💡 Usage Examples

### Example 1: Create Platform (Automatic Encryption)

```typescript
// Create platform with plaintext token
const platform = await api.post("/admin/social-platforms", {
  name: "Facebook",
  category: "social",
  auth_type: "oauth2",
  api_config: {
    access_token: "plaintext_token_12345"  // Plaintext
  }
})

// Subscriber automatically encrypts
// Database now has:
// api_config: {
//   access_token_encrypted: { encrypted: "...", iv: "...", authTag: "..." }
// }
```

### Example 2: Update Platform (Automatic Encryption)

```typescript
// Update platform with new token
await api.post(`/admin/social-platforms/${platformId}`, {
  api_config: {
    access_token: "new_plaintext_token"  // Plaintext
  }
})

// Subscriber automatically encrypts the new token
```

### Example 3: OAuth Callback (Automatic Encryption)

```typescript
// OAuth callback stores plaintext tokens
await socials.updateSocialPlatforms([{
  selector: { id: platformId },
  data: {
    api_config: {
      access_token: oauthResponse.access_token,  // Plaintext
      refresh_token: oauthResponse.refresh_token  // Plaintext
    }
  }
}])

// Subscriber automatically encrypts both tokens
```

---

## 🧪 Testing

### Test Scenario 1: Platform Creation

```typescript
// Create platform
const response = await api.post("/admin/social-platforms", {
  name: "Test Platform",
  api_config: {
    access_token: "test_token_123"
  }
})

// Fetch platform
const platform = await api.get(`/admin/social-platforms/${response.data.socialPlatform.id}`)

// Verify encryption
expect(platform.data.socialPlatform.api_config.access_token).toBeUndefined()
expect(platform.data.socialPlatform.api_config.access_token_encrypted).toBeDefined()
expect(platform.data.socialPlatform.api_config.access_token_encrypted.encrypted).toBeDefined()
```

### Test Scenario 2: Platform Update

```typescript
// Update with new token
await api.post(`/admin/social-platforms/${platformId}`, {
  api_config: {
    access_token: "new_token_456"
  }
})

// Fetch and verify
const updated = await api.get(`/admin/social-platforms/${platformId}`)
expect(updated.data.socialPlatform.api_config.access_token).toBeUndefined()
expect(updated.data.socialPlatform.api_config.access_token_encrypted).toBeDefined()
```

---

## 🔄 Workflow Integration

### Before (Manual Encryption in Workflow)

```typescript
// ❌ Old way - encryption in workflow
export const createSocialPlatformWorkflow = createWorkflow(
  "create-social-platform",
  (input) => {
    const encryptedData = encryptPlatformTokensStep(input)
    const result = createSocialPlatformStep(encryptedData)
    return new WorkflowResponse(result)
  }
)
```

### After (Automatic via Subscriber)

```typescript
// ✅ New way - subscriber handles encryption
export const createSocialPlatformWorkflow = createWorkflow(
  "create-social-platform",
  (input) => {
    const result = createSocialPlatformStep(input)
    // Encryption happens automatically via subscriber
    return new WorkflowResponse(result)
  }
)
```

---

## 🛡️ Error Handling

The subscriber is **resilient** and won't break platform creation:

```typescript
try {
  // Encrypt tokens
  await socials.updateSocialPlatforms([...])
  console.log("✅ Credentials encrypted")
} catch (error) {
  console.error("❌ Encryption failed:", error)
  // Don't throw - platform is still created
  // Just with plaintext tokens (which will trigger warnings)
}
```

**Why?**
- Platform creation should never fail due to encryption issues
- Plaintext tokens will trigger warnings in decrypt step
- Admin can re-save platform to trigger encryption again

---

## 📊 Monitoring

### Console Logs

```
[Encryption Subscriber] ✓ Encrypted access_token for platform Facebook
[Encryption Subscriber] ✓ Encrypted refresh_token for platform Facebook
[Encryption Subscriber] ✅ Platform Facebook credentials encrypted and saved
```

### Error Logs

```
[Encryption Subscriber] ❌ Failed to encrypt credentials for platform platform_123: Error message
```

### Metrics to Track

- Number of platforms with encrypted tokens
- Number of platforms with plaintext tokens
- Encryption success rate
- Encryption failures

---

## 🔍 Debugging

### Check if Tokens are Encrypted

```typescript
const [platform] = await socials.listSocialPlatforms({ id: platformId })
const apiConfig = platform.api_config

console.log("Has plaintext token:", !!apiConfig.access_token)
console.log("Has encrypted token:", !!apiConfig.access_token_encrypted)
```

### Force Re-encryption

```typescript
// Update platform to trigger subscriber
await socials.updateSocialPlatforms([{
  selector: { id: platformId },
  data: {
    api_config: {
      ...platform.api_config,
      access_token: "new_token"  // Triggers encryption
    }
  }
}])
```

---

## 🚀 Deployment

### Prerequisites

1. **Encryption Service** must be configured
2. **ENCRYPTION_KEY** environment variable must be set
3. **Subscriber** must be registered (automatic in MedusaJS)

### Migration for Existing Platforms

If you have existing platforms with plaintext tokens:

```typescript
// Migration script
const platforms = await socials.listSocialPlatforms({})

for (const platform of platforms) {
  if (platform.api_config?.access_token) {
    // Update to trigger subscriber
    await socials.updateSocialPlatforms([{
      selector: { id: platform.id },
      data: { updated_at: new Date() }
    }])
  }
}
```

---

## 📝 Best Practices

1. **Always use plaintext in API calls** - Let subscriber handle encryption
2. **Never store encrypted tokens manually** - Subscriber does this
3. **Check logs** - Verify encryption is happening
4. **Monitor failures** - Set up alerts for encryption errors
5. **Test thoroughly** - Verify encryption in all scenarios

---

## 🎓 Comparison: Workflow vs Subscriber

| Aspect | Workflow Approach | Subscriber Approach |
|--------|------------------|---------------------|
| **Separation of Concerns** | ❌ Mixed | ✅ Separated |
| **Code Complexity** | ❌ Higher | ✅ Lower |
| **Maintainability** | ❌ Harder | ✅ Easier |
| **Consistency** | ❌ Must remember | ✅ Automatic |
| **Error Handling** | ❌ Breaks workflow | ✅ Resilient |
| **Testing** | ❌ More complex | ✅ Simpler |
| **Reusability** | ❌ Per workflow | ✅ All paths |

---

## 🔗 Related Documentation

- [Encryption Service](/docs/implementation/security/encryption-service)
- [Unified Workflow](/docs/reference/status/unified-workflow)
- [Deployment Guide](/docs/guides/deployment/checklist)

---

**Last Updated**: November 19, 2025  
**Version**: 2.0.0 (Subscriber-based)  
**Status**: ✅ Production Ready

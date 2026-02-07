---
title: "X Provider Alias Configuration"
sidebar_label: "Provider Alias"
sidebar_position: 3
---

# X Provider Alias Configuration

## ✅ Changes Made

Added "x" as an alias for "twitter" provider throughout the codebase to support both naming conventions.

### 1. Provider Service Registration

**File:** `src/modules/social-provider/service.ts`

- Added "x" case alongside "twitter" in the provider switch statement
- Both "x" and "twitter" resolve to the same `TwitterService` instance
- Uses shared cache key to ensure singleton behavior

### 2. Provider Token Map

**File:** `src/modules/social-provider/social-provider-registry.ts`

- Added `x: SOCIAL_PROVIDER_MODULE` mapping
- Ensures "x" is recognized as a valid provider in the module system

### 3. OAuth Initiation

**File:** `src/api/admin/oauth/[platform]/route.ts`

- Normalizes "x" to "twitter" for environment variable lookups
- `X_REDIRECT_URI` → falls back to `TWITTER_REDIRECT_URI`
- `X_SCOPE` → falls back to `TWITTER_SCOPE`

### 4. OAuth Callback

**File:** `src/api/admin/oauth/[platform]/callback/route.ts`

- Normalizes "x" to "twitter" for environment variable lookups
- Handles both "twitter" and "x" in token exchange logic
- Uses PKCE flow for both variants

## 🔧 Environment Variables

You can use either naming convention:

```bash
# Option 1: Twitter prefix
TWITTER_CLIENT_ID=...
TWITTER_CLIENT_SECRET=...
TWITTER_API_KEY=...
TWITTER_API_SECRET=...
TWITTER_REDIRECT_URI=http://localhost:9000/admin/oauth/twitter/callback
TWITTER_SCOPE=tweet.write offline.access

# Option 2: X prefix (will fall back to TWITTER_ if not set)
X_CLIENT_ID=...
X_CLIENT_SECRET=...
X_API_KEY=...
X_API_SECRET=...
X_REDIRECT_URI=http://localhost:9000/admin/oauth/x/callback
X_SCOPE=tweet.write offline.access
```

**Recommendation:** Use `X_` prefix for new setups, as it matches the current branding.

## 📋 Usage

### Creating a Platform

You can now use either "twitter" or "x" as the provider name:

```bash
# Option 1: Using "x"
POST /admin/social-platforms
{
  "name": "X",
  "provider": "x",
  "is_active": true
}

# Option 2: Using "twitter"
POST /admin/social-platforms
{
  "name": "Twitter",
  "provider": "twitter",
  "is_active": true
}
```

Both will use the same `TwitterService` implementation.

### OAuth Flow

Both URLs work identically:

```bash
# Using "x"
GET /admin/oauth/x

# Using "twitter"
GET /admin/oauth/twitter
```

### Publishing

The workflow automatically handles both:

```typescript
// In publish-post.ts workflow
if (providerName === "twitter" || providerName === "x") {
  // Same logic for both
}
```

## ✅ Verified Compatibility

- ✅ Provider service resolution
- ✅ OAuth initiation
- ✅ OAuth callback
- ✅ Token exchange
- ✅ Publishing workflow
- ✅ Environment variable fallback

## 🎯 Benefits

1. **Flexibility** - Users can choose their preferred naming
2. **Future-proof** - Supports X branding without breaking Twitter references
3. **Backward compatible** - Existing "twitter" configurations continue to work
4. **Consistent** - Same service instance for both aliases

---

**Last Updated:** 2025-01-13
**Status:** Fully implemented and tested

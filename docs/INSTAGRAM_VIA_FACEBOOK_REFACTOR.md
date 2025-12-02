# Instagram Service Refactor: Using Facebook Login Exclusively

## ✅ Refactoring Complete

The `InstagramService` has been refactored to use **Facebook's Graph API exclusively** instead of Instagram's legacy OAuth API.

## 🎯 What Changed

### Before: Dual OAuth System ❌

**Old Architecture:**
```
Instagram OAuth (api.instagram.com)
├── Separate client credentials
├── Different OAuth flow
├── Limited permissions
└── Legacy API

Facebook OAuth (graph.facebook.com)
├── Separate client credentials
├── Different OAuth flow
└── Full Graph API access
```

**Problems:**
- Two separate OAuth flows
- Two sets of credentials to manage
- Instagram OAuth is legacy/deprecated
- Limited Instagram API access
- Confusing for users

### After: Unified Facebook Login ✅

**New Architecture:**
```
Facebook Login (Single OAuth)
├── One set of credentials
├── One OAuth flow
├── Full Instagram permissions
└── Instagram Graph API via Facebook

Instagram Service
├── No OAuth methods
├── Uses Facebook tokens
├── Graph API v24.0
└── All Instagram operations
```

**Benefits:**
- ✅ Single OAuth flow
- ✅ One set of credentials
- ✅ Modern Graph API
- ✅ Full Instagram capabilities
- ✅ Simpler for users

---

## 📊 Code Changes

### 1. InstagramService Refactored

**File:** `src/modules/social-provider/instagram-service.ts`

**Removed (91 lines):**
- ❌ `getAuthUrl()` - Instagram OAuth URL generation
- ❌ `initiateUserAuth()` - Instagram OAuth initiation
- ❌ `exchangeCodeForToken()` - Instagram token exchange
- ❌ `refreshAccessToken()` - Token refresh
- ❌ Client ID/Secret properties
- ❌ Constructor with credentials

**Kept (All Graph API methods):**
- ✅ `getLinkedIgAccounts()` - Fetch Instagram accounts
- ✅ `createContainer()` - Create media container
- ✅ `publishContainer()` - Publish media
- ✅ `publishImage()` - Publish photo
- ✅ `publishVideoAsReel()` - Publish reel
- ✅ `getMediaPermalink()` - Get post URL

**Upgraded:**
- ✅ All endpoints from v18.0 → v24.0

**New Documentation:**
```typescript
/**
 * InstagramService - Instagram Graph API via Facebook Login
 * 
 * This service uses Facebook's Graph API to manage Instagram Business accounts.
 * Authentication is handled through Facebook Login (not Instagram OAuth).
 * 
 * Requirements:
 * - Instagram account must be Business or Creator type
 * - Instagram account must be linked to a Facebook Page
 * - Use Facebook access token (from FacebookService)
 * 
 * All methods use Facebook Graph API v24.0
 */
```

### 2. Type System Updated

**File:** `src/modules/social-provider/service.ts`

**Before:**
```typescript
private cache_: Record<string, BaseSocialProviderService | ContentPublishingService> = {}
```

**After:**
```typescript
type SocialProvider = BaseSocialProviderService | ContentPublishingService | InstagramService

private cache_: Record<string, SocialProvider> = {}
```

**Reason:** `InstagramService` no longer implements `BaseSocialProviderService` interface (no OAuth methods)

---

## 🔄 Authentication Flow

### Old Flow (Removed)

```
1. User clicks "Connect Instagram"
2. Redirect to api.instagram.com/oauth/authorize
3. User grants Instagram permissions
4. Callback with code
5. Exchange code for Instagram token
6. Limited Instagram API access
```

### New Flow (Current)

```
1. User clicks "Connect FBINSTA"
2. Redirect to Facebook OAuth (graph.facebook.com)
3. User grants Facebook + Instagram permissions
4. Callback with code
5. Exchange code for Facebook token
6. Token works for BOTH Facebook and Instagram APIs
7. Full Instagram Graph API access
```

---

## 📋 API Endpoints Updated

### All Instagram Endpoints Now Use v24.0

| Endpoint | Old | New |
|----------|-----|-----|
| Get Pages | v18.0 | v24.0 |
| Get IG Account | v18.0 | v24.0 |
| Create Container | v18.0 | v24.0 |
| Publish Container | v18.0 | v24.0 |
| Get Permalink | v18.0 | v24.0 |

### Instagram Graph API Endpoints

**1. Get Linked Instagram Accounts**
```
GET https://graph.facebook.com/v24.0/me/accounts
GET https://graph.facebook.com/v24.0/{page-id}?fields=instagram_business_account
```

**2. Create Media Container**
```
POST https://graph.facebook.com/v24.0/{ig-user-id}/media
Body: image_url, caption, media_type
```

**3. Publish Container**
```
POST https://graph.facebook.com/v24.0/{ig-user-id}/media_publish
Body: creation_id
```

**4. Get Media Permalink**
```
GET https://graph.facebook.com/v24.0/{media-id}?fields=permalink
```

---

## 🎯 Usage Examples

### Before (Old Way - Removed)

```typescript
// ❌ This no longer works
const instagramService = new InstagramService()
const authUrl = instagramService.getAuthUrl(redirectUri, scope)
const token = await instagramService.exchangeCodeForToken(code, redirectUri)
```

### After (New Way - Current)

```typescript
// ✅ Use Facebook OAuth
const facebookService = new FacebookService()
const authUrl = facebookService.getAuthUrl(redirectUri, scope) // Includes Instagram permissions
const token = await facebookService.exchangeCodeForToken(code, redirectUri)

// ✅ Use Facebook token with Instagram service
const instagramService = new InstagramService()
const igAccounts = await instagramService.getLinkedIgAccounts(token.access_token)
const result = await instagramService.publishImage(igUserId, { image_url, caption }, token.access_token)
```

### In ContentPublishingService

```typescript
// ✅ Already uses this pattern
async publishContent(input: PublishContentInput) {
  // Get Facebook Page token (works for Instagram too)
  const pageAccessToken = await this.facebookService.getPageAccessToken(
    input.pageId,
    input.userAccessToken
  )
  
  // Use same token for Instagram
  const result = await this.instagramService.publishImage(
    input.igUserId,
    { image_url, caption },
    pageAccessToken  // ← Facebook token works!
  )
}
```

---

## 🔑 Credentials Required

### Before (Removed)

```bash
# Instagram OAuth (no longer needed)
INSTAGRAM_CLIENT_ID=xxx
INSTAGRAM_CLIENT_SECRET=xxx
INSTAGRAM_REDIRECT_URI=xxx

# Facebook OAuth
FACEBOOK_CLIENT_ID=xxx
FACEBOOK_CLIENT_SECRET=xxx
FACEBOOK_REDIRECT_URI=xxx
```

### After (Current)

```bash
# Facebook OAuth only (works for Instagram too!)
FACEBOOK_CLIENT_ID=YOUR_FACEBOOK_APP_ID
FACEBOOK_CLIENT_SECRET=YOUR_FACEBOOK_APP_SECRET
FACEBOOK_REDIRECT_URI=http://localhost:9000/app/settings/external-platforms/oauth-callback/facebook/callback
```

**No Instagram credentials needed!** 🎉

---

## 📊 Permissions

### Facebook OAuth Scope (Includes Instagram)

```typescript
const scope = "pages_show_list,pages_manage_posts,pages_read_engagement,instagram_basic,instagram_content_publish,instagram_manage_comments,instagram_manage_insights,instagram_manage_messages"
```

**Instagram Permissions via Facebook:**
- `instagram_basic` - Access Instagram account info
- `instagram_content_publish` - Publish to Instagram
- `instagram_manage_comments` - Manage comments
- `instagram_manage_insights` - Access analytics
- `instagram_manage_messages` - Manage DMs

---

## ✅ Benefits of This Refactor

### 1. Simplified Authentication
- **Before:** Two OAuth flows (Facebook + Instagram)
- **After:** One OAuth flow (Facebook only)
- **Result:** Easier for users, fewer errors

### 2. Reduced Credentials
- **Before:** 6 environment variables (FB + IG)
- **After:** 3 environment variables (FB only)
- **Result:** Simpler configuration

### 3. Modern API
- **Before:** Instagram legacy OAuth API
- **After:** Facebook Graph API v24.0
- **Result:** Better features, longer support

### 4. Full Capabilities
- **Before:** Limited Instagram API access
- **After:** Full Instagram Graph API
- **Result:** Comments, insights, messages, etc.

### 5. Single Token
- **Before:** Separate tokens for FB and IG
- **After:** One token for both
- **Result:** Simpler token management

### 6. Better Documentation
- **Before:** Unclear which API to use
- **After:** Clear: Use Facebook for everything
- **Result:** Easier to understand and maintain

---

## 🔍 Migration Guide

### If You Have Existing Instagram OAuth

**Step 1: Remove Instagram Credentials**
```bash
# Remove these from .env
# INSTAGRAM_CLIENT_ID=xxx
# INSTAGRAM_CLIENT_SECRET=xxx
# INSTAGRAM_REDIRECT_URI=xxx
```

**Step 2: Ensure Facebook OAuth is Configured**
```bash
# Keep these in .env
FACEBOOK_CLIENT_ID=YOUR_FACEBOOK_APP_ID
FACEBOOK_CLIENT_SECRET=YOUR_FACEBOOK_APP_SECRET
FACEBOOK_REDIRECT_URI=http://localhost:9000/app/settings/external-platforms/oauth-callback/facebook/callback
```

**Step 3: Re-authenticate FBINSTA Platform**
- Go to Settings → Social Platforms → FBINSTA
- Click "Access" → "Log in with FBINSTA"
- Grant all permissions (including Instagram)
- Instagram accounts will be fetched via Facebook

**Step 4: Verify**
- Check `api_config.metadata.ig_accounts` is populated
- Test Instagram posting
- Everything should work!

---

## 🐛 Troubleshooting

### Issue: "InstagramService has no OAuth methods"

**This is expected!** InstagramService no longer handles OAuth.

**Solution:** Use FacebookService for authentication:
```typescript
// ✅ Correct
const fbService = new FacebookService()
const token = await fbService.exchangeCodeForToken(code, redirectUri)

// ✅ Then use token with Instagram
const igService = new InstagramService()
const accounts = await igService.getLinkedIgAccounts(token.access_token)
```

### Issue: "Instagram accounts not showing"

**Cause:** Instagram permissions not granted during Facebook OAuth

**Solution:**
1. Check Facebook OAuth scope includes `instagram_basic`
2. Re-authenticate FBINSTA platform
3. Grant Instagram permissions when prompted

### Issue: "Type error in service.ts"

**This is fixed!** The type system now accommodates InstagramService without OAuth interface.

---

## 📚 Related Documentation

- [Facebook Graph API v24.0](https://developers.facebook.com/docs/graph-api)
- [Instagram API with Facebook Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login)
- [Instagram Content Publishing](https://developers.facebook.com/docs/instagram-api/guides/content-publishing)

---

## 🎉 Summary

**What we removed:**
- ❌ Instagram OAuth methods (91 lines)
- ❌ Instagram client credentials
- ❌ Legacy Instagram API
- ❌ Duplicate OAuth flows

**What we kept:**
- ✅ All Instagram Graph API methods
- ✅ Photo publishing
- ✅ Video/Reel publishing
- ✅ Account fetching
- ✅ Permalink retrieval

**What we improved:**
- ✅ Upgraded to Graph API v24.0
- ✅ Unified authentication via Facebook
- ✅ Clearer documentation
- ✅ Simpler architecture
- ✅ Better type safety

**Result:** Simpler, more maintainable, and more powerful Instagram integration! 🚀

---

## 💡 Key Takeaway

**Instagram Service is now a pure Graph API wrapper that uses Facebook tokens.**

- **Authentication:** FacebookService
- **Instagram Operations:** InstagramService
- **Token:** Same Facebook token works for both!

This is the **recommended approach** by Meta and provides the best developer experience.

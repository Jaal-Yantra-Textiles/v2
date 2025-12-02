# Facebook Graph API v24.0 Upgrade & Full Instagram Permissions

## ✅ Completed Upgrades

### 1. API Version Upgraded to v24.0

All Facebook Graph API endpoints have been upgraded from v19.0/v23.0 to **v24.0**.

**Endpoints Updated:**
- ✅ OAuth authorization: `https://www.facebook.com/v24.0/dialog/oauth`
- ✅ Token exchange: `https://graph.facebook.com/v24.0/oauth/access_token`
- ✅ Token debug: `https://graph.facebook.com/v24.0/debug_token`
- ✅ List pages: `https://graph.facebook.com/v24.0/me/accounts`
- ✅ Get page fields: `https://graph.facebook.com/v24.0/{page-id}`
- ✅ Get page token: `https://graph.facebook.com/v24.0/{page-id}?fields=access_token`
- ✅ Create photo post: `https://graph.facebook.com/v24.0/{page-id}/photos`
- ✅ Create feed post: `https://graph.facebook.com/v24.0/{page-id}/feed`

### 2. Full Instagram Permissions Added

**New Default Scope:**
```
pages_show_list,
pages_manage_posts,
pages_read_engagement,
instagram_basic,
instagram_content_publish,
instagram_manage_comments,
instagram_manage_insights,
instagram_manage_messages
```

**Instagram Permissions Breakdown:**

| Permission | Purpose | Use Case |
|------------|---------|----------|
| `instagram_basic` | Access Instagram account info | Get username, ID, profile data |
| `instagram_content_publish` | Publish content to Instagram | Create posts, reels, stories |
| `instagram_manage_comments` | Manage Instagram comments | Read, reply, delete comments |
| `instagram_manage_insights` | Access Instagram analytics | Get post metrics, engagement data |
| `instagram_manage_messages` | Manage Instagram DMs | Read and reply to direct messages |

### 3. Granted Scopes Saved to API Config

**New Feature:** The system now fetches and saves the actual granted scopes from Facebook.

**How it works:**
1. After token exchange, calls `debug_token` endpoint
2. Extracts the list of granted scopes
3. Saves to `api_config.scope` field
4. Allows you to verify which permissions were actually granted

**Example saved data:**
```json
{
  "api_config": {
    "access_token": "EAAUJiPtN7ZAY...",
    "token_type": "bearer",
    "expires_in": 5183944,
    "scope": "pages_show_list,pages_manage_posts,instagram_basic,instagram_content_publish",
    "retrieved_at": "2025-11-07T10:44:00Z",
    "metadata": {
      "pages": [...],
      "ig_accounts": [...]
    }
  }
}
```

## 📊 Code Changes Summary

### File: `src/modules/social-provider/facebook-service.ts`

#### 1. Updated Default Scope (Line 25)
```typescript
// Before
const defaultScope = "pages_show_list,pages_manage_posts,pages_read_engagement,instagram_basic";

// After
const defaultScope = "pages_show_list,pages_manage_posts,pages_read_engagement,instagram_basic,instagram_content_publish,instagram_manage_comments,instagram_manage_insights,instagram_manage_messages";
```

#### 2. Added Scope Fetching (Lines 73-85)
```typescript
// Get the granted scopes from the token debug endpoint
let grantedScope = "";
try {
  const debugUrl = `https://graph.facebook.com/v24.0/debug_token?input_token=${data.access_token}&access_token=${data.access_token}`;
  const debugResp = await fetch(debugUrl);
  if (debugResp.ok) {
    const debugData = await debugResp.json();
    grantedScope = debugData.data?.scopes?.join(",") || "";
  }
} catch (e) {
  console.warn("Failed to fetch granted scopes:", (e as Error).message);
}
```

#### 3. Return Scope in Token Response (Line 91)
```typescript
return {
  access_token: data.access_token,
  token_type: data.token_type,
  expires_in: data.expires_in,
  scope: grantedScope,  // ← Now includes actual granted scopes
  refresh_token: "",
  retrieved_at: new Date()
};
```

#### 4. Upgraded All API Endpoints to v24.0
- OAuth dialog: v24.0
- Token exchange: v24.0
- Token debug: v24.0
- All Graph API calls: v24.0

### File: `.env.template`

Updated documentation with all Instagram permissions:
```bash
# Facebook OAuth (for FBINSTA platform)
FACEBOOK_CLIENT_ID=your_facebook_app_id
FACEBOOK_CLIENT_SECRET=your_facebook_app_secret
FACEBOOK_REDIRECT_URI=http://localhost:9000/app/settings/external-platforms/oauth-callback/facebook/callback

# Default scope includes full Facebook Pages + Instagram permissions:
# - pages_show_list: List Facebook Pages
# - pages_manage_posts: Publish to Pages
# - pages_read_engagement: Read Page metrics
# - instagram_basic: Access Instagram account info
# - instagram_content_publish: Publish to Instagram
# - instagram_manage_comments: Manage Instagram comments
# - instagram_manage_insights: Access Instagram insights/analytics
# - instagram_manage_messages: Manage Instagram direct messages
```

## 🎯 Benefits

### 1. Latest API Version
- Access to newest Facebook/Instagram features
- Better performance and reliability
- Extended support timeline

### 2. Full Instagram Capabilities
- **Content Publishing:** Create posts, reels, stories
- **Comment Management:** Moderate and respond to comments
- **Analytics:** Access insights and engagement metrics
- **Messaging:** Manage direct messages

### 3. Scope Transparency
- See exactly which permissions were granted
- Debug permission issues easily
- Verify user consent

### 4. Future-Proof
- Ready for advanced Instagram features
- Can add new capabilities without code changes
- Comprehensive permission coverage

## 📋 Testing Checklist

### Before Re-authenticating:
- [ ] Server restarted (to load updated code)
- [ ] Instagram account is Business/Creator type
- [ ] Instagram is linked to Facebook Page
- [ ] You're added as Admin/Tester in Facebook app
- [ ] All Instagram permissions added to app's use cases

### After Re-authenticating:
- [ ] No "Invalid Scopes" errors
- [ ] OAuth completes successfully
- [ ] Check `api_config.scope` contains all permissions
- [ ] Facebook Pages fetched
- [ ] Instagram accounts fetched
- [ ] Can create posts to both platforms

## 🔍 Verify Granted Scopes

After authentication, check the platform's `api_config.scope`:

```json
{
  "scope": "pages_show_list,pages_manage_posts,pages_read_engagement,instagram_basic,instagram_content_publish,instagram_manage_comments,instagram_manage_insights,instagram_manage_messages"
}
```

If some permissions are missing, it means:
1. User didn't grant them during OAuth
2. App doesn't have those permissions configured
3. Permissions require app review (for production)

## 🐛 Troubleshooting

### Issue: "Invalid Scopes" Error

**Cause:** Instagram permissions not configured in Facebook app

**Solution:**
1. Go to App Dashboard → Use Cases
2. Find "Get an Instagram account" use case
3. Add all Instagram permissions
4. Add yourself as Administrator
5. Re-authenticate

### Issue: Some Scopes Missing from api_config.scope

**Cause:** User didn't grant all permissions or app doesn't have them

**Solution:**
1. Check which scopes are missing
2. Verify they're configured in app's use cases
3. Re-authenticate and grant all permissions
4. Check if permissions require app review

### Issue: Instagram Accounts Still Not Showing

**After adding all permissions:**
1. Verify Instagram is Business/Creator type
2. Verify Instagram is linked to Facebook Page
3. Check server logs for errors
4. Use debug endpoint: `/admin/socials/debug-instagram?platform_id=xxx`

## 💡 Permission Usage Examples

### instagram_basic
```typescript
// Get Instagram account info
GET /v24.0/{ig-user-id}?fields=username,followers_count,media_count
```

### instagram_content_publish
```typescript
// Create Instagram post
POST /v24.0/{ig-user-id}/media
{
  image_url: "https://...",
  caption: "My post"
}
```

### instagram_manage_comments
```typescript
// Get post comments
GET /v24.0/{media-id}/comments

// Reply to comment
POST /v24.0/{comment-id}/replies
```

### instagram_manage_insights
```typescript
// Get post insights
GET /v24.0/{media-id}/insights?metric=engagement,impressions,reach
```

### instagram_manage_messages
```typescript
// Get conversations
GET /v24.0/{ig-user-id}/conversations

// Send message
POST /v24.0/{conversation-id}/messages
```

## 🎉 Summary

**Upgraded:**
- ✅ All API endpoints to v24.0
- ✅ Added 5 Instagram permissions
- ✅ Scope tracking in api_config

**New Capabilities:**
- ✅ Full Instagram content publishing
- ✅ Comment moderation
- ✅ Analytics and insights
- ✅ Direct message management

**Next Steps:**
1. Re-authenticate FBINSTA platform
2. Verify all scopes are granted
3. Test Instagram posting
4. Explore new Instagram features!

Your FBINSTA platform now has full Facebook and Instagram capabilities! 🚀

# Facebook Login for Business - Configuration ID Setup

## ✅ Configuration ID Integrated

Your Facebook Login for Business Configuration ID `YOUR_CONFIG_ID` has been integrated into the OAuth flow.

## 🔧 What Was Added

### Code Changes

**File:** `src/modules/social-provider/facebook-service.ts`

Added support for `config_id` parameter in OAuth URL:

```typescript
// Add Facebook Login for Business configuration ID if provided
const configId = process.env.FACEBOOK_CONFIG_ID;
if (configId) {
  params.set("config_id", configId);
}
```

### Environment Variable

**File:** `.env.template`

```bash
FACEBOOK_CONFIG_ID=YOUR_CONFIG_ID
```

## 📋 Setup Steps

### Step 1: Add Configuration ID to Your `.env` File

Add this line to your `.env` file:

```bash
FACEBOOK_CONFIG_ID=YOUR_CONFIG_ID
```

### Step 2: Verify Your Configuration in Facebook App Dashboard

1. Go to https://developers.facebook.com/apps/YOUR_FACEBOOK_APP_ID/
2. Click **Facebook Login for Business** (left sidebar)
3. Click **Configurations**
4. Verify your configuration `YOUR_CONFIG_ID` shows:
   - ✅ Token Type: User access token (or System-user access token)
   - ✅ Assets: Facebook Pages, Instagram accounts
   - ✅ Permissions: `pages_show_list`, `pages_manage_posts`, `instagram_basic`

### Step 3: Test Authentication

1. Restart your server (to load the new env variable)
2. Go to Settings → Social Platforms → FBINSTA
3. Click "Access" → "Log in with FBINSTA"
4. The OAuth URL will now include `config_id=YOUR_CONFIG_ID`
5. You should see the permissions dialog with Instagram access!

## 🎯 How Configuration ID Works

### OAuth URL Structure

**Before (without config_id):**
```
https://www.facebook.com/v19.0/dialog/oauth?
  client_id=YOUR_FACEBOOK_APP_ID&
  redirect_uri=...&
  scope=pages_show_list,pages_manage_posts,instagram_basic&
  response_type=code&
  state=...
```

**After (with config_id):**
```
https://www.facebook.com/v19.0/dialog/oauth?
  client_id=YOUR_FACEBOOK_APP_ID&
  redirect_uri=...&
  scope=pages_show_list,pages_manage_posts,instagram_basic&
  response_type=code&
  state=...&
  config_id=YOUR_CONFIG_ID  ← Added!
```

### What Configuration ID Does

The `config_id` parameter tells Facebook:
1. Which pre-configured permission set to use
2. Which assets (Pages, IG accounts) to request access to
3. What token type and expiration to use
4. Bypasses the "Invalid Scopes" error for Instagram permissions

## 📊 Configuration Settings

Based on your Configuration ID `YOUR_CONFIG_ID`, ensure these settings:

### Recommended Configuration

**Token Type:** User access token
- Users log in with their personal Facebook account
- Access to their managed Pages and linked Instagram accounts

**Assets:**
- ✅ Facebook Pages
- ✅ Instagram Business Accounts

**Permissions:**
- ✅ `pages_show_list` - List Facebook Pages
- ✅ `pages_manage_posts` - Publish to Pages
- ✅ `pages_read_engagement` - Read Page metrics
- ✅ `instagram_basic` - Access Instagram account info
- ✅ `instagram_content_publish` - Publish to Instagram (optional)

**Token Expiration:**
- Recommended: 60 days (default)
- Can be set to "Never" for system users

## 🔍 Troubleshooting

### Error: "Invalid config_id"

**Cause:** Configuration ID doesn't exist or isn't active

**Solution:**
1. Verify the Configuration ID in App Dashboard
2. Ensure configuration is active (not deleted)
3. Check you're using the correct App ID

### Error: "Invalid Scopes" (still happening)

**Cause:** Configuration doesn't include the requested permissions

**Solution:**
1. Go to App Dashboard → Facebook Login for Business → Configurations
2. Edit your configuration `YOUR_CONFIG_ID`
3. Add missing permissions (`instagram_basic`, etc.)
4. Save and re-authenticate

### Instagram Accounts Still Not Showing

**After adding config_id:**
1. ✅ Configuration ID is in `.env`
2. ✅ Server restarted
3. ✅ Re-authenticated with FBINSTA
4. ✅ Instagram account is Business type
5. ✅ Instagram is linked to Facebook Page
6. Check server logs for Instagram accounts fetched

## 🎉 Expected Behavior

### OAuth Flow with Configuration ID

1. User clicks "Log in with FBINSTA"
2. Redirected to Facebook with `config_id=YOUR_CONFIG_ID`
3. Facebook shows permission dialog based on configuration
4. User grants permissions
5. Redirected back with authorization code
6. Token exchanged
7. Facebook Pages and Instagram accounts fetched
8. Stored in `platform.api_config.metadata`

### Expected Data Structure

After successful authentication:

```json
{
  "api_config": {
    "access_token": "EAAUJiPtN7ZAY...",
    "metadata": {
      "pages": [
        {
          "id": "747917475065823",
          "name": "Cici Label"
        }
      ],
      "ig_accounts": [
        {
          "id": "17841405822304914",
          "username": "cicilabel",
          "page_id": "747917475065823"
        }
      ]
    }
  }
}
```

## 📝 Complete Environment Variables

Your `.env` file should have:

```bash
# Facebook OAuth for FBINSTA
FACEBOOK_CLIENT_ID=YOUR_FACEBOOK_APP_ID
FACEBOOK_CLIENT_SECRET=YOUR_FACEBOOK_APP_SECRET
FACEBOOK_REDIRECT_URI=http://localhost:9000/app/settings/social-platforms/oauth-callback/facebook/callback
FACEBOOK_CONFIG_ID=YOUR_CONFIG_ID

# Optional: Override default scope
# FACEBOOK_SCOPE=pages_show_list,pages_manage_posts,pages_read_engagement,instagram_basic
```

## 🚀 Testing Checklist

Before authenticating:
- [ ] `FACEBOOK_CONFIG_ID` added to `.env`
- [ ] Server restarted
- [ ] Configuration `YOUR_CONFIG_ID` is active in App Dashboard
- [ ] Configuration includes Instagram permissions
- [ ] Instagram account is Business/Creator type
- [ ] Instagram is linked to Facebook Page
- [ ] You're added as test user (for Development mode)

After authenticating:
- [ ] No "Invalid Scopes" error
- [ ] OAuth completes successfully
- [ ] Facebook Pages fetched
- [ ] Instagram accounts fetched
- [ ] Can create posts with both platforms

## 💡 Pro Tips

1. **Multiple Configurations:** You can create different configurations for different user types
2. **Configuration Templates:** Use Meta's preset templates as starting points
3. **Test Mode:** Configurations work in Development mode with test users
4. **Update Permissions:** Edit configuration anytime to add/remove permissions
5. **Monitor Usage:** Check App Dashboard for configuration usage stats

## 🔗 Helpful Links

- [Facebook Login for Business Docs](https://developers.facebook.com/docs/facebook-login-for-business)
- [Configuration Guide](https://developers.facebook.com/docs/facebook-login-for-business/guides/configurations)
- [Your App Dashboard](https://developers.facebook.com/apps/YOUR_FACEBOOK_APP_ID/)
- [Configurations Page](https://developers.facebook.com/apps/YOUR_FACEBOOK_APP_ID/fb-login-for-business/configurations/)

## 🎯 Summary

**Configuration ID `YOUR_CONFIG_ID` is now integrated!**

**What it does:**
- ✅ Enables Instagram permissions without "Invalid Scopes" error
- ✅ Pre-configures which assets and permissions to request
- ✅ Simplifies OAuth flow for business users
- ✅ Works in Development mode with test users

**Next steps:**
1. Add `FACEBOOK_CONFIG_ID=YOUR_CONFIG_ID` to `.env`
2. Restart server
3. Re-authenticate FBINSTA platform
4. Instagram accounts will now be fetched! 🎉

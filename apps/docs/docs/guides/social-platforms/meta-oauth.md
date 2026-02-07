---
title: "FBINSTA OAuth Setup Guide"
sidebar_label: "Meta OAuth"
sidebar_position: 3
---

# FBINSTA OAuth Setup Guide

## ✅ Implementation Complete

The FBINSTA platform now reuses the existing Facebook OAuth infrastructure, making setup seamless and avoiding duplicate OAuth configurations.

## 🔄 How It Works

### OAuth Flow Mapping

When you authenticate a platform named "FBINSTA" or "Facebook & Instagram":

1. **Frontend Detection**: The UI detects FBINSTA platform name
2. **OAuth Mapping**: Maps FBINSTA → Facebook OAuth endpoint
3. **Facebook OAuth**: Uses existing `/admin/oauth/facebook` endpoint
4. **Token Exchange**: Exchanges code for Facebook access token
5. **Data Fetching**: Automatically fetches:
   - Facebook Pages you manage
   - Instagram Business accounts linked to those pages
6. **Storage**: Stores everything in `platform.api_config`

### Code Changes Made

#### 1. Updated `SocialPlatformAccessComponent`
**File:** `src/admin/components/social-platforms/social-platform-access-component.tsx` (located in external-platforms route)

**Changes:**
- Added `FBINSTAIcon` component showing Facebook + Instagram icons
- Updated `SocialIcon` to recognize FBINSTA platform
- Modified `handleLogin` to map FBINSTA → Facebook OAuth

```typescript
const handleLogin = () => {
  if (!socialPlatform) return;
  // Treat FBINSTA as Facebook for OAuth
  const platformName = socialPlatform.name.toLowerCase();
  const oauthPlatform = (platformName === 'fbinsta' || platformName === 'facebook & instagram') 
    ? 'facebook' 
    : platformName;
  initiateOAuth({ platform: oauthPlatform, id: platformId });
}
```

### Backend Flow (Already Working!)

The existing Facebook OAuth callback already handles everything needed:

**File:** `src/api/admin/oauth/[platform]/callback/route.ts`

```typescript
// When platform is "facebook", it automatically:
if (platform.toLowerCase() === "facebook") {
  // 1. Fetch managed Facebook Pages
  const pages = await fb.listManagedPagesWithFields(tokenData.access_token, fields)
  
  // 2. Fetch linked Instagram Business accounts
  const ig = new InstagramService()
  const igAccounts = await ig.getLinkedIgAccounts(tokenData.access_token)
  
  // 3. Store in metadata
  metadata = { pages, ig_accounts: igAccounts }
}
```

Since FBINSTA uses Facebook OAuth, it gets all this data automatically!

## 📋 Setup Instructions

### Step 1: Configure Facebook OAuth (One-Time Setup)

If you haven't already, set up Facebook OAuth credentials:

1. Go to [Facebook Developers](https://developers.facebook.com/)
2. Create or select your app
3. Add "Facebook Login" product
4. Configure OAuth settings:
   - **Valid OAuth Redirect URIs:** 
     ```
     http://localhost:9000/app/settings/external-platforms/oauth-callback/facebook/callback
     https://yourdomain.com/app/settings/external-platforms/oauth-callback/facebook/callback
     ```
   - **Permissions:** 
     - `pages_show_list`
     - `pages_manage_posts`
     - `pages_read_engagement`
     - `instagram_basic`
     - `instagram_content_publish`

5. Add environment variables to your `.env`:
   ```bash
   FACEBOOK_CLIENT_ID=your_app_id
   FACEBOOK_CLIENT_SECRET=your_app_secret
   FACEBOOK_REDIRECT_URI=http://localhost:9000/app/settings/external-platforms/oauth-callback/facebook/callback
   FACEBOOK_SCOPE=pages_show_list,pages_manage_posts,pages_read_engagement
   ```

### Step 2: Create FBINSTA Platform

1. Navigate to **Settings → Social Platforms**
2. Click **Create**
3. Fill in:
   - **Name:** `FBINSTA` (exactly this, or "Facebook & Instagram")
   - **Description:** "Unified Facebook and Instagram publishing"
   - **URL:** (optional) `https://facebook.com`
4. Click **Save**

### Step 3: Authenticate

1. Open the FBINSTA platform detail page
2. Click the **Access** tab or **Connect** button
3. You'll see the combined Facebook + Instagram icon
4. Click **"Log in with FBINSTA"**
5. You'll be redirected to Facebook OAuth
6. Grant permissions for:
   - Managing your Facebook Pages
   - Accessing Instagram Business accounts
7. After authorization, you'll be redirected back
8. The system automatically fetches and stores:
   - All Facebook Pages you manage
   - All Instagram Business accounts linked to those pages

### Step 4: Verify Setup

After authentication, check the platform details:

**Expected `api_config` structure:**
```json
{
  "provider": "facebook",
  "access_token": "EAAxxxxx...",
  "token_type": "bearer",
  "expires_in": 5183944,
  "retrieved_at": "2025-01-01T12:00:00Z",
  "metadata": {
    "pages": [
      {
        "id": "123456789",
        "name": "My Business Page",
        "category": "Local Business"
      }
    ],
    "ig_accounts": [
      {
        "id": "987654321",
        "username": "mybusiness",
        "page_id": "123456789"
      }
    ]
  }
}
```

## 🎯 Benefits of This Approach

### 1. **No Duplicate OAuth Setup**
- Reuses existing Facebook OAuth configuration
- No need for separate Instagram OAuth app
- Single set of credentials

### 2. **Automatic Data Fetching**
- Facebook Pages fetched automatically
- Instagram accounts fetched automatically
- All stored in one place

### 3. **Consistent Token Management**
- Single access token works for both platforms
- Token refresh handled by existing Facebook logic
- No token synchronization issues

### 4. **Simplified User Experience**
- One authentication flow
- Clear visual indication (FB + IG icons)
- Intuitive "Log in with FBINSTA" button

### 5. **Future-Proof**
- Easy to add more features
- Can extend to Facebook Stories, IG Stories, etc.
- Centralized token management

## 🔍 How OAuth Mapping Works

```
User clicks "Log in with FBINSTA"
         ↓
Frontend detects platform name = "FBINSTA"
         ↓
Maps to OAuth platform = "facebook"
         ↓
Calls: GET /admin/oauth/facebook
         ↓
Returns Facebook OAuth URL
         ↓
User redirected to Facebook
         ↓
User grants permissions
         ↓
Facebook redirects back with code
         ↓
POST /admin/oauth/facebook/callback
         ↓
Exchanges code for access token
         ↓
Fetches Facebook Pages
         ↓
Fetches Instagram accounts
         ↓
Stores everything in platform.api_config
         ↓
Done! ✅
```

## 🎨 Visual Indicators

### Platform List
When viewing social platforms, FBINSTA shows:
- Name: "FBINSTA"
- Description: "Unified Facebook and Instagram publishing"

### OAuth Modal
When authenticating, you'll see:
- Combined Facebook + Instagram icon (FB icon + "+" + IG icon)
- Title: "Connect to FBINSTA"
- Button: "Log in with FBINSTA"

### After Authentication
Platform detail page shows:
- Status: Connected ✅
- Token expiration date
- Number of Facebook Pages
- Number of Instagram accounts

## ⚠️ Important Notes

### 1. Instagram Requirements
- Instagram account must be a **Business** or **Creator** account
- Must be linked to a Facebook Page
- Personal Instagram accounts won't appear

### 2. Token Expiration
- Facebook tokens expire after ~60 days
- Re-authenticate when token expires
- System will show warning before expiration

### 3. Permissions
Ensure your Facebook app has these permissions approved:
- `pages_show_list` - Required to list pages
- `pages_manage_posts` - Required to publish
- `pages_read_engagement` - Required for insights
- `instagram_basic` - Required for IG account info
- `instagram_content_publish` - Required to publish to IG

### 4. Platform Naming
The platform name must be exactly:
- `FBINSTA` (case-insensitive), or
- `Facebook & Instagram` (case-insensitive)

Any other variation won't be recognized.

## 🐛 Troubleshooting

### Issue: "Instagram accounts not showing"
**Solutions:**
1. Verify Instagram account is Business/Creator type
2. Ensure IG account is linked to a Facebook Page
3. Check that you manage the Facebook Page
4. Re-authenticate to refresh account list

### Issue: "OAuth redirect mismatch"
**Solution:** Ensure `FACEBOOK_REDIRECT_URI` in `.env` matches exactly what's configured in Facebook app settings

### Issue: "Insufficient permissions"
**Solution:** 
1. Go to Facebook App settings
2. Request additional permissions if needed
3. Re-authenticate the platform

### Issue: "Token expired"
**Solution:** Simply re-authenticate the platform - the system will fetch a new token

## 🔗 Related Files

### Frontend
- `src/admin/components/social-platforms/social-platform-access-component.tsx` - OAuth UI
- `src/admin/hooks/api/social-platforms.ts` - OAuth hooks
- Route: `/settings/external-platforms`

### Backend
- `src/api/admin/oauth/[platform]/route.ts` - OAuth initiation
- `src/api/admin/oauth/[platform]/callback/route.ts` - OAuth callback
- `src/modules/social-provider/facebook-service.ts` - Facebook API wrapper
- `src/modules/social-provider/instagram-service.ts` - Instagram API wrapper

## 🎉 Summary

FBINSTA OAuth is now fully integrated and reuses the existing Facebook OAuth infrastructure:

✅ No duplicate OAuth setup needed
✅ Single authentication flow
✅ Automatic Facebook Pages fetching
✅ Automatic Instagram accounts fetching
✅ Combined icon display
✅ Seamless user experience

Just create a platform named "FBINSTA" and authenticate - everything else is automatic!

## 📚 Next Steps

After setting up FBINSTA OAuth:
1. Create social posts using FBINSTA platform
2. Select Facebook Page and Instagram account
3. Publish to both platforms with one click

See [FBINSTA Integration Guide](/docs/reference/facebook/integration-guide) for post creation and publishing instructions.

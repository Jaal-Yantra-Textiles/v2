---
title: "Instagram Account Linking Troubleshooting"
sidebar_label: "Linking Troubleshooting"
sidebar_position: 2
---

# Instagram Account Linking Troubleshooting

## Issue: Instagram Accounts Not Showing in Social Post Creation

Your FBINSTA platform shows `"ig_accounts": []` which means no Instagram Business accounts were found linked to your Facebook Page.

## 🔍 Diagnosis

Based on your platform data:
- ✅ Facebook Page found: "Cici Label" (ID: 747917475065823)
- ❌ Instagram accounts: Empty array `[]`
- ✅ Access token: Present and valid

## 🎯 Root Causes

### 1. Instagram Account Not Linked to Facebook Page

The most common issue is that your Instagram account isn't properly linked to your Facebook Page.

**How to Check:**
1. Go to your Facebook Page: https://facebook.com/CiciLabel
2. Click **Settings** (left sidebar)
3. Click **Instagram** (left sidebar)
4. Check if an Instagram account is connected

**How to Fix:**
1. In Facebook Page Settings → Instagram
2. Click **Connect Account**
3. Log in to your Instagram account
4. **Important:** Your Instagram account must be a **Business** or **Creator** account (not Personal)

### 2. Instagram Account Type

Instagram Personal accounts cannot be linked to Facebook Pages. You need a Business or Creator account.

**How to Convert to Business Account:**
1. Open Instagram app
2. Go to your profile
3. Tap the menu (☰) → **Settings and privacy**
4. Tap **Account type and tools**
5. Tap **Switch to professional account**
6. Choose **Business** or **Creator**
7. Follow the setup steps

### 3. Missing Facebook App Permissions

Your Facebook app needs specific permissions to access Instagram data.

**Required Permissions:**
- `instagram_basic` - Access basic Instagram account info
- `instagram_content_publish` - Publish content to Instagram
- `pages_show_list` - List Facebook Pages
- `pages_manage_posts` - Manage posts on Pages

**How to Check:**
1. Go to [Facebook Developers](https://developers.facebook.com/)
2. Select your app
3. Go to **App Review** → **Permissions and Features**
4. Check if Instagram permissions are approved

**For Development:**
- Instagram permissions work in Development mode
- Add your Instagram account as a test user

**For Production:**
- Submit your app for review
- Request Instagram permissions

### 4. OAuth Scope Not Requested

The OAuth flow might not be requesting Instagram permissions.

**Check your `.env` file:**
```bash
FACEBOOK_SCOPE=pages_show_list,pages_manage_posts,pages_read_engagement,instagram_basic,instagram_content_publish
```

Make sure `instagram_basic` and `instagram_content_publish` are included!

## 🛠️ Debug Tools

### 1. Use the Debug Endpoint

I've created a debug endpoint to help diagnose the issue:

```bash
GET /admin/socials/debug-instagram?platform_id=01K9D25PAZHKTQ2ZYE64VRN1F8
```

**In your browser:**
```
http://localhost:9000/admin/socials/debug-instagram?platform_id=01K9D25PAZHKTQ2ZYE64VRN1F8
```

This will show:
- Raw Facebook API response
- Parsed Instagram accounts
- Diagnostic information
- Troubleshooting steps

### 2. Check Server Logs

After re-authenticating, check your server logs for:
```
[OAuth Callback] Fetched X Facebook pages and Y Instagram accounts
```

If you see:
```
[OAuth Callback] No Instagram accounts found. Check if Instagram Business account is linked to Facebook Page.
```

Then the Instagram account isn't linked properly.

### 3. Test Facebook Graph API Directly

Use Facebook's Graph API Explorer:
1. Go to https://developers.facebook.com/tools/explorer/
2. Select your app
3. Get a User Access Token with these permissions:
   - `pages_show_list`
   - `instagram_basic`
4. Make this API call:
   ```
   GET /me/accounts?fields=id,name,instagram_business_account{id,username}
   ```
5. Check if `instagram_business_account` appears in the response

**Expected Response:**
```json
{
  "data": [
    {
      "id": "747917475065823",
      "name": "Cici Label",
      "instagram_business_account": {
        "id": "17841400008460056",
        "username": "cicilabel"
      }
    }
  ]
}
```

If `instagram_business_account` is missing, the account isn't linked!

## ✅ Step-by-Step Fix

### Step 1: Convert Instagram to Business Account
1. Open Instagram app
2. Profile → Menu → Settings
3. Account → Switch to Professional Account
4. Choose Business
5. Complete setup

### Step 2: Link Instagram to Facebook Page
1. Go to Facebook Page Settings
2. Click Instagram (left sidebar)
3. Click "Connect Account"
4. Log in to Instagram
5. Authorize the connection

### Step 3: Verify Permissions
1. Check Facebook app has Instagram permissions
2. Update `.env` with Instagram scopes:
   ```bash
   FACEBOOK_SCOPE=pages_show_list,pages_manage_posts,pages_read_engagement,instagram_basic,instagram_content_publish
   ```

### Step 4: Re-authenticate FBINSTA Platform
1. Go to Settings → Social Platforms
2. Open your FBINSTA platform
3. Click "Access" or "Connect"
4. Click "Log in with FBINSTA"
5. Grant all permissions
6. Check server logs for success message

### Step 5: Verify Instagram Accounts Loaded
1. Check the platform's `api_config.metadata.ig_accounts`
2. Should now contain your Instagram account:
   ```json
   {
     "ig_accounts": [
       {
         "id": "17841400008460056",
         "username": "cicilabel",
         "page_id": "747917475065823"
       }
     ]
   }
   ```

### Step 6: Test Post Creation
1. Go to Social Posts → Create
2. Select FBINSTA platform
3. Instagram Account dropdown should now show your account!

## 🔗 Helpful Links

- [Convert to Instagram Business Account](https://help.instagram.com/502981923235522)
- [Link Instagram to Facebook Page](https://www.facebook.com/business/help/898752960195806)
- [Facebook App Permissions](https://developers.facebook.com/docs/permissions/reference)
- [Instagram Graph API Requirements](https://developers.facebook.com/docs/instagram-api/getting-started)

## 📊 Common Scenarios

### Scenario 1: Personal Instagram Account
**Problem:** Instagram account is Personal, not Business
**Solution:** Convert to Business account (see Step 1 above)

### Scenario 2: Not Linked to Page
**Problem:** Instagram Business account exists but not linked to Facebook Page
**Solution:** Link in Facebook Page Settings (see Step 2 above)

### Scenario 3: Wrong Facebook Page
**Problem:** Instagram linked to different Facebook Page
**Solution:** 
1. Unlink from old page
2. Link to correct page (the one in your FBINSTA platform)

### Scenario 4: Permissions Not Granted
**Problem:** OAuth didn't request Instagram permissions
**Solution:** 
1. Update `FACEBOOK_SCOPE` in `.env`
2. Re-authenticate platform

### Scenario 5: App Not Approved
**Problem:** Facebook app doesn't have Instagram permissions approved
**Solution:** 
- **Development:** Add Instagram account as test user
- **Production:** Submit app for review

## 🎯 Quick Checklist

Before creating a post, verify:
- [ ] Instagram account is Business/Creator type
- [ ] Instagram account is linked to Facebook Page
- [ ] Facebook Page ID matches the one in FBINSTA platform
- [ ] Facebook app has Instagram permissions
- [ ] OAuth scope includes `instagram_basic` and `instagram_content_publish`
- [ ] Platform `api_config.metadata.ig_accounts` is not empty
- [ ] Server logs show "Fetched X Instagram accounts"

## 💡 Pro Tips

1. **Use Graph API Explorer** to test API calls before debugging code
2. **Check server logs** after OAuth to see what was fetched
3. **Use the debug endpoint** to see raw API responses
4. **Test with a different Instagram account** to isolate the issue
5. **Verify Page ownership** - you must be an admin of the Facebook Page

## 🆘 Still Not Working?

If you've followed all steps and Instagram accounts still don't appear:

1. **Run the debug endpoint:**
   ```
   GET /admin/socials/debug-instagram?platform_id=YOUR_PLATFORM_ID
   ```

2. **Check the response** for:
   - `raw_api_response` - What Facebook API returned
   - `parsed_ig_accounts` - What our code parsed
   - `service_error` - Any errors during parsing
   - `diagnostics` - Summary of findings

3. **Share the debug output** to identify the specific issue

4. **Verify Instagram account type:**
   - Open Instagram app
   - Go to Settings → Account
   - Should say "Business" or "Creator"

5. **Double-check the link:**
   - Go to Facebook Page Settings → Instagram
   - Should show your Instagram username
   - Try disconnecting and reconnecting

## 📝 Summary

The empty `ig_accounts` array means your Instagram Business account isn't linked to your Facebook Page, or the OAuth flow didn't request Instagram permissions. Follow the steps above to:

1. ✅ Convert Instagram to Business account
2. ✅ Link Instagram to Facebook Page  
3. ✅ Add Instagram permissions to OAuth scope
4. ✅ Re-authenticate FBINSTA platform
5. ✅ Verify accounts loaded

After these steps, Instagram accounts will appear in the post creation form! 🎉

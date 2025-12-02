# Facebook App Use Cases Setup for FBINSTA

## 🎯 Single App, Multiple Use Cases

You only need **ONE Facebook app** with multiple use cases configured. You do NOT need separate apps for Facebook Pages and Instagram.

**Your App ID:** `YOUR_FACEBOOK_APP_ID`

## 📋 Complete Setup Guide

### Step 1: Add Required Products

Go to https://developers.facebook.com/apps/YOUR_FACEBOOK_APP_ID/

#### Add Facebook Login Product
1. Click **Add Product** (left sidebar)
2. Find **Facebook Login**
3. Click **Set Up**
4. Configure settings:
   - Valid OAuth Redirect URIs: `http://localhost:9000/app/settings/external-platforms/oauth-callback/facebook/callback`
   - Client OAuth Login: Yes
   - Web OAuth Login: Yes

#### Add Instagram Product
1. Click **Add Product** (left sidebar)
2. Find **Instagram Graph API** (or just "Instagram")
3. Click **Set Up**
4. This enables Instagram permissions for your app

### Step 2: Configure Use Cases

Go to **Use Cases** in the left sidebar.

#### Use Case 1: Authenticate and request data from users

This use case handles Facebook Pages access.

1. Find "Authenticate and request data from users"
2. Click **Customize**
3. Under **Permissions**, add:
   - ✅ `pages_show_list` - List Facebook Pages
   - ✅ `pages_manage_posts` - Publish to Pages
   - ✅ `pages_read_engagement` - Read Page metrics
   - ✅ `pages_manage_engagement` - Manage Page engagement
4. Click **Save**

#### Use Case 2: Get an Instagram account

This use case handles Instagram access.

1. Find "Get an Instagram account" (or similar Instagram use case)
2. If not present, click **Add use case** → Select Instagram-related use case
3. Click **Customize**
4. Under **Permissions**, add:
   - ✅ `instagram_basic` - Access Instagram account info
   - ✅ `instagram_content_publish` - Publish to Instagram
   - ✅ `instagram_manage_comments` - Manage comments (optional)
   - ✅ `instagram_manage_messages` - Manage messages (optional)
5. Click **Save**

### Step 3: Add Yourself as Test User/Admin

For Development mode testing:

1. Go to **Roles** → **Roles**
2. Click **Administrators** tab
3. Click **Add Administrators**
4. Add your Facebook account
5. This allows you to use all permissions without app review

### Step 4: Update Your Code

Your code should request all permissions in a single OAuth call:

**File:** `src/modules/social-provider/facebook-service.ts`

```typescript
// Line 26 - Add all permissions
const defaultScope = "pages_show_list,pages_manage_posts,pages_read_engagement,instagram_basic,instagram_content_publish";
```

### Step 5: Test Authentication

1. Restart your server
2. Go to Settings → Social Platforms → FBINSTA
3. Click "Access" → "Log in with FBINSTA"
4. You should see permission requests for BOTH:
   - Facebook Pages access
   - Instagram account access
5. Grant all permissions
6. Both Facebook Pages and Instagram accounts will be fetched!

## 🔍 How Single App Works with Multiple Use Cases

### OAuth Flow

```
User clicks "Log in with FBINSTA"
         ↓
OAuth request with combined scope:
pages_show_list,pages_manage_posts,pages_read_engagement,instagram_basic,instagram_content_publish
         ↓
Facebook checks configured use cases:
✅ Use Case 1: Pages permissions (approved)
✅ Use Case 2: Instagram permissions (approved)
         ↓
Single access token with ALL permissions
         ↓
Fetch Facebook Pages (Use Case 1)
Fetch Instagram accounts (Use Case 2)
         ↓
Store both in platform.api_config.metadata
         ↓
Done! ✅
```

### Single Token, Multiple APIs

The access token you receive can be used for:
- Facebook Graph API (for Pages)
- Instagram Graph API (for Instagram)

**Example:**
```javascript
// Same token for both APIs
const token = "EAAUJiPtN7ZAY..."

// Facebook Pages API
GET https://graph.facebook.com/v24.0/me/accounts?access_token={token}

// Instagram API
GET https://graph.facebook.com/v24.0/{page-id}?fields=instagram_business_account&access_token={token}
```

## 📊 Use Case vs Product vs Permission

| Level | Description | Example |
|-------|-------------|---------|
| **App** | Single Facebook app | ID: YOUR_FACEBOOK_APP_ID |
| **Product** | Feature set you add to app | Facebook Login, Instagram API |
| **Use Case** | Specific business scenario | "Manage Pages", "Get Instagram" |
| **Permission** | Specific data access | `pages_show_list`, `instagram_basic` |

## ✅ Correct Configuration

### Your Single App Should Have:

**Products:**
- ✅ Facebook Login
- ✅ Instagram Graph API

**Use Cases:**
- ✅ Authenticate and request data from users (for Pages)
- ✅ Get an Instagram account (for Instagram)

**Permissions (combined in single OAuth request):**
- ✅ `pages_show_list`
- ✅ `pages_manage_posts`
- ✅ `pages_read_engagement`
- ✅ `instagram_basic`
- ✅ `instagram_content_publish`

**Roles:**
- ✅ You as Administrator (for Development mode)

## 🐛 Common Mistakes

### ❌ Mistake 1: Creating Separate Apps
**Wrong:** One app for Facebook, another for Instagram
**Right:** Single app with both Facebook Login and Instagram products

### ❌ Mistake 2: Requesting Permissions Separately
**Wrong:** Two OAuth flows (one for Pages, one for Instagram)
**Right:** Single OAuth flow with combined permissions

### ❌ Mistake 3: Not Configuring Use Cases
**Wrong:** Just adding products without configuring use cases
**Right:** Add products AND configure their use cases with permissions

### ❌ Mistake 4: Forgetting Test Users
**Wrong:** Trying to use Instagram permissions without being Admin/Tester
**Right:** Add yourself as Administrator in Development mode

## 📋 Verification Checklist

Before authenticating, verify:

### In Facebook App Dashboard:
- [ ] Single app (YOUR_FACEBOOK_APP_ID)
- [ ] Facebook Login product added
- [ ] Instagram Graph API product added
- [ ] "Authenticate and request data" use case configured
- [ ] "Get an Instagram account" use case configured
- [ ] All permissions added to respective use cases
- [ ] You're added as Administrator

### In Your Code:
- [ ] Scope includes both Pages and Instagram permissions
- [ ] No `config_id` parameter (for personal use)
- [ ] OAuth redirect URI matches app settings
- [ ] Environment variables configured

### Prerequisites:
- [ ] Instagram account is Business/Creator type
- [ ] Instagram is linked to Facebook Page
- [ ] You manage the Facebook Page

## 🎯 Expected Result

After successful authentication with single app:

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

## 💡 Key Takeaways

1. **One app is enough** - Don't create separate apps
2. **Multiple products** - Add both Facebook Login and Instagram API
3. **Multiple use cases** - Configure Pages and Instagram use cases
4. **Single OAuth flow** - Request all permissions at once
5. **Single token** - Works for both Facebook and Instagram APIs
6. **Test users** - Add yourself as Admin for Development mode

## 🔗 Helpful Links

- [Your App Dashboard](https://developers.facebook.com/apps/YOUR_FACEBOOK_APP_ID/)
- [Use Cases Documentation](https://developers.facebook.com/docs/development/create-an-app/app-dashboard/use-cases)
- [Facebook Login Setup](https://developers.facebook.com/docs/facebook-login/overview)
- [Instagram Graph API](https://developers.facebook.com/docs/instagram-api)
- [Permissions Reference](https://developers.facebook.com/docs/permissions/reference)

## 🎉 Summary

**You need ONE Facebook app with:**
- Facebook Login product (for Pages)
- Instagram Graph API product (for Instagram)
- Both use cases configured with their permissions
- You as Administrator (for testing)

**Your code requests all permissions in single OAuth call, and you get a single token that works for both APIs!** 🚀

# Facebook Login for Business Setup (Required for Instagram API)

## 🎯 Key Discovery

The Instagram API with Facebook Login requires **"Facebook Login for Business"** product, NOT regular "Facebook Login"!

According to the official docs: [Instagram API with Facebook Login - Get Started](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/get-started)

## ✅ Correct Permissions

The documentation specifies these exact permissions:
- `instagram_basic` ✅
- `pages_show_list` ✅

Our code is already using these correctly!

## 🔧 Setup Steps

### Step 1: Add Facebook Login for Business Product

1. Go to your [Facebook App Dashboard](https://developers.facebook.com/apps/YOUR_FACEBOOK_APP_ID/)
2. Click **Add Product** (left sidebar)
3. Find **"Facebook Login for Business"** (NOT regular "Facebook Login")
4. Click **Set Up**

**Important:** This is different from regular "Facebook Login"!

### Step 2: Configure OAuth Redirect URIs

1. In **Facebook Login for Business** settings
2. Add your redirect URI:
   ```
   http://localhost:9000/app/settings/external-platforms/oauth-callback/facebook/callback
   ```
3. For production, also add:
   ```
   https://yourdomain.com/app/settings/external-platforms/oauth-callback/facebook/callback
   ```

### Step 3: Request Permissions

In **Facebook Login for Business** → **Permissions**:
1. Add `instagram_basic`
2. Add `pages_show_list`
3. Optionally add `pages_manage_posts` for publishing

### Step 4: Development Mode Setup

For testing in Development mode:

#### Option A: Add Test Users (Recommended)
1. Go to **Roles** → **Roles**
2. Click **Add Testers**
3. Add the Facebook account that owns the Instagram Business account
4. User must accept the invitation

#### Option B: Add Yourself as Admin
1. Go to **Roles** → **Roles**
2. Add yourself as **Administrator**
3. Admins can use all permissions in Development mode

### Step 5: Verify App Settings

Check these settings in your app:

**App Dashboard → Settings → Basic:**
- App ID: `YOUR_FACEBOOK_APP_ID` ✅
- App Secret: `YOUR_FACEBOOK_APP_SECRET` ✅
- App Mode: Development (for testing)

**App Dashboard → Facebook Login for Business:**
- Valid OAuth Redirect URIs: Your callback URL ✅
- Client OAuth Login: Yes
- Web OAuth Login: Yes

### Step 6: Test Authentication

1. Go to Settings → Social Platforms → FBINSTA
2. Click "Access" → "Log in with FBINSTA"
3. You should now see:
   - "Allow access to your Facebook Pages" ✅
   - "Allow access to your Instagram account" ✅
4. Grant permissions
5. Check server logs for Instagram accounts fetched

## 🔍 Differences: Facebook Login vs Facebook Login for Business

| Feature | Facebook Login | Facebook Login for Business |
|---------|---------------|----------------------------|
| Purpose | Consumer apps | Business/Enterprise apps |
| Instagram API | ❌ Not supported | ✅ Supported |
| Permissions | User data only | Business data (Pages, IG) |
| Use Case | Social features | Business management |

## 📊 Required Configuration

### Your `.env` File
```bash
FACEBOOK_CLIENT_ID=YOUR_FACEBOOK_APP_ID
FACEBOOK_CLIENT_SECRET=YOUR_FACEBOOK_APP_SECRET
FACEBOOK_REDIRECT_URI=http://localhost:9000/app/settings/external-platforms/oauth-callback/facebook/callback
```

### Facebook App Products
- ✅ Facebook Login for Business (NOT regular Facebook Login)
- ✅ Instagram API (optional, but recommended)

### Permissions Requested
- ✅ `instagram_basic` - Access Instagram account info
- ✅ `pages_show_list` - List Facebook Pages
- ✅ `pages_manage_posts` - Publish to Pages (for posting)

## 🐛 Troubleshooting

### Error: "Invalid Scopes: instagram_basic"

**Cause:** App doesn't have "Facebook Login for Business" product added

**Solution:**
1. Go to App Dashboard
2. Add **Facebook Login for Business** product (not regular Facebook Login)
3. Configure permissions
4. Re-authenticate

### Error: "This app is in Development Mode"

**Cause:** You're not a test user or admin

**Solution:**
1. Add yourself as **Tester** or **Administrator** in Roles
2. Accept invitation (for testers)
3. Re-authenticate

### Instagram Accounts Not Showing

**After adding Facebook Login for Business:**
1. ✅ Instagram account is Business/Creator type
2. ✅ Instagram is linked to Facebook Page
3. ✅ You're a test user or admin
4. ✅ Re-authenticated after adding product
5. Check server logs for errors

## 📋 Complete Checklist

Before authenticating:
- [ ] Facebook app created
- [ ] **Facebook Login for Business** product added (key!)
- [ ] OAuth redirect URI configured
- [ ] `instagram_basic` permission added
- [ ] `pages_show_list` permission added
- [ ] You're added as test user or admin
- [ ] Instagram account is Business/Creator type
- [ ] Instagram account is linked to Facebook Page
- [ ] Environment variables configured

## 🎯 Expected Flow

```
1. Add "Facebook Login for Business" product
         ↓
2. Configure permissions (instagram_basic, pages_show_list)
         ↓
3. Add yourself as test user/admin
         ↓
4. Authenticate FBINSTA platform
         ↓
5. Grant Instagram permissions (now available!)
         ↓
6. Instagram accounts fetched ✅
         ↓
7. Create posts to both platforms! 🎉
```

## 🔗 Official Documentation

- [Instagram API with Facebook Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/get-started)
- [Facebook Login for Business](https://developers.facebook.com/docs/facebook-login-for-business)
- [Instagram Basic Permission](https://developers.facebook.com/docs/permissions/reference/instagram_basic)
- [Pages Show List Permission](https://developers.facebook.com/docs/permissions/reference/pages_show_list)

## 💡 Key Takeaways

1. **Use "Facebook Login for Business"** - Not regular Facebook Login
2. **Permissions are correct** - `instagram_basic` and `pages_show_list`
3. **Add as test user** - For Development mode testing
4. **Instagram must be linked** - To Facebook Page
5. **Business account required** - Personal Instagram won't work

## 🎉 Summary

The error "Invalid Scopes: instagram_basic" means your app needs **"Facebook Login for Business"** product, not regular Facebook Login.

**Quick Fix:**
1. Go to App Dashboard → Add Product
2. Add **"Facebook Login for Business"**
3. Configure OAuth redirect URI
4. Add yourself as test user
5. Re-authenticate
6. Instagram permissions will work! ✅

The Instagram API specifically requires "Facebook Login for Business" to access business accounts through Facebook Pages.

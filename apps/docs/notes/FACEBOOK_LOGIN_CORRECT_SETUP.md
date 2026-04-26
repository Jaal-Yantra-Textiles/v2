# Facebook Login Setup (Correct Approach for FBINSTA)

## ⚠️ Issue: "Cannot onboard customers at this time"

This message appears because **Facebook Login for Business** is designed for B2B scenarios where one business onboards other businesses as customers.

**For your use case (managing your own accounts), you should use regular Facebook Login.**

## ✅ Correct Setup

### Step 1: Use Regular Facebook Login Product

1. Go to [Facebook App Dashboard](https://developers.facebook.com/apps/YOUR_FACEBOOK_APP_ID/)
2. In **Products** section (left sidebar)
3. If you have "Facebook Login for Business", you can keep it but **don't use the config_id**
4. Make sure you also have regular **"Facebook Login"** product added
5. If not, click **Add Product** → **Facebook Login** → **Set Up**

### Step 2: Configure Facebook Login (Regular)

1. Go to **Facebook Login** → **Settings**
2. Add your OAuth Redirect URI:
   ```
   http://localhost:9000/app/settings/external-platforms/oauth-callback/facebook/callback
   ```
3. Enable these settings:
   - ✅ Client OAuth Login: Yes
   - ✅ Web OAuth Login: Yes
   - ✅ Use Strict Mode for Redirect URIs: Yes

### Step 3: Add Yourself as Developer/Tester

**This is the key step to avoid "Invalid Scopes" error!**

1. Go to **Roles** → **Roles** (left sidebar)
2. Add yourself in one of these roles:

#### Option A: Add as Administrator (Recommended)
- Click **Administrators** tab
- Click **Add Administrators**
- Enter your Facebook account
- Administrators can use all permissions in Development mode

#### Option B: Add as Tester
- Click **Testers** tab  
- Click **Add Testers**
- Enter your Facebook account
- You'll need to accept the invitation

### Step 4: Request Standard Permissions

For Development mode with test users/admins, you can use these permissions **without app review**:

**Standard Permissions (No Review Needed):**
- ✅ `pages_show_list`
- ✅ `pages_manage_posts`
- ✅ `pages_read_engagement`

**Instagram Permissions (Need Special Setup):**
- ⚠️ `instagram_basic` - Requires test user/admin OR app review
- ⚠️ `instagram_content_publish` - Requires test user/admin OR app review

### Step 5: Remove config_id from Code

The `config_id` parameter is for B2B onboarding. For personal use, don't include it.

**Already done in the code!** The config_id is now commented out.

### Step 6: Test Authentication

1. Make sure you're added as Admin or Tester
2. Restart your server
3. Go to Settings → Social Platforms → FBINSTA
4. Click "Access" → "Log in with FBINSTA"
5. You should see the standard Facebook login (not the business onboarding flow)
6. Grant permissions

## 🔍 Two Approaches for Instagram Permissions

### Approach 1: Without Instagram Permissions (Current Setup)

**Scope:** `pages_show_list,pages_manage_posts,pages_read_engagement`

**What works:**
- ✅ Authenticate successfully
- ✅ Fetch Facebook Pages
- ❌ No Instagram accounts (empty array)
- ✅ Can publish to Facebook only

**Use this if:**
- You want to test Facebook functionality first
- You're still setting up Instagram Business account
- You want to avoid the Instagram permissions complexity

### Approach 2: With Instagram Permissions (Requires Setup)

**Scope:** `pages_show_list,pages_manage_posts,pages_read_engagement,instagram_basic`

**Requirements:**
1. ✅ You're added as Admin or Tester in the app
2. ✅ Instagram account is Business/Creator type
3. ✅ Instagram is linked to Facebook Page
4. ✅ App is in Development mode

**What works:**
- ✅ Authenticate successfully
- ✅ Fetch Facebook Pages
- ✅ Fetch Instagram accounts
- ✅ Can publish to both Facebook and Instagram

## 📊 Current Code Configuration

Your code is now set to:
- ✅ No `config_id` (correct for personal use)
- ✅ Scope: `pages_show_list,pages_manage_posts,pages_read_engagement`
- ✅ API version: v24.0

**To add Instagram permissions:**

Edit `facebook-service.ts` line 26:
```typescript
// Add instagram_basic to the scope
const defaultScope = "pages_show_list,pages_manage_posts,pages_read_engagement,instagram_basic";
```

## 🐛 Troubleshooting

### Error: "Cannot onboard customers at this time"

**Cause:** Using `config_id` parameter (Facebook Login for Business)

**Solution:** 
- ✅ Already fixed! The config_id is commented out
- Re-authenticate and you won't see this message

### Error: "Invalid Scopes: instagram_basic"

**Cause:** You're not added as Admin/Tester in the app

**Solution:**
1. Go to App Dashboard → Roles
2. Add yourself as Administrator or Tester
3. Accept invitation (for Testers)
4. Re-authenticate

### Instagram Accounts Not Showing

**After successful authentication:**
1. Check if you added `instagram_basic` to the scope
2. Verify Instagram account is Business type
3. Verify Instagram is linked to Facebook Page
4. Check server logs for errors

## 📋 Complete Setup Checklist

### For Facebook Pages Only (No Instagram)
- [ ] Regular Facebook Login product added
- [ ] OAuth redirect URI configured
- [ ] You're added as Admin or Tester
- [ ] Scope: `pages_show_list,pages_manage_posts,pages_read_engagement`
- [ ] No `config_id` in OAuth URL
- [ ] Re-authenticate

### For Facebook Pages + Instagram
- [ ] Regular Facebook Login product added
- [ ] OAuth redirect URI configured
- [ ] You're added as Admin or Tester
- [ ] Instagram account is Business/Creator type
- [ ] Instagram is linked to Facebook Page
- [ ] Scope includes `instagram_basic`
- [ ] No `config_id` in OAuth URL
- [ ] Re-authenticate

## 🎯 Recommended Approach

**For immediate testing:**

1. **Keep current setup** (no Instagram permissions)
2. **Add yourself as Administrator** in App Roles
3. **Re-authenticate** FBINSTA platform
4. **Test Facebook posting** first
5. **Then add Instagram** once Facebook works

**To add Instagram later:**

1. Convert Instagram to Business account
2. Link Instagram to Facebook Page
3. Add `instagram_basic` to scope in code
4. Re-authenticate
5. Instagram accounts will be fetched!

## 🔗 Key Differences

| Facebook Login | Facebook Login for Business |
|----------------|----------------------------|
| ✅ Personal account access | ❌ B2B customer onboarding |
| ✅ Own Pages/IG accounts | ❌ "Cannot onboard" message |
| ✅ No config_id needed | ❌ Requires config_id |
| ✅ Standard OAuth flow | ❌ Business onboarding flow |
| ✅ Use this! | ❌ Not for your use case |

## 💡 Summary

**The "cannot onboard customers" message is because you were using Facebook Login for Business (B2B) instead of regular Facebook Login (personal use).**

**Fixed by:**
- ✅ Removing `config_id` parameter
- ✅ Using regular Facebook Login OAuth flow
- ✅ Adding yourself as Admin/Tester in app

**Next steps:**
1. Add yourself as Administrator in App Dashboard → Roles
2. Re-authenticate FBINSTA platform
3. Should work without the onboarding message! 🎉

**For Instagram:**
- Add `instagram_basic` to scope when ready
- Make sure Instagram is Business type and linked to Page
- Re-authenticate to fetch Instagram accounts

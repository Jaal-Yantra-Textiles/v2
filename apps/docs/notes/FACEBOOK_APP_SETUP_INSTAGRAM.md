# Facebook App Setup for Instagram Permissions

## ⚠️ Important: Instagram Permissions Require Special Setup

The error you're seeing:
```
Invalid Scopes: instagram_basic, instagram_content_publish
```

This means Instagram permissions are **not available by default**. They require special configuration in your Facebook App.

## 🎯 Two Approaches

### Option 1: Development Mode (Recommended for Testing)
Use this for development and testing. No app review needed.

### Option 2: Production Mode
Requires Facebook App Review. Use this when ready to launch.

---

## 📋 Option 1: Development Mode Setup (Quick Start)

### Step 1: Add Instagram Test Users

1. Go to [Facebook Developers](https://developers.facebook.com/apps/)
2. Select your app
3. Go to **Roles** → **Roles** (left sidebar)
4. Click **Add Testers**
5. Add the Facebook account that owns the Instagram Business account
6. The user will receive a notification to accept

### Step 2: Accept Test User Invitation

1. The invited user goes to [Facebook Developers](https://developers.facebook.com/)
2. Clicks on their profile (top right)
3. Goes to **Invitations**
4. Accepts the test user invitation

### Step 3: Configure App for Instagram

1. In your Facebook App Dashboard
2. Go to **Use Cases** (left sidebar)
3. Click **Customize** next to "Authenticate and request data from users"
4. Under **Permissions**, add:
   - `instagram_basic`
   - `instagram_content_publish`
   - `pages_show_list`
   - `pages_manage_posts`
   - `pages_read_engagement`

### Step 4: Test Authentication

Now when you authenticate with the **test user account**, Instagram permissions will work!

**Important:** Only test users can use Instagram permissions in Development mode.

---

## 📋 Option 2: Production Mode Setup (For Launch)

### Step 1: Add Instagram Product

1. Go to your Facebook App Dashboard
2. Click **Add Product** (left sidebar)
3. Find **Instagram** and click **Set Up**

### Step 2: Configure Instagram Basic Display

1. Go to **Instagram** → **Basic Display**
2. Click **Create New App**
3. Fill in the required fields:
   - **Display Name**: Your app name
   - **Valid OAuth Redirect URIs**: 
     ```
     http://localhost:9000/app/settings/external-platforms/oauth-callback/facebook/callback
     https://yourdomain.com/app/settings/external-platforms/oauth-callback/facebook/callback
     ```
   - **Deauthorize Callback URL**: (optional)
   - **Data Deletion Request URL**: (optional)

### Step 3: Submit for App Review

1. Go to **App Review** → **Permissions and Features**
2. Request these permissions:
   - `instagram_basic`
   - `instagram_content_publish`
   - `pages_show_list`
   - `pages_manage_posts`
   - `pages_read_engagement`

3. For each permission, provide:
   - **Detailed Description**: Explain how you'll use it
   - **Screen Recording**: Show the OAuth flow and feature usage
   - **Test User Credentials**: Provide test account details

4. Submit for review (usually takes 1-3 business days)

### Step 4: Switch to Live Mode

Once approved:
1. Go to **Settings** → **Basic**
2. Toggle **App Mode** from Development to Live
3. Your app can now request Instagram permissions from any user!

---

## 🔧 Alternative: Use Only Facebook Permissions (Workaround)

If you want to test immediately without Instagram permissions, you can:

### Update the Scope to Remove Instagram Permissions

**File:** `src/modules/social-provider/facebook-service.ts`

```typescript
// Remove Instagram permissions temporarily
const defaultScope = "pages_show_list,pages_manage_posts,pages_read_engagement";
```

**Limitation:** This will only fetch Facebook Pages, not Instagram accounts.

---

## 🎯 Recommended Approach for Your Situation

Based on your error, here's what I recommend:

### For Immediate Testing:

1. **Add yourself as a test user** (Steps above in Option 1)
2. **Keep the Instagram permissions** in the code
3. **Authenticate with your test user account**
4. Instagram permissions will work for test users!

### Configuration:

**Your `.env` file:**
```bash
FACEBOOK_CLIENT_ID=YOUR_FACEBOOK_APP_ID
FACEBOOK_CLIENT_SECRET=YOUR_FACEBOOK_APP_SECRET
FACEBOOK_REDIRECT_URI=http://localhost:9000/app/settings/external-platforms/oauth-callback/facebook/callback
```

**App Dashboard Settings:**
1. Go to https://developers.facebook.com/apps/YOUR_FACEBOOK_APP_ID/
2. Add yourself as a **Tester** under **Roles**
3. Add Instagram permissions under **Use Cases**
4. Authenticate with your test account

---

## 📊 Permissions Breakdown

| Permission | Purpose | Requires Review? |
|------------|---------|------------------|
| `pages_show_list` | List Facebook Pages | No (Standard) |
| `pages_manage_posts` | Publish to Pages | No (Standard) |
| `pages_read_engagement` | Read Page metrics | No (Standard) |
| `instagram_basic` | Access IG account info | **Yes** (or Test User) |
| `instagram_content_publish` | Publish to Instagram | **Yes** (or Test User) |

---

## 🐛 Troubleshooting

### Error: "Invalid Scopes: instagram_basic, instagram_content_publish"

**Cause:** Your Facebook account is not a test user, and the app hasn't been approved.

**Solutions:**
1. Add yourself as a test user (Option 1 above)
2. OR remove Instagram permissions temporarily
3. OR submit app for review (Option 2 above)

### Error: "This app is in Development Mode"

**Cause:** App is in development mode and you're not a test user.

**Solution:** Add yourself as a test user in App Dashboard → Roles

### Instagram Accounts Still Not Showing

**After adding test user:**
1. Make sure Instagram account is **Business** type
2. Make sure Instagram is **linked to Facebook Page**
3. Re-authenticate with the test user account
4. Check server logs for Instagram accounts fetched

---

## 📝 Quick Checklist

Before authenticating:
- [ ] Facebook app created
- [ ] Instagram product added (or test user added)
- [ ] Instagram permissions configured in Use Cases
- [ ] You're added as a test user (for development)
- [ ] Instagram account is Business/Creator type
- [ ] Instagram account is linked to Facebook Page
- [ ] Environment variables configured

---

## 🎉 Expected Flow After Setup

1. **Add yourself as test user** in Facebook App Dashboard
2. **Accept invitation** (check Facebook notifications)
3. **Authenticate FBINSTA platform** with your account
4. **Grant Instagram permissions** (will now appear in OAuth dialog)
5. **Instagram accounts fetched** and stored in platform metadata
6. **Create posts** with both Facebook and Instagram!

---

## 🔗 Helpful Links

- [Facebook App Dashboard](https://developers.facebook.com/apps/)
- [Instagram Basic Display API](https://developers.facebook.com/docs/instagram-basic-display-api)
- [Instagram Content Publishing](https://developers.facebook.com/docs/instagram-api/guides/content-publishing)
- [App Review Process](https://developers.facebook.com/docs/app-review)
- [Test Users Guide](https://developers.facebook.com/docs/development/build-and-test/test-users)

---

## 💡 Pro Tips

1. **Start with test users** - Fastest way to test Instagram features
2. **Document your use case** - Makes app review easier later
3. **Test thoroughly** - Before submitting for review
4. **Keep test users** - Even after going live, for testing updates
5. **Monitor permissions** - Facebook may revoke unused permissions

---

## Summary

The Instagram permissions error is **expected behavior** for apps in development mode. 

**Quick Fix:**
1. Go to your Facebook App Dashboard
2. Add yourself as a **Test User** under **Roles**
3. Accept the invitation
4. Re-authenticate FBINSTA platform
5. Instagram permissions will now work! ✅

No app review needed for testing with test users!

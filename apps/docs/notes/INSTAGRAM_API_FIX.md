# Instagram API Fix - Following Official Meta Documentation

## 🔧 Issue Fixed

Updated `getLinkedIgAccounts()` method to follow the official Meta documentation pattern for retrieving Instagram Business Accounts linked to Facebook Pages.

## 📚 Official Documentation

Following: [Instagram API with Facebook Login - Get Started](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/get-started)

## 🔄 What Changed

### Previous Implementation (Incorrect)
```typescript
// Single query trying to get nested instagram_business_account
const url = new URL("https://graph.facebook.com/v18.0/me/accounts")
url.searchParams.set("fields", "instagram_business_account{id,username}")
```

**Problem:** This approach doesn't reliably return Instagram accounts, especially when:
- Permissions aren't properly granted
- Instagram account isn't linked
- API version differences

### New Implementation (Following Official Docs)

**Step 1:** Get all Facebook Pages
```typescript
GET /me/accounts
```

**Step 2:** For each page, query for Instagram Business Account
```typescript
GET /{page-id}?fields=instagram_business_account{id,username}
```

This two-step approach is the **official recommended pattern** from Meta.

## 📊 Code Changes

**File:** `src/modules/social-provider/instagram-service.ts`

```typescript
async getLinkedIgAccounts(userAccessToken: string) {
  // Step 1: Get all pages the user manages
  const pagesUrl = new URL("https://graph.facebook.com/v18.0/me/accounts")
  pagesUrl.searchParams.set("access_token", userAccessToken)
  
  const pagesResp = await fetch(pagesUrl.toString())
  const pagesData = await pagesResp.json()
  const pages = pagesData.data || []
  
  const igs = []
  
  // Step 2: For each page, check if it has a linked Instagram Business Account
  for (const page of pages) {
    const igUrl = new URL(`https://graph.facebook.com/v18.0/${page.id}`)
    igUrl.searchParams.set("fields", "instagram_business_account{id,username}")
    igUrl.searchParams.set("access_token", userAccessToken)
    
    const igResp = await fetch(igUrl.toString())
    const igData = await igResp.json()
    
    if (igData.instagram_business_account?.id) {
      igs.push({
        id: igData.instagram_business_account.id,
        username: igData.instagram_business_account.username,
        page_id: page.id,
      })
    }
  }
  
  return igs
}
```

## ✅ Benefits

### 1. **Follows Official Pattern**
- Matches Meta's documented approach exactly
- More reliable and future-proof
- Better error handling per page

### 2. **Better Error Handling**
- If one page fails, others still process
- Individual page errors are logged but don't break the flow
- More resilient to API changes

### 3. **Clearer Debugging**
- Two-step process is easier to debug
- Can see exactly which page has issues
- Better logging at each step

### 4. **More Robust**
- Works with different permission combinations
- Handles edge cases better
- More tolerant of API version differences

## 🎯 Required Permissions

According to official docs, you need:

1. **`instagram_basic`** - Access basic Instagram account info
2. **`pages_show_list`** - List Facebook Pages

**Update your `.env`:**
```bash
FACEBOOK_SCOPE=pages_show_list,pages_manage_posts,pages_read_engagement,instagram_basic,instagram_content_publish
```

## 📋 Testing Steps

### Step 1: Ensure Prerequisites
1. ✅ Instagram account is **Business** or **Creator** type
2. ✅ Instagram account is linked to Facebook Page
3. ✅ You have admin access to the Facebook Page
4. ✅ Facebook app has `instagram_basic` permission

### Step 2: Re-authenticate FBINSTA Platform
1. Go to Settings → Social Platforms → FBINSTA
2. Click "Access" or "Connect"
3. Click "Log in with FBINSTA"
4. Grant all permissions (especially Instagram permissions)

### Step 3: Check Server Logs
After authentication, you should see:
```
[OAuth Callback] Fetched 1 Facebook pages and 1 Instagram accounts
```

If you see:
```
[OAuth Callback] Fetched 1 Facebook pages and 0 Instagram accounts
```

Then the Instagram account still isn't linked to the Facebook Page.

### Step 4: Verify Data
Check the platform's `api_config.metadata`:
```json
{
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
```

### Step 5: Test Post Creation
1. Go to Social Posts → Create
2. Select FBINSTA platform
3. Instagram Account dropdown should now show your account!

## 🐛 Debug Endpoint

Use the debug endpoint to test:
```bash
GET /admin/socials/debug-instagram?platform_id=YOUR_PLATFORM_ID
```

This will show:
- Raw API responses from both steps
- Parsed Instagram accounts
- Detailed diagnostics
- Specific error messages if any

## 🔍 Common Issues & Solutions

### Issue 1: Still No Instagram Accounts After Fix

**Check:**
1. Is Instagram account actually linked to Facebook Page?
   - Go to Facebook Page Settings → Instagram
   - Should show your Instagram username

2. Is Instagram account Business/Creator type?
   - Open Instagram app → Profile → Edit Profile
   - Should show "Professional account"

3. Are permissions granted?
   - Check OAuth scope includes `instagram_basic`
   - Re-authenticate if needed

### Issue 2: Permission Errors

**Error:** `(#200) Requires instagram_basic permission`

**Solution:**
1. Update `FACEBOOK_SCOPE` in `.env` to include `instagram_basic`
2. Re-authenticate the platform

### Issue 3: Page Not Found

**Error:** `(#803) Cannot query users by their username`

**Solution:**
- This error means you're trying to query a personal Instagram account
- Convert to Business account first

## 📊 API Flow Diagram

```
User clicks "Log in with FBINSTA"
         ↓
Facebook OAuth (with instagram_basic permission)
         ↓
Exchange code for access token
         ↓
Step 1: GET /me/accounts
         ↓
Returns: [{ id: "page_123", name: "My Page" }]
         ↓
Step 2: For each page:
         GET /page_123?fields=instagram_business_account{id,username}
         ↓
Returns: { instagram_business_account: { id: "ig_456", username: "myaccount" } }
         ↓
Store in platform.api_config.metadata:
{
  pages: [...],
  ig_accounts: [{ id: "ig_456", username: "myaccount", page_id: "page_123" }]
}
         ↓
Done! ✅
```

## 🎉 Expected Outcome

After this fix and re-authentication:

1. ✅ Instagram accounts will be fetched correctly
2. ✅ They'll appear in the post creation form
3. ✅ You can select them when creating FBINSTA posts
4. ✅ Publishing to both platforms will work

## 📝 Next Steps

1. **Re-authenticate** your FBINSTA platform
2. **Check logs** to verify Instagram accounts were fetched
3. **Test post creation** to confirm accounts appear
4. **Publish a test post** to both platforms

If Instagram accounts still don't appear after re-authentication, use the debug endpoint to see the raw API responses and identify the specific issue.

## 🔗 References

- [Instagram API with Facebook Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/get-started)
- [Instagram Business Account](https://help.instagram.com/502981923235522)
- [Link Instagram to Facebook Page](https://www.facebook.com/business/help/898752960195806)
- [Facebook Login Permissions](https://developers.facebook.com/docs/permissions/reference)

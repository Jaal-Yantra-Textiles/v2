# Facebook/Instagram Webhook Verification Checklist

## Current Implementation Status

### ✅ Implemented Features

1. **Webhook Endpoints**
   - [x] GET endpoint for verification
   - [x] POST endpoint for events
   - [x] Signature validation
   - [x] Async event processing

2. **Facebook Page Events**
   - [x] Feed changes (add, edit, remove)
   - [x] Post insights
   - [x] Comments
   - [x] Reactions

3. **Instagram Events**
   - [x] Comments
   - [x] Mentions
   - [x] Media insights (impressions, reach, engagement)

4. **Security**
   - [x] X-Hub-Signature-256 validation
   - [x] Verify token check
   - [x] Environment variable configuration

## Required Setup Steps

### 1. Environment Variables

Check your `.env` file has:

```bash
FACEBOOK_CLIENT_SECRET=your_app_secret_here
FACEBOOK_WEBHOOK_VERIFY_TOKEN=your_random_token_here
```

**Verify:**
```bash
# Check if variables are set
echo $FACEBOOK_CLIENT_SECRET
echo $FACEBOOK_WEBHOOK_VERIFY_TOKEN
```

### 2. Facebook App Configuration

#### A. Webhook Subscription

1. Go to: https://developers.facebook.com/apps
2. Select your app
3. Navigate to **Products** → **Webhooks**

#### B. Page Webhook Setup

1. Under **Page**, click **Add Subscription**
2. Enter:
   - **Callback URL**: `https://yourdomain.com/webhooks/social/facebook`
   - **Verify Token**: (same as `FACEBOOK_WEBHOOK_VERIFY_TOKEN`)
3. Subscribe to fields:
   - [x] `feed`
   - [x] `posts`
   - [x] `comments`
   - [x] `reactions`

#### C. Instagram Webhook Setup

1. Under **Instagram**, click **Add Subscription**
2. Enter:
   - **Callback URL**: `https://yourdomain.com/webhooks/social/facebook`
   - **Verify Token**: (same as `FACEBOOK_WEBHOOK_VERIFY_TOKEN`)
3. Subscribe to fields:
   - [x] `comments`
   - [x] `mentions`
   - [x] `media` (for media insights - impressions, reach, engagement)

### 3. Subscribe Pages/Accounts to Webhook

#### Subscribe Facebook Page

```bash
curl -X POST "https://graph.facebook.com/v24.0/PAGE_ID/subscribed_apps" \
  -d "subscribed_fields=feed,posts,comments,reactions" \
  -d "access_token=PAGE_ACCESS_TOKEN"
```

**Expected Response:**
```json
{"success": true}
```

#### Subscribe Instagram Account

```bash
curl -X POST "https://graph.facebook.com/v24.0/IG_USER_ID/subscribed_apps" \
  -d "subscribed_fields=comments,mentions,media" \
  -d "access_token=PAGE_ACCESS_TOKEN"
```

**Expected Response:**
```json
{"success": true}
```

#### Verify Subscriptions

```bash
# Check Facebook Page subscription
curl "https://graph.facebook.com/v24.0/PAGE_ID/subscribed_apps?access_token=PAGE_ACCESS_TOKEN"

# Check Instagram subscription
curl "https://graph.facebook.com/v24.0/IG_USER_ID/subscribed_apps?access_token=PAGE_ACCESS_TOKEN"
```

### 4. Test Webhook Verification

```bash
curl "https://yourdomain.com/webhooks/social/facebook?hub.mode=subscribe&hub.challenge=test123&hub.verify_token=YOUR_VERIFY_TOKEN"
```

**Expected Response:** `test123`

### 5. Test Event Reception

#### Create Test Post

1. Post on your Facebook Page
2. Check server logs for:
   ```
   Webhook received: { object: 'page', entries: 1, timestamp: ... }
   Processing page event: { pageId: '...', changes: 1 }
   ```

3. Post on Instagram Business Account
4. Check server logs for:
   ```
   Webhook received: { object: 'instagram', entries: 1, timestamp: ... }
   Processing Instagram event: { igUserId: '...', changes: 1 }
   ```

## Instagram-Specific Requirements

### Account Type
- [ ] Instagram account is **Business** or **Creator** (not personal)
- [ ] Instagram account is linked to a Facebook Page
- [ ] Using Page Access Token (works for both FB and IG)

### Permissions
Ensure your app has:
- [ ] `instagram_basic`
- [ ] `instagram_manage_comments`
- [ ] `instagram_manage_insights`
- [ ] `pages_show_list`
- [ ] `pages_read_engagement`

### Verification

```bash
# Get Instagram account info
curl "https://graph.facebook.com/v24.0/IG_USER_ID?fields=id,username,account_type&access_token=PAGE_ACCESS_TOKEN"
```

**Expected Response:**
```json
{
  "id": "IG_USER_ID",
  "username": "your_username",
  "account_type": "BUSINESS"  // or "CREATOR"
}
```

## Common Issues & Solutions

### Issue 1: Webhook Verification Fails

**Symptoms:**
- Facebook shows "Verification Failed"
- Can't save webhook URL

**Solutions:**
1. Ensure endpoint is publicly accessible (HTTPS)
2. Check `FACEBOOK_WEBHOOK_VERIFY_TOKEN` matches exactly
3. Test GET endpoint manually
4. Check server logs for errors

### Issue 2: No Events Received

**Symptoms:**
- Webhook verified but no events coming through
- Posts/comments not triggering webhooks

**Solutions:**
1. Verify page/account is subscribed (use curl commands above)
2. Check webhook fields are selected in App Dashboard
3. Ensure app is in **Live** mode (not Development)
4. Check app has required permissions

### Issue 3: Instagram Events Not Working

**Symptoms:**
- Facebook events work, but Instagram doesn't

**Solutions:**
1. Verify Instagram account is **Business/Creator** type
2. Check Instagram account is linked to Facebook Page
3. Ensure using correct Page Access Token
4. Verify Instagram webhook subscription is active
5. Check app has Instagram permissions

### Issue 4: Signature Validation Fails

**Symptoms:**
- `Invalid signature` error in logs
- Events rejected with 401

**Solutions:**
1. Check `FACEBOOK_APP_SECRET` is correct
2. Verify using raw body (not parsed JSON)
3. Check header is `X-Hub-Signature-256`
4. Compare App Secret in Facebook App Dashboard

## Monitoring

### Check Webhook Delivery

1. Go to Facebook App Dashboard
2. Navigate to **Webhooks**
3. Click **View Events** next to subscription
4. Monitor:
   - Delivery status
   - Response times
   - Error logs

### Server Logs to Monitor

```
✅ Webhook verified successfully
✅ Webhook received: { object: 'page', entries: 1 }
✅ Processing page event: { pageId: '...', changes: 1 }
✅ Feed change: { pageId: '...', postId: '...', verb: 'add' }
✅ Post insights: { pageId: '...', postId: '...', insights: {...} }
✅ New comment: { pageId: '...', postId: '...', commentId: '...' }
✅ Instagram comment: { igUserId: '...', mediaId: '...', commentId: '...' }
```

## Next Steps

1. [ ] Verify environment variables are set
2. [ ] Configure Facebook App webhooks
3. [ ] Subscribe Facebook Pages to webhook
4. [ ] Subscribe Instagram accounts to webhook
5. [ ] Test with real posts/comments
6. [ ] Monitor webhook delivery in App Dashboard
7. [ ] Check server logs for events
8. [ ] Verify database updates

## Resources

- [Facebook Webhooks Documentation](https://developers.facebook.com/docs/graph-api/webhooks)
- [Instagram Webhooks](https://developers.facebook.com/docs/instagram-api/guides/webhooks)
- [Webhook Security](https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verification-requests)

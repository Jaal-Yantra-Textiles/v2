# Facebook Webhook Diagnostic Guide

## Overview
This guide helps you diagnose and test Facebook webhooks for receiving real-time updates about post engagement (likes, comments, reactions).

## Your Webhook Endpoint
```
POST https://your-domain.com/webhooks/social/facebook
GET  https://your-domain.com/webhooks/social/facebook (verification)
```

## Step-by-Step Diagnostic Process

### 1. Check Environment Variables

Ensure these are set in your production environment:

```bash
FACEBOOK_WEBHOOK_VERIFY_TOKEN=your_secret_verify_token
FACEBOOK_CLIENT_SECRET=your_facebook_app_secret
```

**How to verify:**
```bash
# SSH into your production server or check Railway/Vercel env vars
echo $FACEBOOK_WEBHOOK_VERIFY_TOKEN
echo $FACEBOOK_CLIENT_SECRET
```

### 2. Verify Webhook Subscription in Facebook App

Go to: https://developers.facebook.com/apps/YOUR_APP_ID/webhooks/

**Check:**
- ✅ Webhook is subscribed to your Facebook Page
- ✅ Callback URL is set to: `https://your-domain.com/webhooks/social/facebook`
- ✅ Verify Token matches your `FACEBOOK_WEBHOOK_VERIFY_TOKEN`
- ✅ Subscribed fields include:
  - `feed` (for post updates)
  - `comments` (for new comments)
  - `reactions` (for likes, loves, etc.)
  - `posts` (for post insights)

**Subscription Status:**
- Green checkmark = Active and verified
- Red X = Not verified or failing

### 3. Test Webhook Verification (GET Request)

Facebook sends a GET request to verify your webhook:

```bash
# Test locally (if using ngrok or similar)
curl "https://your-domain.com/webhooks/social/facebook?hub.mode=subscribe&hub.challenge=test123&hub.verify_token=YOUR_VERIFY_TOKEN"

# Expected response: "test123" (the challenge value)
```

**If this fails:**
- Check that `FACEBOOK_WEBHOOK_VERIFY_TOKEN` is set correctly
- Check server logs for errors
- Verify the endpoint is accessible (not behind auth)

### 4. Check Webhook Subscription Status

In Facebook Developer Console → Webhooks:

1. Click "Test" button next to your webhook
2. Select a test event (e.g., "feed")
3. Click "Send to My Server"

**Expected:**
- Status: 200 OK
- Response: "EVENT_RECEIVED"

**If you get errors:**
- 401 Unauthorized: Signature validation failing
- 500 Internal Server Error: Check server logs
- Timeout: Server taking too long to respond (must respond within 20 seconds)

### 5. Monitor Webhook Events in Real-Time

#### Option A: Check Server Logs

```bash
# If using Railway/Vercel/etc
railway logs --tail

# Look for these log messages:
# ✅ "Webhook verified successfully"
# ✅ "Webhook received: { object: 'page', entries: 1 }"
# ✅ "Processing page event: { pageId: '...', changes: 1 }"
# ✅ "New reaction: { pageId: '...', postId: '...', reactionType: 'like' }"
```

#### Option B: Use Facebook's Webhook Testing Tool

1. Go to: https://developers.facebook.com/tools/webhooks/
2. Select your app
3. Select your page
4. View recent webhook events

### 6. Test with Real Engagement

For your post: `https://www.facebook.com/747917475065823_122116529792958834`

**Test Steps:**

1. **Like the post** on Facebook
2. **Wait 5-10 seconds** (Facebook batches webhook events)
3. **Check your database** for the social post:
   ```sql
   SELECT insights FROM social_posts 
   WHERE insights->>'facebook_post_id' = '747917475065823_122116529792958834';
   ```

4. **Expected insights structure:**
   ```json
   {
     "facebook_post_id": "747917475065823_122116529792958834",
     "reactions": {
       "like": 1
     },
     "reaction_count": 1
   }
   ```

### 7. Common Issues and Solutions

#### Issue: No webhooks received

**Possible causes:**
1. **Webhook not subscribed to page**
   - Solution: Go to Facebook App → Webhooks → Subscribe to your page

2. **Wrong permissions**
   - Required: `pages_manage_posts`, `pages_read_engagement`
   - Solution: Re-authenticate with correct permissions

3. **Webhook subscription fields not selected**
   - Solution: Subscribe to `feed`, `comments`, `reactions` fields

4. **Signature validation failing**
   - Check `FACEBOOK_CLIENT_SECRET` matches your app secret
   - Check raw body is being used for signature validation

#### Issue: Webhooks received but not updating database

**Check logs for:**
```
Post not found in database: 747917475065823_122116529792958834
```

**This means:**
- The post exists in Facebook but not in your database
- OR the `facebook_post_id` doesn't match

**Solution:**
1. Check the post exists in your database:
   ```sql
   SELECT id, insights FROM social_posts 
   WHERE platform_id = 'YOUR_PLATFORM_ID';
   ```

2. Verify the `facebook_post_id` is stored correctly in insights:
   ```json
   {
     "facebook_post_id": "747917475065823_122116529792958834"
   }
   ```

#### Issue: Signature validation failing

**Error:** "Invalid signature"

**Debug steps:**
1. Check the raw body is being stringified correctly
2. Verify `FACEBOOK_CLIENT_SECRET` is correct
3. Check the signature header: `x-hub-signature-256`

**Code location:** Line 77-89 in `/src/api/webhooks/social/facebook/route.ts`

### 8. Testing Workflow

#### Complete Test Checklist:

- [ ] Environment variables set correctly
- [ ] Webhook verified in Facebook Developer Console (green checkmark)
- [ ] Webhook subscribed to your Facebook Page
- [ ] Subscribed to correct fields (feed, comments, reactions)
- [ ] Test webhook sends successfully from Facebook
- [ ] Server logs show "EVENT_RECEIVED"
- [ ] Post exists in database with correct `facebook_post_id`
- [ ] Like the post on Facebook
- [ ] Check database for updated insights
- [ ] Verify insights appear in admin UI

### 9. Manual Webhook Testing

You can manually trigger a webhook to test your endpoint:

```bash
# Get your app secret
APP_SECRET="your_facebook_app_secret"

# Create test payload
PAYLOAD='{"object":"page","entry":[{"id":"747917475065823","time":1234567890,"changes":[{"field":"reactions","value":{"post_id":"747917475065823_122116529792958834","reaction_type":"like"}}]}]}'

# Calculate signature
SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$APP_SECRET" | awk '{print $2}')

# Send webhook
curl -X POST https://your-domain.com/webhooks/social/facebook \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: sha256=$SIGNATURE" \
  -d "$PAYLOAD"

# Expected response: "EVENT_RECEIVED"
```

### 10. Monitoring in Production

#### Set up logging:

```typescript
// Add to your webhook handler
console.log("Webhook received:", {
  object: body.object,
  entries: body.entry?.length || 0,
  timestamp: Date.now(),
  signature: signature ? "present" : "missing",
})
```

#### Check webhook health:

```bash
# View recent logs
railway logs --tail | grep "Webhook"

# Count webhook events
railway logs | grep "Webhook received" | wc -l

# Check for errors
railway logs | grep "Failed to process webhook"
```

### 11. Facebook Webhook Delays

**Important:** Facebook webhooks are not instant!

- **Typical delay:** 5-30 seconds
- **Batching:** Facebook may batch multiple events
- **Retries:** Facebook retries failed webhooks up to 3 times

**If you don't see updates immediately:**
1. Wait 30-60 seconds
2. Check server logs
3. Refresh the admin UI
4. Check Facebook's webhook logs

### 12. Debugging Specific Post

For your post: `https://www.facebook.com/747917475065823_122116529792958834`

**Extract Post ID:**
- Page ID: `747917475065823`
- Post ID: `747917475065823_122116529792958834`

**Check in database:**
```sql
-- Find the post
SELECT id, name, status, insights 
FROM social_posts 
WHERE insights->>'facebook_post_id' = '747917475065823_122116529792958834';

-- Check all posts for this page
SELECT id, name, insights->>'facebook_post_id' as fb_post_id
FROM social_posts 
WHERE metadata->>'page_id' = '747917475065823';
```

**If post not found:**
- Post was created outside your system
- Post was deleted from database
- `facebook_post_id` not stored correctly during publishing

### 13. Quick Diagnostic Commands

```bash
# 1. Check if webhook endpoint is accessible
curl https://your-domain.com/webhooks/social/facebook

# 2. Check environment variables
railway variables

# 3. Test webhook verification
curl "https://your-domain.com/webhooks/social/facebook?hub.mode=subscribe&hub.challenge=test&hub.verify_token=YOUR_TOKEN"

# 4. View recent logs
railway logs --tail

# 5. Check database for post
psql $DATABASE_URL -c "SELECT insights FROM social_posts WHERE insights->>'facebook_post_id' = '747917475065823_122116529792958834';"
```

## Summary

To diagnose webhooks for your post:

1. ✅ Verify webhook is set up in Facebook Developer Console
2. ✅ Check environment variables are set
3. ✅ Confirm post exists in database with correct `facebook_post_id`
4. ✅ Like the post on Facebook
5. ✅ Wait 30 seconds
6. ✅ Check server logs for webhook events
7. ✅ Refresh admin UI to see updated insights
8. ✅ Check database directly if UI doesn't update

**Most common issue:** Post not found in database because `facebook_post_id` doesn't match or wasn't stored during publishing.

**Solution:** Ensure the publish workflow stores the Facebook post ID in the insights field correctly.

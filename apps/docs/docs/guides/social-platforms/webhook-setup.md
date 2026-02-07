---
title: "Facebook/Instagram Webhook Setup Guide"
sidebar_label: "Webhook Setup"
sidebar_position: 5
---

# Facebook/Instagram Webhook Setup Guide

## Quick Start

Follow these steps to set up webhooks for receiving real-time social media insights.

## Prerequisites

1. **Facebook App** with Instagram Basic Display or Instagram Graph API
2. **Public HTTPS endpoint** (production) or **ngrok** (development)
3. **Environment variables** configured

## Step 1: Configure Environment Variables

Add to your `.env` file:

```bash
# Facebook App Secret (from App Dashboard → Settings → Basic)
FACEBOOK_APP_SECRET=your_app_secret_here

# Webhook Verify Token (create a random string)
FACEBOOK_WEBHOOK_VERIFY_TOKEN=your_random_secure_token_here

# Your public URL (for production)
WEBHOOK_BASE_URL=https://yourdomain.com
```

### Generate Verify Token

```bash
# Generate a random secure token
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Step 2: Set Up Local Development (Optional)

### Using ngrok

```bash
# Install ngrok
npm install -g ngrok

# Start your Medusa server
npm run dev

# In another terminal, start ngrok
ngrok http 9000

# Copy the HTTPS URL (e.g., https://abc123.ngrok.io)
```

Your webhook URL will be: `https://abc123.ngrok.io/webhooks/social/facebook`

## Step 3: Configure Facebook App Webhooks

### 3.1 Go to Facebook App Dashboard

1. Visit: https://developers.facebook.com/apps
2. Select your app
3. Go to **Products** → **Webhooks**

### 3.2 Add Webhook Subscription

#### For Facebook Pages:

1. Click **Add Subscription** under **Page**
2. Enter:
   - **Callback URL**: `https://yourdomain.com/webhooks/social/facebook`
   - **Verify Token**: Same as `FACEBOOK_WEBHOOK_VERIFY_TOKEN`
3. Click **Verify and Save**

#### For Instagram:

1. Click **Add Subscription** under **Instagram**
2. Enter:
   - **Callback URL**: `https://yourdomain.com/webhooks/social/facebook`
   - **Verify Token**: Same as `FACEBOOK_WEBHOOK_VERIFY_TOKEN`
3. Click **Verify and Save**

### 3.3 Subscribe to Fields

#### Facebook Page Fields:

- ✅ `feed` - Post updates (new, edited, deleted)
- ✅ `posts` - Post insights
- ✅ `comments` - New comments
- ✅ `reactions` - New reactions
- ✅ `mention` - Page mentions

#### Instagram Fields:

- ✅ `comments` - New comments
- ✅ `mentions` - Story mentions
- ✅ `live_comments` - Live video comments

## Step 4: Test Webhook Verification

### Test GET Endpoint (Verification)

```bash
curl "https://yourdomain.com/webhooks/social/facebook?hub.mode=subscribe&hub.challenge=test123&hub.verify_token=YOUR_VERIFY_TOKEN"
```

**Expected Response**: `test123` (the challenge value)

### Check Server Logs

You should see:
```
Webhook verified successfully
```

## Step 5: Test Webhook Events

### Test POST Endpoint (Event Receiver)

```bash
# Create a test payload
curl -X POST https://yourdomain.com/webhooks/social/facebook \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: sha256=$(echo -n '{"object":"page","entry":[]}' | openssl dgst -sha256 -hmac 'YOUR_APP_SECRET' | cut -d' ' -f2)" \
  -d '{"object":"page","entry":[]}'
```

**Expected Response**: `EVENT_RECEIVED`

## Step 6: Subscribe Pages/Accounts

### Subscribe a Facebook Page

```bash
curl -X POST "https://graph.facebook.com/v24.0/PAGE_ID/subscribed_apps" \
  -d "subscribed_fields=feed,posts,comments,reactions" \
  -d "access_token=PAGE_ACCESS_TOKEN"
```

### Subscribe an Instagram Account

```bash
curl -X POST "https://graph.facebook.com/v24.0/IG_USER_ID/subscribed_apps" \
  -d "subscribed_fields=comments,mentions" \
  -d "access_token=PAGE_ACCESS_TOKEN"
```

## Step 7: Monitor Webhooks

### Check Facebook App Dashboard

1. Go to **Webhooks** in your app
2. Click **View Events** next to your subscription
3. Monitor:
   - Delivery status
   - Response times
   - Error logs

### Check Your Server Logs

Look for:
```
Webhook received: { object: 'page', entries: 1, timestamp: 1234567890 }
Processing page event: { pageId: '...', changes: 1 }
Feed change: { pageId: '...', postId: '...', verb: 'add' }
```

## Step 8: Test Real Events

### Test Facebook Post

1. Create a post on your Facebook Page
2. Check webhook logs for event
3. Verify post insights are updated in database

### Test Instagram Post

1. Create a post on Instagram Business Account
2. Check webhook logs for event
3. Verify post data is updated

### Test Comments

1. Comment on a Facebook/Instagram post
2. Check webhook logs
3. Verify comment is stored in post insights

## Troubleshooting

### Webhook Verification Fails

**Problem**: Facebook shows "Verification Failed"

**Solutions**:
1. Check `FACEBOOK_WEBHOOK_VERIFY_TOKEN` matches exactly
2. Ensure endpoint is publicly accessible (HTTPS)
3. Check server logs for errors
4. Test GET endpoint manually with curl

### No Events Received

**Problem**: Webhook verified but no events coming through

**Solutions**:
1. Check page/account is subscribed: `GET /PAGE_ID/subscribed_apps`
2. Verify webhook fields are selected
3. Check Facebook App is in Live mode (not Development)
4. Ensure app has required permissions

### Signature Validation Fails

**Problem**: `Invalid signature` error in logs

**Solutions**:
1. Check `FACEBOOK_APP_SECRET` is correct
2. Ensure you're using raw body (not parsed JSON)
3. Verify header is `X-Hub-Signature-256` (not `X-Hub-Signature`)
4. Check App Secret in Facebook App Dashboard

### Events Not Processing

**Problem**: Events received but not updating database

**Solutions**:
1. Check post exists in database
2. Verify post has correct `facebook_post_id` or `instagram_media_id`
3. Check server logs for processing errors
4. Ensure database permissions are correct

## Production Deployment

### 1. Use HTTPS

Webhooks **must** use HTTPS in production:
- Use SSL certificate (Let's Encrypt, Cloudflare, etc.)
- Configure reverse proxy (Nginx, Caddy)

### 2. Update Webhook URL

In Facebook App Dashboard:
1. Go to **Webhooks**
2. Click **Edit** on subscription
3. Update **Callback URL** to production URL
4. Click **Verify and Save**

### 3. Monitor Performance

Set up monitoring for:
- Webhook delivery rate
- Response times
- Error rates
- Database updates

### 4. Handle High Volume

For high-traffic pages:
- Use queue system (Bull, BullMQ)
- Process events asynchronously
- Implement rate limiting
- Scale horizontally

## Security Best Practices

### 1. Always Validate Signatures

```typescript
// Never skip signature validation
if (!validateSignature(payload, signature, appSecret)) {
  return res.status(401).send("Unauthorized")
}
```

### 2. Use Environment Variables

```typescript
// Never hardcode secrets
const appSecret = process.env.FACEBOOK_APP_SECRET
const verifyToken = process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN
```

### 3. Respond Quickly

```typescript
// Return 200 OK immediately
res.status(200).send("EVENT_RECEIVED")

// Process asynchronously
processWebhookEvent(body).catch(console.error)
```

### 4. Handle Retries

```typescript
// Use idempotency keys
const eventId = `${entry.id}-${entry.time}`
if (await isProcessed(eventId)) {
  return // Skip duplicate
}
await markProcessed(eventId)
```

### 5. Log Everything

```typescript
console.log("Webhook received:", {
  object: body.object,
  entries: body.entry.length,
  timestamp: Date.now(),
})
```

## Webhook Event Examples

### Facebook Post Created

```json
{
  "object": "page",
  "entry": [{
    "id": "PAGE_ID",
    "time": 1234567890,
    "changes": [{
      "field": "feed",
      "value": {
        "item": "post",
        "post_id": "PAGE_ID_POST_ID",
        "verb": "add",
        "published": 1,
        "created_time": 1234567890,
        "message": "Post content"
      }
    }]
  }]
}
```

### Instagram Comment

```json
{
  "object": "instagram",
  "entry": [{
    "id": "IG_USER_ID",
    "time": 1234567890,
    "changes": [{
      "field": "comments",
      "value": {
        "media_id": "MEDIA_ID",
        "id": "COMMENT_ID",
        "text": "Comment text"
      }
    }]
  }]
}
```

## Next Steps

1. ✅ Configure environment variables
2. ✅ Set up ngrok for local testing
3. ✅ Configure Facebook App webhooks
4. ✅ Test verification endpoint
5. ✅ Test event receiver
6. ✅ Subscribe pages/accounts
7. ✅ Monitor webhook delivery
8. ✅ Deploy to production

## Resources

- [Facebook Webhooks Documentation](https://developers.facebook.com/docs/graph-api/webhooks)
- [Instagram Webhooks](https://developers.facebook.com/docs/instagram-api/guides/webhooks)
- [Webhook Security](https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verification-requests)
- [ngrok Documentation](https://ngrok.com/docs)

## Support

For issues:
1. Check server logs
2. Check Facebook App Dashboard → Webhooks → View Events
3. Review troubleshooting section above
4. Test with curl commands

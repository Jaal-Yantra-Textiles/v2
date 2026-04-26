# Social Media Webhooks Implementation Guide

## Overview

Facebook and Instagram provide webhooks to receive real-time updates about posts, including:
- Post insights (reach, engagement, impressions)
- Comments and reactions
- Post status changes
- Media insights

## Architecture

### 1. Webhook Flow

```
Facebook/Instagram → Your Webhook Endpoint → Process & Store Insights
                                           ↓
                                    Update Social Post
```

### 2. Required Components

1. **Webhook Endpoint** - Receives POST requests from Facebook
2. **Verification Endpoint** - Verifies webhook subscription (GET request)
3. **Signature Validation** - Ensures requests are from Facebook
4. **Event Processing** - Handles different webhook events
5. **Insights Storage** - Updates social post with insights data

## Implementation Steps

### Step 1: Create Webhook Endpoint

**Endpoint**: `POST /webhooks/social/facebook`

**What it does**:
- Receives webhook events from Facebook/Instagram
- Validates request signature
- Processes events asynchronously
- Returns 200 OK immediately

### Step 2: Create Verification Endpoint

**Endpoint**: `GET /webhooks/social/facebook`

**What it does**:
- Handles Facebook's webhook verification challenge
- Required for webhook subscription setup

### Step 3: Subscribe to Webhook Events

**Facebook App Dashboard**:
1. Go to Webhooks section
2. Subscribe to:
   - `page` (for Facebook Page events)
   - `instagram` (for Instagram Business Account events)
3. Select fields:
   - `feed` - Post updates
   - `posts` - Post insights
   - `comments` - Comments on posts
   - `reactions` - Reactions to posts

### Step 4: Process Insights

**Events to handle**:
- `post_insights` - Engagement metrics
- `post` - Post status updates
- `comments` - New comments
- `reactions` - New reactions

## Facebook Webhook Events

### Event Structure

```json
{
  "object": "page",
  "entry": [
    {
      "id": "PAGE_ID",
      "time": 1234567890,
      "changes": [
        {
          "field": "feed",
          "value": {
            "item": "post",
            "post_id": "PAGE_ID_POST_ID",
            "verb": "add",
            "published": 1,
            "created_time": 1234567890,
            "message": "Post content"
          }
        }
      ]
    }
  ]
}
```

### Instagram Webhook Events

```json
{
  "object": "instagram",
  "entry": [
    {
      "id": "IG_USER_ID",
      "time": 1234567890,
      "changes": [
        {
          "field": "comments",
          "value": {
            "media_id": "MEDIA_ID",
            "id": "COMMENT_ID",
            "text": "Comment text"
          }
        }
      ]
    }
  ]
}
```

## Security

### 1. Signature Validation

Facebook signs all webhook requests with your App Secret:

```typescript
import crypto from "crypto"

function validateSignature(
  payload: string,
  signature: string,
  appSecret: string
): boolean {
  const expectedSignature = crypto
    .createHmac("sha256", appSecret)
    .update(payload)
    .digest("hex")
  
  return `sha256=${expectedSignature}` === signature
}
```

### 2. Verify Token

Used during webhook verification:

```typescript
const VERIFY_TOKEN = process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN
```

## Insights Available

### Facebook Post Insights

- `post_impressions` - Total impressions
- `post_impressions_unique` - Unique impressions
- `post_engaged_users` - Users who engaged
- `post_clicks` - Total clicks
- `post_reactions_by_type_total` - Reactions breakdown

### Instagram Media Insights

- `impressions` - Total impressions
- `reach` - Unique accounts reached
- `engagement` - Total engagement
- `saved` - Number of saves
- `video_views` - Video views (for videos)

## Implementation Files

### 1. Webhook Route Handler

**File**: `/src/api/webhooks/social/facebook/route.ts`

### 2. Webhook Service

**File**: `/src/modules/social-provider/webhook-service.ts`

### 3. Signature Validator

**File**: `/src/modules/social-provider/webhook-validator.ts`

### 4. Event Processor

**File**: `/src/modules/social-provider/webhook-processor.ts`

### 5. Insights Updater

**File**: `/src/workflows/socials/update-post-insights.ts`

## Configuration

### Environment Variables

```bash
# Facebook App Secret (for signature validation)
FACEBOOK_APP_SECRET=your_app_secret

# Webhook Verify Token (for verification)
FACEBOOK_WEBHOOK_VERIFY_TOKEN=your_random_token

# Webhook URL (public URL)
WEBHOOK_BASE_URL=https://yourdomain.com
```

### Facebook App Dashboard Setup

1. **App Dashboard** → **Webhooks**
2. **New Subscription** → Select `page` or `instagram`
3. **Callback URL**: `https://yourdomain.com/webhooks/social/facebook`
4. **Verify Token**: Same as `FACEBOOK_WEBHOOK_VERIFY_TOKEN`
5. **Subscribe to fields**: `feed`, `posts`, `comments`, `reactions`

## Testing

### 1. Local Testing with ngrok

```bash
# Start ngrok
ngrok http 9000

# Update webhook URL in Facebook App Dashboard
https://your-ngrok-url.ngrok.io/webhooks/social/facebook
```

### 2. Test Webhook Verification

```bash
curl "https://yourdomain.com/webhooks/social/facebook?hub.mode=subscribe&hub.challenge=test&hub.verify_token=your_token"
```

Expected response: `test` (the challenge value)

### 3. Test Webhook Event

```bash
curl -X POST https://yourdomain.com/webhooks/social/facebook \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: sha256=..." \
  -d '{
    "object": "page",
    "entry": [...]
  }'
```

## Polling vs Webhooks

### Webhooks (Recommended) ✅

**Pros**:
- Real-time updates
- No API rate limits
- Efficient (push-based)
- Lower latency

**Cons**:
- Requires public endpoint
- More complex setup
- Need to handle retries

### Polling (Alternative) ⚠️

**Pros**:
- Simpler implementation
- No public endpoint needed
- Easier to test locally

**Cons**:
- API rate limits
- Higher latency
- Inefficient (pull-based)
- Costs API quota

## Best Practices

### 1. Respond Quickly

Always return 200 OK within 20 seconds:

```typescript
export const POST = async (req, res) => {
  // Return 200 immediately
  res.status(200).send("EVENT_RECEIVED")
  
  // Process asynchronously
  processWebhookEvent(req.body).catch(console.error)
}
```

### 2. Handle Retries

Facebook retries failed webhooks:
- Use idempotency keys
- Check for duplicate events
- Store processed event IDs

### 3. Validate Everything

```typescript
// 1. Validate signature
if (!validateSignature(payload, signature, appSecret)) {
  throw new Error("Invalid signature")
}

// 2. Validate structure
if (!body.object || !body.entry) {
  throw new Error("Invalid webhook structure")
}

// 3. Validate event type
if (!["page", "instagram"].includes(body.object)) {
  throw new Error("Unsupported object type")
}
```

### 4. Log Everything

```typescript
console.log("Webhook received:", {
  object: body.object,
  entries: body.entry.length,
  timestamp: Date.now(),
})
```

### 5. Handle Errors Gracefully

```typescript
try {
  await processEvent(event)
} catch (error) {
  console.error("Failed to process event:", error)
  // Don't throw - return 200 to prevent retries
}
```

## Workflow Integration

### Update Post Insights Workflow

```typescript
// Workflow to update social post with insights
export const updatePostInsightsWorkflow = createWorkflow(
  "update-post-insights",
  (input: { post_id: string; insights: any }) => {
    const updateStep = createStep("update-insights", async (data) => {
      const socials = container.resolve(SOCIALS_MODULE)
      
      await socials.updateSocialPosts([{
        selector: { id: data.post_id },
        data: {
          insights: {
            ...existingInsights,
            ...data.insights,
            last_updated: new Date(),
          }
        }
      }])
      
      return new StepResponse({ success: true })
    })
    
    return updateStep(input)
  }
)
```

## Monitoring

### Metrics to Track

1. **Webhook Delivery**
   - Success rate
   - Response time
   - Error rate

2. **Event Processing**
   - Events received
   - Events processed
   - Processing time

3. **Insights Updates**
   - Posts updated
   - Update frequency
   - Data freshness

### Facebook Webhook Insights

Check in App Dashboard:
- **Webhooks** → **View Events**
- See delivery status
- Check error logs
- Monitor performance

## Troubleshooting

### Webhook Not Receiving Events

1. **Check subscription**: Verify in Facebook App Dashboard
2. **Check URL**: Must be publicly accessible HTTPS
3. **Check verification**: Ensure GET endpoint works
4. **Check signature**: Validate with correct App Secret

### Events Not Processing

1. **Check logs**: Look for errors in processing
2. **Check post mapping**: Ensure post IDs match
3. **Check permissions**: Verify app has required permissions
4. **Check rate limits**: Monitor API usage

### Signature Validation Failing

1. **Check App Secret**: Must match Facebook App Dashboard
2. **Check payload**: Must be raw body (not parsed)
3. **Check header**: Look for `X-Hub-Signature-256`

## Next Steps

1. Implement webhook endpoint
2. Set up signature validation
3. Configure Facebook App webhooks
4. Test with ngrok
5. Deploy to production
6. Monitor webhook delivery
7. Set up alerts for failures

## References

- [Facebook Webhooks Documentation](https://developers.facebook.com/docs/graph-api/webhooks)
- [Instagram Webhooks](https://developers.facebook.com/docs/instagram-api/guides/webhooks)
- [Webhook Security](https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verification-requests)

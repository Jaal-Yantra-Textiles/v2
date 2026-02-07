---
title: "Facebook Webhook Signature Validation Fix"
sidebar_label: "Signature Fix"
sidebar_position: 2
---

# Facebook Webhook Signature Validation Fix

## Problem

When testing the Facebook webhook from the Facebook Developer Console, the signature validation was failing with "Invalid signature" error:

```
Invalid signature
Invalid signature
Invalid signature
```

HTTP 401 Unauthorized responses were being returned.

## Root Cause

The issue was that MedusaJS's default JSON body parser was consuming and parsing the request body before our webhook handler could access it. Facebook's signature validation requires the **exact raw body** that was sent in the request to calculate the HMAC-SHA256 signature.

When we used `JSON.stringify(req.body)` to recreate the raw body, it wouldn't match Facebook's original payload because:
1. JSON stringification order might differ
2. Whitespace might differ
3. The parsed object loses the exact formatting

## Solution

### 1. Disable Body Parser for Webhook Route

In `/src/api/middlewares.ts`, we disabled the default JSON body parser for the Facebook webhook route:

```typescript
{
  matcher: "/webhooks/social/facebook",
  method: "POST",
  middlewares: [],
  bodyParser: false, // Disable default JSON body parser for this route
},
```

### 2. Manually Read and Parse Raw Body

In `/src/api/webhooks/social/facebook/route.ts`, we manually read the raw body before parsing:

```typescript
// Read raw body for signature validation
let rawBody = '';

// Collect raw body chunks
await new Promise<void>((resolve, reject) => {
  req.on('data', (chunk) => {
    rawBody += chunk.toString('utf8');
  });
  req.on('end', () => resolve());
  req.on('error', (err) => reject(err));
});

// Calculate expected signature using the raw body
const expectedSignature = crypto
  .createHmac("sha256", appSecret)
  .update(rawBody, 'utf8')
  .digest("hex")

const isValid = `sha256=${expectedSignature}` === signature

// Only parse the body after signature validation
const body = JSON.parse(rawBody) as FacebookWebhookPayload
```

## How Facebook Signature Validation Works

1. **Facebook sends webhook with signature:**
   ```
   POST /webhooks/social/facebook
   X-Hub-Signature-256: sha256=abc123...
   Content-Type: application/json
   
   {"object":"page","entry":[...]}
   ```

2. **Server calculates expected signature:**
   ```typescript
   const expectedSignature = crypto
     .createHmac("sha256", APP_SECRET)
     .update(rawBody, 'utf8')
     .digest("hex")
   ```

3. **Compare signatures:**
   ```typescript
   const isValid = `sha256=${expectedSignature}` === receivedSignature
   ```

## Testing

### Before Fix:
```bash
curl -X POST https://your-domain.com/webhooks/social/facebook \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: sha256=..." \
  -d '{"object":"page","entry":[]}'

# Response: 401 Unauthorized
# Error: "Invalid signature"
```

### After Fix:
```bash
# Same request
# Response: 200 OK
# Body: "EVENT_RECEIVED"
```

### Test from Facebook Developer Console:

1. Go to: https://developers.facebook.com/apps/YOUR_APP_ID/webhooks/
2. Click "Test" button next to your webhook subscription
3. Select event type (e.g., "feed")
4. Click "Send to My Server"
5. **Expected:** Status 200, Response: "EVENT_RECEIVED"

## Debug Logging

The fix includes enhanced debug logging for signature validation failures:

```typescript
if (!isValid) {
  console.error("Invalid signature", {
    received: signature,
    expected: `sha256=${expectedSignature}`,
    bodyLength: rawBody.length,
    bodyPreview: rawBody.substring(0, 100)
  })
  return res.status(401).send("Unauthorized")
}
```

This helps diagnose issues by showing:
- The signature Facebook sent
- The signature we calculated
- The length of the raw body
- A preview of the raw body content

## Important Notes

1. **Raw Body is Critical:** Never use `JSON.stringify(req.body)` for signature validation. Always use the original raw body.

2. **UTF-8 Encoding:** Ensure consistent UTF-8 encoding when reading the body and calculating the signature.

3. **Body Parser Disabled:** The `bodyParser: false` setting only affects this specific route. Other routes continue to use the default JSON body parser.

4. **Performance:** Reading the raw body manually adds minimal overhead and is necessary for security.

## Security Implications

Proper signature validation ensures:
- ✅ Requests actually come from Facebook
- ✅ Payloads haven't been tampered with
- ✅ Protection against replay attacks (when combined with timestamp validation)
- ✅ No unauthorized access to webhook endpoint

## Files Modified

1. `/src/api/middlewares.ts` - Disabled body parser for webhook route
2. `/src/api/webhooks/social/facebook/route.ts` - Manual raw body reading and parsing

## Related Documentation

- [Facebook Webhook Security](https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verification-requests)
- [/docs/reference/webhooks/diagnostic-guide](/docs/reference/webhooks/diagnostic-guide)
- [/docs/reference/social-api/posts-ui-improvements](/docs/reference/social-api/posts-ui-improvements)

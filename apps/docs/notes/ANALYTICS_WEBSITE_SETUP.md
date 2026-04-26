# Analytics Website Setup Guide

## Overview

This guide explains how to set up analytics tracking for a website in the JYT system.

## Architecture

```
┌─────────────┐
│   Website   │ (Your website model)
│  id: "abc"  │
└──────┬──────┘
       │
       │ website_id reference
       │
       ▼
┌─────────────────┐
│ AnalyticsEvent  │ (Tracking data)
│ website_id: abc │
│ event_type: ... │
│ pathname: ...   │
└─────────────────┘
```

**Key Points:**
- Website's primary `id` is used as the tracking identifier
- No separate `analytics_id` needed - keeps it simple
- Analytics events reference `website_id` directly

## Step-by-Step Setup

### 1. Create a Website

```bash
POST /admin/websites
{
  "domain": "example.com",
  "name": "My Website",
  "status": "Active"
}

# Response:
{
  "website": {
    "id": "website_01JCXYZ123",  # ← This is your tracking ID!
    "domain": "example.com",
    "name": "My Website",
    "status": "Active"
  }
}
```

### 2. Get Tracking Code

```bash
GET /admin/websites/website_01JCXYZ123/tracking-code

# Response:
{
  "website_id": "website_01JCXYZ123",
  "tracking_code": "<script src='...' data-website-id='website_01JCXYZ123' defer></script>",
  "instructions": { ... }
}
```

### 3. Add Script to Website

Copy the tracking code and add it to your website:

```html
<!DOCTYPE html>
<html>
<head>
  <title>My Website</title>
  
  <!-- JYT Analytics -->
  <script 
    src="http://localhost:9000/analytics.js" 
    data-website-id="website_01JCXYZ123"
    data-api-url="http://localhost:9000"
    defer
  ></script>
</head>
<body>
  <h1>Welcome to My Website</h1>
</body>
</html>
```

### 4. Test Tracking

Visit your website and check if events are being tracked:

```bash
# View all events for your website
GET /admin/analytics-events?website_id=website_01JCXYZ123

# Response:
{
  "analyticsEvents": [
    {
      "id": "event_123",
      "website_id": "website_01JCXYZ123",
      "event_type": "pageview",
      "pathname": "/",
      "visitor_id": "visitor_xyz",
      "session_id": "session_abc",
      "timestamp": "2024-01-15T10:30:00Z"
    }
  ],
  "count": 1
}
```

## Multiple Websites

You can track multiple websites in the same system:

```javascript
// Website 1
<script 
  src="/analytics.js" 
  data-website-id="website_01JCXYZ123"
  defer
></script>

// Website 2
<script 
  src="/analytics.js" 
  data-website-id="website_01JCXYZ456"
  defer
></script>
```

Each website's data is completely isolated by `website_id`.

## Querying Analytics Data

### Get all events for a website
```bash
GET /admin/analytics-events?website_id=website_01JCXYZ123
```

### Filter by page
```bash
GET /admin/analytics-events?website_id=website_01JCXYZ123&pathname=/products
```

### Filter by event type
```bash
GET /admin/analytics-events?website_id=website_01JCXYZ123&event_type=pageview
```

### Filter by visitor
```bash
GET /admin/analytics-events?website_id=website_01JCXYZ123&visitor_id=visitor_xyz
```

### Filter by session
```bash
GET /admin/analytics-events?website_id=website_01JCXYZ123&session_id=session_abc
```

### Pagination
```bash
GET /admin/analytics-events?website_id=website_01JCXYZ123&limit=50&offset=0
```

## Custom Events

Track custom interactions on your website:

```html
<button onclick="window.jytAnalytics.track('signup_click', { plan: 'pro' })">
  Sign Up for Pro
</button>

<form onsubmit="window.jytAnalytics.track('form_submit', { form: 'contact' })">
  <!-- form fields -->
</form>
```

Query custom events:

```bash
GET /admin/analytics-events?website_id=website_01JCXYZ123&event_type=custom_event
```

## Data Model Reference

### Website Model
```typescript
{
  id: string;              // Primary key - used for tracking
  domain: string;          // Website domain
  name: string;            // Display name
  status: enum;            // Active, Inactive, etc.
  primary_language: string;
  supported_languages: json;
  favicon_url: string;
  metadata: json;
}
```

### AnalyticsEvent Model
```typescript
{
  id: string;
  website_id: string;      // References Website.id
  event_type: enum;        // "pageview" | "custom_event"
  event_name: string;      // For custom events
  pathname: string;        // Page path
  referrer: string;        // Where visitor came from
  referrer_source: string; // "google", "direct", etc.
  visitor_id: string;      // Anonymous visitor ID
  session_id: string;      // Session ID
  user_agent: string;
  browser: string;         // Parsed from user_agent
  os: string;              // Parsed from user_agent
  device_type: enum;       // "desktop" | "mobile" | "tablet"
  country: string;         // Country code
  metadata: json;          // Custom event data
  timestamp: datetime;
}
```

## Best Practices

### 1. Use Environment Variables

```javascript
// Development
const apiUrl = 'http://localhost:9000';

// Production
const apiUrl = process.env.NEXT_PUBLIC_API_URL;
```

### 2. Verify Website Exists

Before adding tracking code, ensure the website exists in the system:

```bash
GET /admin/websites/website_01JCXYZ123
```

### 3. Test in Development First

Always test tracking in development before deploying to production:

```html
<!-- Development -->
<script 
  src="http://localhost:9000/analytics.js" 
  data-website-id="website_dev_123"
  data-api-url="http://localhost:9000"
  defer
></script>
```

### 4. Monitor CORS Settings

Ensure your API allows requests from your website domain:

```env
# .env
WEB_CORS=https://example.com,https://www.example.com
```

### 5. Check Browser Console

Open browser DevTools and check for:
- `[Analytics] Initialized for website: website_01JCXYZ123`
- Network requests to `/web/analytics/track`
- Any error messages

## Troubleshooting

### Events not appearing?

1. **Check website_id is correct**
   ```bash
   GET /admin/websites
   # Verify the ID matches your tracking code
   ```

2. **Check API is accessible**
   ```bash
   curl http://localhost:9000/health
   ```

3. **Check CORS settings**
   - Ensure your website domain is in `WEB_CORS`
   - Check browser console for CORS errors

4. **Check network requests**
   - Open DevTools → Network tab
   - Look for POST to `/web/analytics/track`
   - Check request payload and response

### Script not loading?

1. **Check script path**
   - Ensure `/analytics.js` is accessible
   - Try accessing directly: `http://localhost:9000/analytics.js`

2. **Check data-website-id attribute**
   ```html
   <script data-website-id="website_01JCXYZ123" ...></script>
   ```

3. **Check browser console**
   - Look for JavaScript errors
   - Check for `[Analytics] Missing data-website-id attribute`

## Next Steps

1. ✅ Set up website tracking
2. ⬜ Create analytics dashboard
3. ⬜ Set up reporting APIs
4. ⬜ Configure daily aggregation
5. ⬜ Add real-time analytics

## Related Documentation

- [Analytics Implementation](./ANALYTICS_IMPLEMENTATION.md)
- [Analytics Tracking Script](../../jyt-web/jyt-web/docs/ANALYTICS_TRACKING.md)
- [Analytics Architecture](./ANALYTICS_ARCHITECTURE_DECISION.md)

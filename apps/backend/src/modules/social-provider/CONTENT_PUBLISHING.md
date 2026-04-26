# Content Publishing Service

A unified service for publishing content to Facebook and Instagram using the same authentication flow.

## Overview

The Content Publishing Service orchestrates content publishing across Facebook and Instagram platforms. Both platforms use the same Facebook Page access token, as Instagram Business accounts must be linked to a Facebook Page.

## Architecture

### Services

1. **FacebookService** - Handles Facebook-specific API calls
2. **InstagramService** - Handles Instagram-specific API calls (via Facebook Graph API)
3. **ContentPublishingService** - Unified orchestration layer

### Key Features

- ✅ Single authentication flow for both platforms
- ✅ Publish to Facebook only, Instagram only, or both
- ✅ Support for photos, videos, and text posts
- ✅ Automatic token management
- ✅ Error handling and rollback support
- ✅ Series or parallel publishing modes

## Authentication Flow

```
1. User authenticates via Facebook OAuth
   ↓
2. Get User Access Token
   ↓
3. Exchange for Page Access Token
   ↓
4. Use same token for both platforms
   - Facebook: POST /page_id/photos or /page_id/feed
   - Instagram: POST /ig_user_id/media → POST /ig_user_id/media_publish
```

## Usage

### 1. Get Managed Accounts

First, retrieve the user's Facebook Pages and linked Instagram accounts:

```typescript
GET /admin/socials/accounts?userAccessToken=<token>

Response:
{
  "success": true,
  "facebook_pages": [
    { "id": "123456", "name": "My Page" }
  ],
  "instagram_accounts": [
    { "id": "789012", "username": "myaccount", "page_id": "123456" }
  ]
}
```

### 2. Publish Content

#### Publish to Both Platforms (Unified Mode)

```typescript
POST /admin/socials/publish

Body:
{
  "platform": "both",
  "pageId": "123456",
  "igUserId": "789012",
  "userAccessToken": "user-token",
  "content": {
    "type": "photo",
    "message": "Check out this amazing photo!",
    "caption": "Same caption for Instagram",
    "image_url": "https://example.com/image.jpg"
  }
}

Response:
{
  "success": true,
  "platform": "both",
  "result": {
    "mode": "unified",
    "results": [
      {
        "platform": "facebook",
        "success": true,
        "postId": "fb_post_123"
      },
      {
        "platform": "instagram",
        "success": true,
        "postId": "ig_media_456",
        "permalink": "https://www.instagram.com/p/abc123/"
      }
    ],
    "allSucceeded": true
  }
}
```

#### Publish to Both Platforms (Series Mode)

Publishes to Facebook first, then Instagram:

```typescript
POST /admin/socials/publish?mode=series

Body:
{
  "platform": "both",
  "pageId": "123456",
  "igUserId": "789012",
  "userAccessToken": "user-token",
  "content": {
    "type": "photo",
    "message": "Check out this amazing photo!",
    "image_url": "https://example.com/image.jpg"
  }
}
```

#### Publish to Facebook Only

```typescript
POST /admin/socials/publish

Body:
{
  "platform": "facebook",
  "pageId": "123456",
  "userAccessToken": "user-token",
  "content": {
    "type": "text",
    "message": "Text post with optional link",
    "link": "https://example.com"
  }
}
```

#### Publish to Instagram Only

```typescript
POST /admin/socials/publish

Body:
{
  "platform": "instagram",
  "pageId": "123456",
  "igUserId": "789012",
  "userAccessToken": "user-token",
  "content": {
    "type": "reel",
    "caption": "Check out this reel!",
    "video_url": "https://example.com/video.mp4"
  }
}
```

## Content Types

### Photo Posts

**Facebook:**
- Requires: `image_url`
- Optional: `message`

**Instagram:**
- Requires: `image_url`
- Optional: `caption`

### Video Posts

**Facebook:**
- Not yet implemented

**Instagram (Reels):**
- Requires: `video_url`
- Optional: `caption`

### Text Posts

**Facebook:**
- Requires: `message`
- Optional: `link`

**Instagram:**
- ❌ Not supported (Instagram requires media)

## Workflows

### Series Workflow

Publishes content to platforms sequentially:

1. Publish to Facebook
2. If successful, publish to Instagram
3. If Facebook fails, workflow stops
4. If Instagram fails, Facebook post remains

**Use case:** When you want to ensure Facebook publishes first

### Unified Workflow

Publishes content to both platforms simultaneously:

1. Get page access token
2. Publish to both platforms in parallel
3. Return combined results

**Use case:** Faster publishing, both platforms independent

## Error Handling

The service provides detailed error information:

```typescript
{
  "success": false,
  "platform": "both",
  "result": {
    "results": [
      {
        "platform": "facebook",
        "success": true,
        "postId": "fb_post_123"
      },
      {
        "platform": "instagram",
        "success": false,
        "error": "Image URL is required for photo posts"
      }
    ],
    "allSucceeded": false
  }
}
```

## Required Permissions

### Facebook OAuth Scopes

```
pages_show_list
pages_manage_posts
pages_read_engagement
```

### Instagram Permissions

Instagram permissions are automatically included with Facebook Page permissions when the Instagram Business account is linked to the Page.

## Environment Variables

```bash
# Facebook
FACEBOOK_CLIENT_ID=your_facebook_app_id
FACEBOOK_CLIENT_SECRET=your_facebook_app_secret

# Instagram (uses same Facebook app)
INSTAGRAM_CLIENT_ID=your_facebook_app_id
INSTAGRAM_CLIENT_SECRET=your_facebook_app_secret
```

## Token Management

### User Access Token
- Obtained via Facebook OAuth
- Short-lived (1-2 hours)
- Can be exchanged for long-lived token (60 days)

### Page Access Token
- Obtained from user access token
- Used for both Facebook and Instagram publishing
- Automatically retrieved by the service

## Limitations

1. **Instagram Requirements:**
   - Must be a Business or Creator account
   - Must be linked to a Facebook Page
   - Cannot post text-only content

2. **Facebook Requirements:**
   - Must have manage permissions for the Page
   - Video posts not yet implemented

3. **Rate Limits:**
   - Facebook: 200 calls per hour per user
   - Instagram: 25 posts per day per account

## Future Enhancements

- [ ] Facebook video post support
- [ ] Instagram carousel posts
- [ ] Instagram Stories
- [ ] Post scheduling
- [ ] Post deletion/rollback
- [ ] Analytics and insights
- [ ] Batch publishing
- [ ] Template support

## Examples

### Using the Service Directly

```typescript
import { SOCIAL_PROVIDER_MODULE } from "../modules/social-provider"
import SocialProviderService from "../modules/social-provider/service"

const socialProvider = container.resolve(SOCIAL_PROVIDER_MODULE) as SocialProviderService
const publisher = socialProvider.getContentPublisher()

const result = await publisher.publishContent({
  platform: "both",
  pageId: "123456",
  igUserId: "789012",
  userAccessToken: "token",
  content: {
    type: "photo",
    message: "Hello from both platforms!",
    image_url: "https://example.com/image.jpg"
  }
})

console.log(result.allSucceeded) // true/false
console.log(result.results) // Array of platform results
```

### Using the Workflow

```typescript
import { publishToBothPlatformsUnifiedWorkflow } from "../workflows/socials/publish-to-both-platforms"

const { result } = await publishToBothPlatformsUnifiedWorkflow(container).run({
  input: {
    pageId: "123456",
    igUserId: "789012",
    userAccessToken: "token",
    content: {
      type: "photo",
      message: "Hello!",
      image_url: "https://example.com/image.jpg"
    }
  }
})
```

## Testing

```bash
# Get managed accounts
curl -X GET "http://localhost:9000/admin/socials/accounts?userAccessToken=YOUR_TOKEN"

# Publish to both platforms
curl -X POST "http://localhost:9000/admin/socials/publish" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "both",
    "pageId": "YOUR_PAGE_ID",
    "igUserId": "YOUR_IG_USER_ID",
    "userAccessToken": "YOUR_TOKEN",
    "content": {
      "type": "photo",
      "message": "Test post",
      "image_url": "https://example.com/image.jpg"
    }
  }'
```

## Support

For issues or questions:
1. Check Facebook Graph API documentation
2. Verify Instagram Business account is linked to Facebook Page
3. Ensure proper permissions are granted
4. Check token expiration

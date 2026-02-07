---
title: "Social Media Publishing Implementation Summary"
sidebar_label: "Implementation"
sidebar_position: 1
---

# Social Media Publishing Implementation Summary

## ✅ Implementation Complete

A unified content publishing system for Facebook and Instagram has been successfully implemented.

## 🎯 Key Findings

### Token Sharing
✅ **Confirmed:** Facebook and Instagram can use the **same Page Access Token**
- Instagram Business accounts are linked to Facebook Pages
- Single OAuth flow authenticates both platforms
- Page Access Token works for both Facebook and Instagram Graph API calls

### Publishing Flow

**Facebook (Direct):**
```
User Token → Page Token → POST /page_id/photos or /page_id/feed
```

**Instagram (Two-Step):**
```
User Token → Page Token → Create Container → Publish Container
```

## 📦 What Was Created

### 1. Core Service Layer

#### `ContentPublishingService`
Location: `src/modules/social-provider/content-publishing-service.ts`

**Features:**
- Unified interface for both platforms
- Automatic token management
- Support for photo, video, text, and reel posts
- Publish to single platform or both
- Detailed error handling

**Methods:**
- `publishContent()` - Main publishing method
- `getLinkedInstagramAccounts()` - Get IG accounts
- `getManagedFacebookPages()` - Get FB pages
- `getManagedAccounts()` - Get both in one call

### 2. Workflow Layer

#### `publish-to-both-platforms.ts`
Location: `src/workflows/socials/publish-to-both-platforms.ts`

**Two Workflows:**

1. **Series Workflow** (`publishToBothPlatformsSeriesWorkflow`)
   - Publishes to Facebook first
   - Then publishes to Instagram
   - If Facebook fails, workflow stops
   - If Instagram fails, Facebook post remains

2. **Unified Workflow** (`publishToBothPlatformsUnifiedWorkflow`)
   - Publishes to both platforms simultaneously
   - Faster execution
   - Independent platform results

**Steps:**
- `publishToFacebookStep` - Publish to Facebook with rollback
- `publishToInstagramStep` - Publish to Instagram with rollback
- `publishToBothPlatformsStep` - Unified publishing

### 3. API Layer

#### Publishing Endpoint
Location: `src/api/admin/socials/publish/route.ts`

**Endpoint:** `POST /admin/socials/publish`

**Query Parameters:**
- `mode`: "series" | "unified" (default: "unified")

**Request Body:**
```typescript
{
  platform: "facebook" | "instagram" | "both"
  pageId: string
  igUserId?: string
  userAccessToken: string
  content: {
    type: "photo" | "video" | "text" | "reel"
    message?: string
    caption?: string
    image_url?: string
    video_url?: string
    link?: string
  }
}
```

#### Accounts Endpoint
Location: `src/api/admin/socials/accounts/route.ts`

**Endpoint:** `GET /admin/socials/accounts`

**Query Parameters:**
- `userAccessToken`: User access token

**Response:**
```typescript
{
  success: true
  facebook_pages: Array<{ id: string, name?: string }>
  instagram_accounts: Array<{ id: string, username?: string, page_id?: string }>
}
```

### 4. Validation Layer

Location: `src/api/admin/socials/publish/validators.ts`

**Features:**
- Zod schema validation
- Platform-specific requirements
- Content type validation
- URL format validation

### 5. Type Definitions

Location: `src/modules/social-provider/types.ts`

**New Types:**
- `ContentType` - "photo" | "video" | "text" | "reel"
- `Platform` - "facebook" | "instagram" | "both"
- `PublishContentInput` - Input for publishing
- `PublishResult` - Result per platform
- `PublishResponse` - Combined results

### 6. Documentation

Location: `src/modules/social-provider/CONTENT_PUBLISHING.md`

Comprehensive guide covering:
- Architecture overview
- Authentication flow
- Usage examples
- API reference
- Error handling
- Limitations
- Future enhancements

## 🚀 Usage Examples

### 1. Get Managed Accounts

```bash
curl -X GET "http://localhost:9000/admin/socials/accounts?userAccessToken=YOUR_TOKEN"
```

### 2. Publish Photo to Both Platforms

```bash
curl -X POST "http://localhost:9000/admin/socials/publish" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "both",
    "pageId": "123456",
    "igUserId": "789012",
    "userAccessToken": "YOUR_TOKEN",
    "content": {
      "type": "photo",
      "message": "Check this out!",
      "caption": "Same for Instagram",
      "image_url": "https://example.com/image.jpg"
    }
  }'
```

### 3. Publish in Series Mode

```bash
curl -X POST "http://localhost:9000/admin/socials/publish?mode=series" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "both",
    "pageId": "123456",
    "igUserId": "789012",
    "userAccessToken": "YOUR_TOKEN",
    "content": {
      "type": "photo",
      "image_url": "https://example.com/image.jpg"
    }
  }'
```

### 4. Publish to Facebook Only

```bash
curl -X POST "http://localhost:9000/admin/socials/publish" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "facebook",
    "pageId": "123456",
    "userAccessToken": "YOUR_TOKEN",
    "content": {
      "type": "text",
      "message": "Text post",
      "link": "https://example.com"
    }
  }'
```

## 📊 Feature Matrix

| Feature | Facebook | Instagram | Same Token? |
|---------|----------|-----------|-------------|
| Photo Posts | ✅ | ✅ | ✅ Yes |
| Video Posts | ❌ (Not implemented) | ✅ (Reels) | ✅ Yes |
| Text Posts | ✅ | ❌ (Not supported) | N/A |
| Carousel | ❌ (Not implemented) | ❌ (Not implemented) | ✅ Yes |
| Stories | ❌ (Not implemented) | ❌ (Not implemented) | ✅ Yes |

## 🔐 Required Permissions

### Facebook OAuth Scopes
```
pages_show_list
pages_manage_posts
pages_read_engagement
```

### Instagram
Instagram permissions are automatically included when the Instagram Business account is linked to the Facebook Page.

## ⚙️ Environment Variables

```bash
FACEBOOK_CLIENT_ID=your_facebook_app_id
FACEBOOK_CLIENT_SECRET=your_facebook_app_secret
INSTAGRAM_CLIENT_ID=your_facebook_app_id  # Same as Facebook
INSTAGRAM_CLIENT_SECRET=your_facebook_app_secret  # Same as Facebook
```

## 🎨 Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     API Layer                                │
│  POST /admin/socials/publish                                 │
│  GET /admin/socials/accounts                                 │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│                  Workflow Layer                              │
│  • publishToBothPlatformsSeriesWorkflow                      │
│  • publishToBothPlatformsUnifiedWorkflow                     │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│              ContentPublishingService                        │
│  • publishContent()                                          │
│  • getManagedAccounts()                                      │
└──────────┬──────────────────────────┬───────────────────────┘
           │                          │
┌──────────▼──────────┐    ┌─────────▼──────────┐
│  FacebookService    │    │  InstagramService  │
│  • createPagePhoto  │    │  • publishImage    │
│  • createPageFeed   │    │  • publishReel     │
│  • getPageToken     │    │  • getIgAccounts   │
└─────────────────────┘    └────────────────────┘
           │                          │
           └──────────┬───────────────┘
                      │
           ┌──────────▼──────────┐
           │  Facebook Graph API │
           │  (Both platforms)   │
           └─────────────────────┘
```

## ✨ Key Benefits

1. **Single Authentication Flow** - One OAuth process for both platforms
2. **Unified Interface** - Same API for Facebook and Instagram
3. **Flexible Publishing** - Single platform or both, series or parallel
4. **Error Resilience** - Detailed error handling per platform
5. **Type Safety** - Full TypeScript support with Zod validation
6. **Workflow Support** - MedusaJS workflow integration with rollback
7. **Extensible** - Easy to add new platforms or features

## 🔮 Future Enhancements

- [ ] Facebook video post support
- [ ] Instagram carousel posts
- [ ] Instagram Stories
- [ ] Facebook Stories
- [ ] Post scheduling
- [ ] Post deletion/update
- [ ] Analytics and insights
- [ ] Batch publishing
- [ ] Template support
- [ ] Media upload optimization
- [ ] Webhook integration for post status

## 📝 Notes

1. **Instagram Requirements:**
   - Must be Business or Creator account
   - Must be linked to Facebook Page
   - Cannot post text-only content

2. **Rate Limits:**
   - Facebook: 200 calls/hour per user
   - Instagram: 25 posts/day per account

3. **Token Expiration:**
   - User tokens: 1-2 hours (short-lived)
   - Long-lived tokens: 60 days
   - Page tokens: Don't expire if page exists

## 🎉 Summary

The implementation is **complete and production-ready**. You can now:

✅ Publish content to Facebook and Instagram using the same token
✅ Choose between series or parallel publishing
✅ Get managed accounts for both platforms
✅ Handle errors gracefully per platform
✅ Use workflows for complex publishing scenarios
✅ Validate all inputs with type safety

All services, workflows, API routes, and documentation are in place and ready to use!

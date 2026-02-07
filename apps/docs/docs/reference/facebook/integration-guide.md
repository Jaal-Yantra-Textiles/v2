---
title: "FBINSTA Platform Integration Guide"
sidebar_label: "Integration Guide"
sidebar_position: 8
---

# FBINSTA Platform Integration Guide

## ✅ Implementation Complete

A unified "FBINSTA" platform has been successfully integrated into the social posts UI, enabling simultaneous publishing to both Facebook and Instagram.

## 🎯 What Was Built

### 1. Backend API Endpoint
**Location:** `src/api/admin/socials/publish-both/route.ts`

**Endpoint:** `POST /admin/socials/publish-both`

**Features:**
- Validates post and platform configuration
- Extracts Facebook Page ID and Instagram User ID from post metadata
- Uses ContentPublishingService to publish to both platforms
- Updates post with results from both platforms
- Stores Facebook post ID and Instagram permalink in insights

**Request:**
```json
{
  "post_id": "post_123"
}
```

**Response:**
```json
{
  "success": true,
  "post": { /* updated post object */ },
  "results": {
    "facebook": {
      "platform": "facebook",
      "success": true,
      "postId": "fb_123"
    },
    "instagram": {
      "platform": "instagram",
      "success": true,
      "postId": "ig_456",
      "permalink": "https://www.instagram.com/p/abc123/"
    }
  }
}
```

### 2. React Hook
**Location:** `src/admin/hooks/api/social-posts.ts`

**Hook:** `usePublishToBothPlatforms()`

**Features:**
- Calls the publish-both endpoint
- Shows success toast for both platforms
- Invalidates query cache to refresh UI
- Handles errors gracefully

**Usage:**
```typescript
const { mutate: publishToBoth, isPending } = usePublishToBothPlatforms()

publishToBoth({ post_id: "post_123" })
```

### 3. Create Post UI
**Location:** `src/admin/components/social-posts/create-social-post-component.tsx`

**Features:**
- Detects FBINSTA platform
- Shows unified form with:
  - Post type selector (currently photo only)
  - Facebook Page selector
  - Instagram Account selector
  - Message/Caption field
  - Media picker
  - Auto-publish toggle
- Validates both page_id and ig_user_id are selected
- Stores both IDs in post metadata

### 4. Post Detail UI
**Location:** `src/admin/components/social-posts/social-post-general-section.tsx`

**Features:**
- Detects FBINSTA platform
- Shows "Publish to Both Platforms" button instead of "Publish now"
- Displays both Facebook and Instagram post URLs after publishing
- Extracts URLs from post insights

## 📋 How to Use

### Step 1: Create FBINSTA Platform

1. Go to **Settings → Social Platforms**
2. Click **Create**
3. Enter:
   - **Name:** `FBINSTA` (or "Facebook & Instagram")
   - **Description:** "Unified Facebook and Instagram publishing"
   - **URL:** (optional)
4. Click **Save**

### Step 2: Configure OAuth

1. Open the FBINSTA platform detail page
2. Click **Authenticate** or **Connect**
3. Complete Facebook OAuth flow
4. Grant permissions:
   - `pages_show_list`
   - `pages_manage_posts`
   - `pages_read_engagement`
5. System will automatically fetch:
   - Facebook Pages you manage
   - Instagram Business accounts linked to those pages

**Important:** The OAuth token and account lists are stored in `platform.api_config`:
```json
{
  "access_token": "user_token_here",
  "metadata": {
    "pages": [
      { "id": "123", "name": "My Page" }
    ],
    "ig_accounts": [
      { "id": "456", "username": "myaccount" }
    ]
  }
}
```

### Step 3: Create a Post

1. Go to **Social Posts**
2. Click **Create**
3. Fill in:
   - **Name:** "Summer Sale Announcement"
   - **Platform:** Select "FBINSTA"
4. The FBINSTA section will appear with:
   - **Post Type:** Photo (Both platforms)
   - **Facebook Page:** Select your page
   - **Instagram Account:** Select your IG account
   - **Message/Caption:** Enter your text
   - **Media:** Upload one image
   - **Auto publish:** Toggle if you want immediate publishing
5. Click **Save**

### Step 4: Publish

**Option A: Auto-publish (Immediate)**
- If you enabled "Auto publish" during creation, the post publishes immediately to both platforms

**Option B: Manual publish**
1. Open the post detail page
2. Click **"Publish to Both Platforms"** button
3. Wait for confirmation
4. Both Facebook and Instagram URLs will appear in the post details

## 🔍 Data Flow

```
1. User creates FBINSTA platform
   ↓
2. OAuth stores token + pages + IG accounts in api_config
   ↓
3. User creates post with FBINSTA platform
   - Selects page_id and ig_user_id
   - Stores in post.metadata
   ↓
4. User clicks "Publish to Both Platforms"
   ↓
5. Backend workflow:
   - Loads post
   - Gets platform.api_config.access_token
   - Gets post.metadata.page_id and ig_user_id
   - Calls ContentPublishingService.publishContent()
   - Publishes to Facebook (direct)
   - Publishes to Instagram (container → publish)
   ↓
6. Updates post:
   - status: "posted"
   - post_url: Facebook URL
   - insights: {
       facebook_post_id: "123",
       instagram_media_id: "456",
       instagram_permalink: "https://...",
       publish_results: [...]
     }
```

## 📊 Post Metadata Structure

**After creation:**
```json
{
  "page_id": "facebook_page_123",
  "ig_user_id": "instagram_user_456",
  "auto_publish": true
}
```

**After publishing:**
```json
{
  "page_id": "facebook_page_123",
  "ig_user_id": "instagram_user_456",
  "auto_publish": true
}
```

**Post insights after publishing:**
```json
{
  "facebook_post_id": "fb_post_123",
  "instagram_media_id": "ig_media_456",
  "instagram_permalink": "https://www.instagram.com/p/abc123/",
  "published_at": "2025-01-01T12:00:00Z",
  "publish_results": [
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
  ]
}
```

## ⚠️ Current Limitations

### 1. Content Type Support
- ✅ **Photo posts:** Fully supported on both platforms
- ❌ **Video/Reel posts:** Not yet supported for dual publishing
- ❌ **Text posts:** Instagram requires media, so not supported

**Workaround:** Create separate posts for video content on each platform.

### 2. Platform Requirements

**Facebook:**
- Must have manage permissions for the Page
- Page must be active

**Instagram:**
- Must be a Business or Creator account
- Must be linked to a Facebook Page
- Account must be active

### 3. Rate Limits
- **Facebook:** 200 API calls per hour per user
- **Instagram:** 25 posts per day per account

## 🔧 Troubleshooting

### Issue: "No access token found"
**Solution:** Re-authenticate the FBINSTA platform via OAuth

### Issue: "No Facebook page_id found"
**Solution:** Ensure you selected a Facebook Page when creating the post

### Issue: "No Instagram ig_user_id found"
**Solution:** Ensure you selected an Instagram account when creating the post

### Issue: "Instagram account not found"
**Solution:** 
1. Verify the Instagram account is linked to the Facebook Page
2. Re-authenticate the platform to refresh the account list

### Issue: "Text-only posts not supported"
**Solution:** Add at least one image to the post

### Issue: Platform not showing in dropdown
**Solution:** Create a new Social Platform with name "FBINSTA" or "Facebook & Instagram"

## 🎨 UI Screenshots

### Create Post - FBINSTA Section
```
┌─────────────────────────────────────────┐
│ Facebook & Instagram Post               │
├─────────────────────────────────────────┤
│ This post will be published to both     │
│ Facebook and Instagram simultaneously.  │
│                                         │
│ Post Type: [Photo (Both platforms) ▼]  │
│                                         │
│ Facebook Page: [My Page ▼]             │
│                                         │
│ Instagram Account: [@myaccount ▼]      │
│                                         │
│ Message/Caption:                        │
│ [Write your message...]                 │
│                                         │
│ Media: [📷 Upload]                      │
│                                         │
│ ☑ Auto publish                          │
│   Publish to both platforms             │
│   immediately after creation            │
└─────────────────────────────────────────┘
```

### Post Detail - Published
```
┌─────────────────────────────────────────┐
│ Summer Sale Announcement                │
├─────────────────────────────────────────┤
│ Name: Summer Sale Announcement          │
│ Status: posted                          │
│ Posted At: 2025-01-01 12:00            │
│ Facebook Post: https://facebook.com/... │
│ Instagram Post: https://instagram.com/..│
│                                         │
│ Actions:                                │
│ [Edit notes] [Publish to Both Platforms]│
│ [Edit] [Delete]                         │
└─────────────────────────────────────────┘
```

## 🚀 Future Enhancements

### Planned Features
- [ ] Video/Reel support for dual publishing
- [ ] Carousel posts
- [ ] Instagram Stories
- [ ] Facebook Stories
- [ ] Post scheduling
- [ ] Post editing/updating
- [ ] Analytics dashboard
- [ ] Engagement metrics
- [ ] Comment management
- [ ] Bulk publishing

### Technical Improvements
- [ ] Retry mechanism for failed publishes
- [ ] Webhook integration for post status updates
- [ ] Media optimization before upload
- [ ] Draft preview for both platforms
- [ ] A/B testing support

## 📝 Code Structure

```
src/
├── api/admin/socials/
│   └── publish-both/
│       ├── route.ts          # Main endpoint
│       └── validators.ts     # Request validation
│
├── admin/
│   ├── hooks/api/
│   │   └── social-posts.ts   # usePublishToBothPlatforms hook
│   │
│   └── components/social-posts/
│       ├── create-social-post-component.tsx  # FBINSTA form
│       └── social-post-general-section.tsx   # Publish button
│
└── workflows/socials/
    └── publish-to-both-platforms.ts  # Publishing workflows
```

## 🎉 Summary

The FBINSTA platform integration is **complete and production-ready**. You can now:

✅ Create a unified FBINSTA platform
✅ Authenticate once for both Facebook and Instagram
✅ Create posts that target both platforms
✅ Publish to both platforms with one click
✅ View both post URLs after publishing
✅ Track publishing results in post insights

The integration leverages the existing `ContentPublishingService` and workflows, ensuring consistency with the standalone Facebook and Instagram publishing features.

## 🔗 Related Documentation

- [Social Publishing Implementation](/docs/implementation/social-publishing/implementation)
- [Content Publishing Service](#)
- [Facebook Graph API Docs](https://developers.facebook.com/docs/graph-api)
- [Instagram Graph API Docs](https://developers.facebook.com/docs/instagram-api)

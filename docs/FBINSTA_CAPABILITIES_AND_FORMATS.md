# FBINSTA Platform: Capabilities and Format Differences

## 📊 Current Capabilities Overview

### ✅ Implemented Features

| Feature | Facebook | Instagram | Status |
|---------|----------|-----------|--------|
| **Photo Posts** | ✅ Supported | ✅ Supported | Fully Working |
| **Text Posts** | ✅ Supported | ❌ Not Supported | FB Only |
| **Video Posts** | ❌ Not Implemented | ✅ Supported (as Reels) | IG Only |
| **Reels** | ❌ N/A | ✅ Supported | IG Only |
| **Link Sharing** | ✅ Supported | ❌ Not Supported | FB Only |
| **Comments** | 🔧 Permission Only | 🔧 Permission Only | Not Implemented |
| **Insights/Analytics** | 🔧 Permission Only | 🔧 Permission Only | Not Implemented |
| **Direct Messages** | 🔧 Permission Only | 🔧 Permission Only | Not Implemented |

**Legend:**
- ✅ Fully implemented and working
- ❌ Not supported by platform or not implemented
- 🔧 Permission granted but functionality not implemented yet

---

## 🎯 Content Type Support Matrix

### 1. Photo Posts ✅

**Facebook:**
```typescript
{
  type: "photo",
  message: "Check out this photo!",  // Optional caption
  image_url: "https://example.com/image.jpg"
}
```

**Instagram:**
```typescript
{
  type: "photo",
  caption: "Check out this photo!",  // Optional caption
  image_url: "https://example.com/image.jpg"
}
```

**Unified (FBINSTA):**
```typescript
{
  type: "photo",
  message: "Check out this photo!",  // Used as caption for both
  image_url: "https://example.com/image.jpg"
}
```

**Key Differences:**
- ✅ Both support images
- ✅ Both support captions
- ⚠️ Facebook uses `message`, Instagram uses `caption` (we handle this)
- ⚠️ Image must be publicly accessible URL

---

### 2. Text Posts

**Facebook:** ✅ Supported
```typescript
{
  type: "text",
  message: "Just a text update!",
  link: "https://example.com"  // Optional
}
```

**Instagram:** ❌ Not Supported
```
Error: "Instagram does not support text-only posts"
```

**Unified (FBINSTA):**
- ❌ Cannot publish text-only to both platforms
- ✅ Can publish text to Facebook only
- ⚠️ Will fail if trying to publish to Instagram

**Key Differences:**
- ❌ Instagram REQUIRES media (photo or video)
- ✅ Facebook allows text-only posts
- ✅ Facebook supports link attachments

---

### 3. Video Posts / Reels

**Facebook:** ❌ Not Implemented Yet
```
Error: "Video posts not yet implemented for Facebook"
```

**Instagram:** ✅ Supported (as Reels)
```typescript
{
  type: "reel",  // or "video"
  caption: "Check out this reel!",
  video_url: "https://example.com/video.mp4"
}
```

**Unified (FBINSTA):**
- ❌ Cannot publish videos to both platforms yet
- ✅ Can publish reels to Instagram only
- ⚠️ Facebook video implementation pending

**Key Differences:**
- ✅ Instagram supports video as Reels
- ❌ Facebook video API not yet implemented
- ⚠️ Video must be publicly accessible URL
- ⚠️ Instagram has video format requirements (aspect ratio, duration, etc.)

---

## 🔧 Technical Implementation Details

### Content Publishing Service

**File:** `src/modules/social-provider/content-publishing-service.ts`

**Supported Content Types:**
```typescript
type ContentType = "photo" | "video" | "text" | "reel"
type Platform = "facebook" | "instagram" | "both"
```

**Publishing Flow:**
```
1. Validate input
2. Get Page Access Token (works for both platforms)
3. Route to platform-specific service(s)
4. Return unified results
```

### Facebook Service

**File:** `src/modules/social-provider/facebook-service.ts`

**Implemented Methods:**
- ✅ `createPagePhotoPost()` - Publish photo with caption
- ✅ `createPageFeedPost()` - Publish text/link post
- ❌ `createPageVideoPost()` - Not implemented

**API Endpoints Used:**
- `POST /v24.0/{page-id}/photos` - Photo posts
- `POST /v24.0/{page-id}/feed` - Text/link posts

### Instagram Service

**File:** `src/modules/social-provider/instagram-service.ts`

**Implemented Methods:**
- ✅ `publishImage()` - Publish photo with caption
- ✅ `publishVideoAsReel()` - Publish video as reel
- ✅ `getMediaPermalink()` - Get post URL

**API Endpoints Used:**
- `POST /v24.0/{ig-user-id}/media` - Create media container
- `POST /v24.0/{ig-user-id}/media_publish` - Publish container
- `GET /v24.0/{media-id}?fields=permalink` - Get post URL

---

## 📋 Format Differences Summary

### Field Naming

| Concept | Facebook | Instagram | Unified |
|---------|----------|-----------|---------|
| Caption/Text | `message` | `caption` | `message` (converted) |
| Image | `image_url` or `url` | `image_url` | `image_url` |
| Video | `video_url` | `video_url` | `video_url` |
| Link | `link` | N/A | `link` (FB only) |

### Content Requirements

| Requirement | Facebook | Instagram |
|-------------|----------|-----------|
| **Text-only** | ✅ Allowed | ❌ Not allowed |
| **Media required** | ❌ Optional | ✅ Required |
| **Caption length** | ~63,206 chars | ~2,200 chars |
| **Hashtags** | ✅ Supported | ✅ Supported |
| **Mentions** | ✅ @username | ✅ @username |
| **Link in caption** | ✅ Clickable | ❌ Not clickable |
| **Multiple images** | ✅ Albums | ✅ Carousels (not impl.) |

### Media Requirements

#### Images

| Requirement | Facebook | Instagram |
|-------------|----------|-----------|
| **Format** | JPG, PNG, GIF, BMP | JPG, PNG |
| **Max size** | 4 MB | 8 MB |
| **Min resolution** | 200x200 px | 320x320 px |
| **Max resolution** | 2048x2048 px | 1440x1440 px |
| **Aspect ratio** | Any | 4:5 to 1.91:1 |

#### Videos (Reels)

| Requirement | Facebook | Instagram |
|-------------|----------|-----------|
| **Format** | MP4, MOV | MP4, MOV |
| **Max size** | 1 GB | 1 GB |
| **Duration** | Up to 240 min | 3-90 seconds |
| **Aspect ratio** | Any | 9:16 (vertical) |
| **Resolution** | 1080p | 1080x1920 px |

---

## 🎯 Current Workflow Implementation

### Unified Publishing Workflow

**File:** `src/workflows/socials/publish-to-both-platforms.ts`

**Two Workflow Modes:**

#### 1. Series Workflow (Sequential)
```
Publish to Facebook → Wait → Publish to Instagram
```
- Publishes to Facebook first
- Then publishes to Instagram
- If Facebook fails, Instagram still attempts
- Rollback support for each platform

#### 2. Unified Workflow (Single Call)
```
Publish to Both Platforms Simultaneously
```
- Uses `ContentPublishingService.publishContent()`
- Publishes to both in parallel
- Returns combined results

### API Route

**File:** `src/api/admin/socials/publish-both/route.ts`

**Endpoint:** `POST /admin/socials/publish-both`

**Request:**
```json
{
  "post_id": "01K9D25PAZHKTQ2ZYE64VRN1F8"
}
```

**Process:**
1. Load social post from database
2. Extract `page_id` and `ig_user_id` from post metadata
3. Get platform access token
4. Call unified publishing workflow
5. Update post with results and URLs

---

## 🚀 What Works Today

### ✅ Fully Functional

1. **OAuth Authentication**
   - Facebook Login with Instagram permissions
   - Fetches Facebook Pages
   - Fetches linked Instagram Business accounts
   - Saves granted scopes to api_config

2. **Photo Publishing**
   - Publish photos to Facebook Page
   - Publish photos to Instagram
   - Publish photos to BOTH simultaneously
   - Get post URLs for both platforms

3. **UI Integration**
   - Create posts with FBINSTA platform
   - Select Facebook Page and Instagram account
   - Upload/specify image URL
   - Add caption/message
   - Publish to both with one click

4. **Data Management**
   - Store post metadata (page_id, ig_user_id)
   - Store post insights (post IDs, URLs)
   - Track publish status
   - Handle errors gracefully

---

## ⚠️ Current Limitations

### 1. Content Type Limitations

❌ **Cannot publish to both:**
- Text-only posts (Instagram doesn't support)
- Videos (Facebook implementation pending)

✅ **Can publish to both:**
- Photo posts with captions

### 2. Missing Features

🔧 **Permissions granted but not implemented:**
- Comment management
- Analytics/insights
- Direct messages
- Stories
- Carousels (multiple images)

❌ **Not implemented:**
- Facebook video posts
- Instagram Stories
- Scheduled publishing
- Draft management
- Post editing/deletion

### 3. Format Constraints

⚠️ **Must handle manually:**
- Instagram caption length (2,200 chars)
- Image aspect ratio differences
- Video format requirements
- Link behavior differences

---

## 🎯 Recommended Usage Patterns

### Pattern 1: Photo Posts (Recommended)

**Best for:** Product photos, announcements, visual content

```typescript
{
  platform: "both",
  type: "photo",
  message: "Check out our new product! 🎉",
  image_url: "https://example.com/product.jpg",
  page_id: "747917475065823",
  ig_user_id: "17841405822304914"
}
```

**Result:** ✅ Posts to both Facebook and Instagram

### Pattern 2: Text Updates (Facebook Only)

**Best for:** News, links, text announcements

```typescript
{
  platform: "facebook",
  type: "text",
  message: "Read our latest blog post!",
  link: "https://example.com/blog",
  page_id: "747917475065823"
}
```

**Result:** ✅ Posts to Facebook only

### Pattern 3: Reels (Instagram Only)

**Best for:** Short videos, behind-the-scenes

```typescript
{
  platform: "instagram",
  type: "reel",
  caption: "Behind the scenes! 🎬",
  video_url: "https://example.com/video.mp4",
  ig_user_id: "17841405822304914"
}
```

**Result:** ✅ Posts to Instagram only

---

## 🔮 Future Enhancements

### Priority 1: Video Support
- [ ] Implement Facebook video posting
- [ ] Support video to both platforms
- [ ] Handle format conversions

### Priority 2: Advanced Features
- [ ] Instagram Stories
- [ ] Facebook Stories
- [ ] Carousel posts (multiple images)
- [ ] Scheduled publishing

### Priority 3: Engagement Features
- [ ] Comment management (permission already granted)
- [ ] Reply to comments
- [ ] Moderate comments

### Priority 4: Analytics
- [ ] Post insights (permission already granted)
- [ ] Engagement metrics
- [ ] Reach and impressions

### Priority 5: Messaging
- [ ] Direct message management (permission already granted)
- [ ] Auto-replies
- [ ] Message templates

---

## 📊 Comparison Table

| Feature | Facebook | Instagram | FBINSTA (Both) |
|---------|----------|-----------|----------------|
| **Photo Posts** | ✅ | ✅ | ✅ |
| **Text Posts** | ✅ | ❌ | ❌ |
| **Video Posts** | ❌ | ✅ | ❌ |
| **Link Sharing** | ✅ | ❌ | ❌ |
| **Stories** | ❌ | ❌ | ❌ |
| **Carousels** | ❌ | ❌ | ❌ |
| **Comments** | 🔧 | 🔧 | 🔧 |
| **Analytics** | 🔧 | 🔧 | 🔧 |
| **Messages** | 🔧 | 🔧 | 🔧 |

**Legend:**
- ✅ Implemented and working
- ❌ Not supported or not implemented
- 🔧 Permission granted, implementation pending

---

## 💡 Key Takeaways

1. **Photo posts work perfectly** for both platforms
2. **Text posts** are Facebook-only (Instagram requires media)
3. **Video posts** need Facebook implementation to work for both
4. **Format differences** are handled automatically by the service
5. **Permissions are ready** for advanced features (comments, analytics, messages)
6. **Current focus** is on core publishing functionality
7. **Future expansion** can leverage existing permissions

---

## 🎉 Summary

**What you can do today:**
- ✅ Publish photos to Facebook and Instagram simultaneously
- ✅ Publish text updates to Facebook
- ✅ Publish reels to Instagram
- ✅ Get post URLs for both platforms
- ✅ Manage everything through FBINSTA UI

**What's coming next:**
- 🔜 Facebook video support
- 🔜 Comment management
- 🔜 Analytics and insights
- 🔜 Stories support
- 🔜 Carousel posts

Your FBINSTA platform is production-ready for photo publishing to both platforms! 🚀

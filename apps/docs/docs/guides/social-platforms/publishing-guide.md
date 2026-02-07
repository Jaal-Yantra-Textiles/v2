---
title: "FBINSTA Flexible Publishing: Choose Facebook, Instagram, or Both"
sidebar_label: "Publishing Guide"
sidebar_position: 4
---

# FBINSTA Flexible Publishing: Choose Facebook, Instagram, or Both

## ✅ Feature Complete!

The FBINSTA platform now supports **flexible publishing** - users can choose to publish to:
- 📘 **Facebook Only**
- 📷 **Instagram Only**
- 📘 + 📷 **Both Platforms**

---

## 🎯 What Changed

### Before (Rigid):
```
FBINSTA platform → Always publishes to BOTH platforms
- Required both Facebook Page AND Instagram Account
- No flexibility for single-platform posts
```

### After (Flexible):
```
FBINSTA platform → User chooses target:
  ├── Facebook Only (requires page_id)
  ├── Instagram Only (requires ig_user_id)
  └── Both Platforms (requires both)
```

---

## 📋 Changes Made

### 1. **Create Post Form** ✅

**File:** `src/admin/components/social-posts/create-social-post-component.tsx`

**Added:**
- `publish_target` field to schema: `"facebook" | "instagram" | "both"`
- Publish Target selector dropdown with emoji icons
- Conditional field visibility based on selection
- Smart validation (only validates required fields for selected target)

**UI Flow:**
```
1. User selects FBINSTA platform
2. New dropdown appears: "Publish To"
   - 📘 Facebook Only
   - 📷 Instagram Only
   - 📘 + 📷 Both Platforms
3. Form shows only relevant fields:
   - Facebook Only → Shows Facebook Page selector only
   - Instagram Only → Shows Instagram Account selector only
   - Both → Shows both selectors
4. Validation enforces only required fields
```

**Code:**
```typescript
// Schema includes publish_target
publish_target: z.enum(["facebook", "instagram", "both"]).optional()

// Conditional validation
if (data.publish_target === "facebook" || data.publish_target === "both") {
  if (!data.page_id) {
    ctx.addIssue({ message: "Facebook page is required" })
  }
}

if (data.publish_target === "instagram" || data.publish_target === "both") {
  if (!data.ig_user_id) {
    ctx.addIssue({ message: "Instagram account is required" })
  }
}

// Conditional field rendering
{(publishTarget === "facebook" || publishTarget === "both") && (
  <FacebookPageSelector />
)}

{(publishTarget === "instagram" || publishTarget === "both") && (
  <InstagramAccountSelector />
)}
```

---

### 2. **Post Detail View** ✅

**File:** `src/admin/components/social-posts/social-post-general-section.tsx`

**Added:**
- Dynamic button labels based on `publish_target` from metadata
- Reads `post.metadata.publish_target` to determine target
- Shows appropriate emoji and text

**Button Labels:**
```typescript
const getPublishLabel = () => {
  if (publishTarget === "facebook") return "📘 Publish to Facebook"
  if (publishTarget === "instagram") return "📷 Publish to Instagram"
  if (publishTarget === "both") return "📘 + 📷 Publish to Both"
  return "Publish now"
}
```

**Result:**
- User sees exactly what will happen when they click publish
- Clear visual indication of target platform(s)

---

### 3. **API Endpoint** ✅

**File:** `src/api/admin/socials/publish-both/route.ts`

**Updated:**
- Extracts `publish_target` from post metadata
- Validates only required fields based on target
- Passes `publishTarget` to workflow

**Validation Logic:**
```typescript
const publishTarget = metadata.publish_target || "both"

// Conditional validation
if ((publishTarget === "facebook" || publishTarget === "both") && !pageId) {
  throw new Error("Facebook page_id required")
}

if ((publishTarget === "instagram" || publishTarget === "both") && !igUserId) {
  throw new Error("Instagram ig_user_id required")
}

// Pass to workflow
await publishToBothPlatformsUnifiedWorkflow(req.scope).run({
  input: {
    pageId: pageId || "",
    igUserId: igUserId || "",
    userAccessToken,
    publishTarget, // ← New parameter
    content: { ... }
  }
})
```

---

### 4. **Workflow** ✅

**File:** `src/workflows/socials/publish-to-both-platforms.ts`

**Updated:**
- Added `publishTarget` to workflow input interface
- Updated step to use `publishTarget` to determine platform
- Passes correct platform value to ContentPublishingService

**Workflow Logic:**
```typescript
interface PublishToBothPlatformsInput {
  pageId: string
  igUserId: string
  userAccessToken: string
  publishTarget?: "facebook" | "instagram" | "both" // ← New field
  content: { ... }
}

const publishToBothPlatformsStep = createStep(
  "publish-to-both-platforms-unified",
  async (input, { container }) => {
    const publisher = socialProvider.getContentPublisher()
    
    // Use publishTarget to determine platform
    const targetPlatform = input.publishTarget || "both"
    
    const result = await publisher.publishContent({
      ...input,
      platform: targetPlatform, // ← "facebook", "instagram", or "both"
    })
    
    return new StepResponse(result)
  }
)
```

---

### 5. **ContentPublishingService** ✅

**File:** `src/modules/social-provider/content-publishing-service.ts`

**No changes needed!** ✅

The service already supports `platform: "facebook" | "instagram" | "both"` parameter and handles:
- Publishing to Facebook only
- Publishing to Instagram only
- Publishing to both platforms

The existing logic works perfectly:
```typescript
async publishContent(input: PublishContentInput): Promise<PublishResponse> {
  const { platform } = input
  
  if (platform === "facebook" || platform === "both") {
    // Publish to Facebook
  }
  
  if (platform === "instagram" || platform === "both") {
    // Publish to Instagram
  }
}
```

---

## 🎨 UI Examples

### Create Post Form

**Step 1: Select FBINSTA Platform**
```
┌─────────────────────────────────────────┐
│ Create Social Post                      │
├─────────────────────────────────────────┤
│ Platform: [FBINSTA              ▼]     │
└─────────────────────────────────────────┘
```

**Step 2: Choose Publish Target**
```
┌─────────────────────────────────────────┐
│ Facebook & Instagram Post               │
├─────────────────────────────────────────┤
│ Publish To: [Select platform(s) ▼]     │
│   - 📘 Facebook Only                    │
│   - 📷 Instagram Only                   │
│   - 📘 + 📷 Both Platforms              │
└─────────────────────────────────────────┘
```

**Step 3a: If "Facebook Only" selected**
```
┌─────────────────────────────────────────┐
│ Publish To: 📘 Facebook Only            │
├─────────────────────────────────────────┤
│ Post Type: [Photo              ▼]      │
│                                         │
│ Facebook Page: [Cici Label     ▼]      │
│                                         │
│ Message: [Write your message...      ] │
│                                         │
│ Media: [Select image]                   │
└─────────────────────────────────────────┘
```

**Step 3b: If "Instagram Only" selected**
```
┌─────────────────────────────────────────┐
│ Publish To: 📷 Instagram Only           │
├─────────────────────────────────────────┤
│ Post Type: [Photo              ▼]      │
│                                         │
│ Instagram Account: [@cicilabel ▼]      │
│                                         │
│ Caption: [Write your caption...      ] │
│                                         │
│ Media: [Select image]                   │
└─────────────────────────────────────────┘
```

**Step 3c: If "Both Platforms" selected**
```
┌─────────────────────────────────────────┐
│ Publish To: 📘 + 📷 Both Platforms      │
├─────────────────────────────────────────┤
│ Post Type: [Photo              ▼]      │
│                                         │
│ Facebook Page: [Cici Label     ▼]      │
│                                         │
│ Instagram Account: [@cicilabel ▼]      │
│                                         │
│ Message/Caption: [Write message...   ] │
│                                         │
│ Media: [Select image]                   │
└─────────────────────────────────────────┘
```

---

### Post Detail View

**Draft Post - Facebook Only:**
```
┌─────────────────────────────────────────┐
│ Social Post Detail                      │
├─────────────────────────────────────────┤
│ Status: Draft                           │
│                                         │
│ [📘 Publish to Facebook]                │
└─────────────────────────────────────────┘
```

**Draft Post - Instagram Only:**
```
┌─────────────────────────────────────────┐
│ Social Post Detail                      │
├─────────────────────────────────────────┤
│ Status: Draft                           │
│                                         │
│ [📷 Publish to Instagram]               │
└─────────────────────────────────────────┘
```

**Draft Post - Both Platforms:**
```
┌─────────────────────────────────────────┐
│ Social Post Detail                      │
├─────────────────────────────────────────┤
│ Status: Draft                           │
│                                         │
│ [📘 + 📷 Publish to Both]               │
└─────────────────────────────────────────┘
```

**Published Post - Both Platforms:**
```
┌─────────────────────────────────────────┐
│ Social Post Detail                      │
├─────────────────────────────────────────┤
│ Status: Published ✓                     │
│                                         │
│ Facebook Post:                          │
│ https://www.facebook.com/123...         │
│                                         │
│ Instagram Post:                         │
│ https://www.instagram.com/p/ABC...      │
└─────────────────────────────────────────┘
```

---

## 🔄 Complete User Flow

### Scenario 1: Facebook Only

```
1. Create Post → Select FBINSTA
2. Choose "📘 Facebook Only"
3. Select Facebook Page
4. Add message and photo
5. Click "Create Post"
6. Post Detail → Click "📘 Publish to Facebook"
7. ✓ Published to Facebook only
8. See Facebook post URL
```

### Scenario 2: Instagram Only

```
1. Create Post → Select FBINSTA
2. Choose "📷 Instagram Only"
3. Select Instagram Account
4. Add caption and photo
5. Click "Create Post"
6. Post Detail → Click "📷 Publish to Instagram"
7. ✓ Published to Instagram only
8. See Instagram post URL
```

### Scenario 3: Both Platforms

```
1. Create Post → Select FBINSTA
2. Choose "📘 + 📷 Both Platforms"
3. Select Facebook Page AND Instagram Account
4. Add message/caption and photo
5. Click "Create Post"
6. Post Detail → Click "📘 + 📷 Publish to Both"
7. ✓ Published to both platforms
8. See both Facebook and Instagram URLs
```

---

## 📊 Data Structure

### Post Metadata

```typescript
{
  "metadata": {
    "page_id": "747917475065823",        // Optional (required for FB)
    "ig_user_id": "17841405822304914",   // Optional (required for IG)
    "publish_target": "facebook",        // "facebook" | "instagram" | "both"
    "auto_publish": false
  }
}
```

### Post Insights (After Publishing)

```typescript
{
  "insights": {
    "facebook_post_id": "747917475065823_122104567890123",  // If published to FB
    "instagram_media_id": "18123456789012345",              // If published to IG
    "instagram_permalink": "https://www.instagram.com/p/ABC123def/",
    "published_at": "2025-11-07T13:41:00Z",
    "publish_results": [
      {
        "platform": "facebook",
        "success": true,
        "postId": "747917475065823_122104567890123"
      },
      {
        "platform": "instagram",
        "success": true,
        "postId": "18123456789012345",
        "permalink": "https://www.instagram.com/p/ABC123def/"
      }
    ]
  }
}
```

---

## ✅ Benefits

### 1. **Flexibility**
- Users can publish to one or both platforms
- No need to create separate posts for each platform
- Single platform for managing both Facebook and Instagram

### 2. **Efficiency**
- Only fill in required fields for target platform
- No wasted effort selecting accounts you won't use
- Clear visual feedback on what will happen

### 3. **User Experience**
- Intuitive dropdown with emoji icons
- Conditional form fields (only show what's needed)
- Dynamic button labels (know exactly what will happen)
- Smart validation (only validate required fields)

### 4. **Technical**
- Single OAuth flow (Facebook Login)
- Reuses existing ContentPublishingService
- No breaking changes to existing code
- Backward compatible (defaults to "both" if not specified)

---

## 🎯 Use Cases

### Use Case 1: Different Content for Each Platform
```
Post 1: Facebook Only
- Long-form text with link
- Professional tone
- Target: Business audience

Post 2: Instagram Only
- Photo with hashtags
- Casual tone
- Target: Consumer audience
```

### Use Case 2: Platform-Specific Campaigns
```
Facebook Campaign:
- Publish to Facebook Only
- Track Facebook-specific metrics
- Different messaging strategy

Instagram Campaign:
- Publish to Instagram Only
- Track Instagram-specific metrics
- Visual-first content
```

### Use Case 3: Unified Announcements
```
Product Launch:
- Publish to Both Platforms
- Same message and image
- Maximum reach
- Consistent branding
```

---

## 🔧 Technical Implementation

### Validation Flow

```typescript
// 1. User selects publish_target
publish_target: "facebook" | "instagram" | "both"

// 2. Form validates conditionally
if (publish_target === "facebook" || publish_target === "both") {
  require: page_id
}

if (publish_target === "instagram" || publish_target === "both") {
  require: ig_user_id
}

// 3. API validates conditionally
if ((publishTarget === "facebook" || publishTarget === "both") && !pageId) {
  throw Error
}

if ((publishTarget === "instagram" || publishTarget === "both") && !igUserId) {
  throw Error
}

// 4. Workflow uses publish_target
const targetPlatform = input.publishTarget || "both"

// 5. ContentPublishingService publishes to target
await publisher.publishContent({
  platform: targetPlatform, // "facebook", "instagram", or "both"
  ...
})
```

### Publishing Logic

```typescript
// ContentPublishingService.publishContent()

if (platform === "facebook" || platform === "both") {
  // Publish to Facebook
  const fbResult = await this.publishToFacebook(...)
  results.push(fbResult)
}

if (platform === "instagram" || platform === "both") {
  // Publish to Instagram
  const igResult = await this.publishToInstagram(...)
  results.push(igResult)
}

return {
  allSucceeded: results.every(r => r.success),
  results
}
```

---

## 🚀 Migration Guide

### For Existing Posts

**Old posts without `publish_target`:**
- Will default to `"both"` (backward compatible)
- Button will show "Publish to Both Platforms"
- Will attempt to publish to both platforms

**To update existing posts:**
```typescript
// Add publish_target to metadata
await socialsService.updateSocialPost(postId, {
  metadata: {
    ...existingMetadata,
    publish_target: "facebook" // or "instagram" or "both"
  }
})
```

### For New Posts

**All new posts will have `publish_target`:**
- Required field in create form
- Stored in metadata
- Used for validation and publishing

---

## 📝 Summary

### What We Built

✅ **Flexible publish target selection**
- User chooses Facebook, Instagram, or Both
- Dropdown with emoji icons for clarity

✅ **Conditional form fields**
- Only show Facebook Page selector if needed
- Only show Instagram Account selector if needed
- Smart validation based on selection

✅ **Dynamic button labels**
- Button text reflects selected target
- Clear visual feedback

✅ **Updated workflow**
- Accepts `publishTarget` parameter
- Passes to ContentPublishingService
- Publishes to correct platform(s)

✅ **Backward compatible**
- Existing posts default to "both"
- No breaking changes
- Graceful degradation

### Files Changed

1. `src/admin/components/social-posts/create-social-post-component.tsx`
2. `src/admin/components/social-posts/social-post-general-section.tsx`
3. `src/api/admin/socials/publish-both/route.ts`
4. `src/workflows/socials/publish-to-both-platforms.ts`

### Result

**Users now have full control over where their content is published!**

- 📘 Facebook Only → Perfect for text posts, links, long-form content
- 📷 Instagram Only → Perfect for visual content, hashtags, stories
- 📘 + 📷 Both → Perfect for announcements, product launches, unified messaging

**One platform, three publishing options, infinite possibilities!** 🎉

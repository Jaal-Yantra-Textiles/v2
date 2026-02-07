---
title: "Phase 2: Route Handler Refactoring Plan"
sidebar_label: "Phase 2"
sidebar_position: 7
---

# Phase 2: Route Handler Refactoring Plan

## Overview

Refactor the publishing route handlers to be thin wrappers around workflows, moving all business logic into reusable workflow steps.

---

## Current State Analysis

### `/social-posts/[id]/publish/route.ts` (351 lines)

**Current Issues:**
1. ❌ **Too much business logic in route** (351 lines)
2. ❌ **Direct token access** (needs decryption)
3. ❌ **Complex validation logic** (should be in workflow)
4. ❌ **Smart retry logic** (should be in workflow)
5. ❌ **Content type detection** (should be in workflow)
6. ❌ **Platform-specific validation** (should be in workflow)
7. ❌ **Result merging logic** (should be in workflow)
8. ❌ **Post update logic** (should be in workflow)

**What it does:**
- Loads post with platform
- Validates platform and credentials
- Detects previous publish attempts (smart retry)
- Extracts target accounts from metadata
- Determines content type
- Validates content compatibility
- Runs appropriate workflow (Twitter or FB/IG)
- Merges results with previous attempts
- Updates post with results

---

## Refactoring Strategy

### Goal: Reduce route to ~50 lines

**Route should only:**
1. Extract request parameters
2. Call unified workflow
3. Return response

**Workflow should handle:**
1. Load post with platform
2. Validate platform and credentials (with decryption)
3. Detect smart retry scenarios
4. Extract and validate content
5. Publish to platforms
6. Merge results
7. Update post

---

## Implementation Plan

### Step 1: Create Unified Publishing Workflow

**File:** `/src/workflows/socials/publish-social-post-unified.ts`

**Workflow Steps:**
```typescript
publishSocialPostUnifiedWorkflow
  ├── loadPostWithPlatformStep          // Load post + platform
  ├── validatePlatformStep               // Validate platform exists
  ├── decryptCredentialsStep             // Decrypt tokens using helpers
  ├── detectSmartRetryStep               // Check previous attempts
  ├── extractTargetAccountsStep          // Get page_id, ig_user_id
  ├── extractContentStep                 // Get media, caption
  ├── determineContentTypeStep           // photo, video, text, etc.
  ├── validateContentCompatibilityStep   // Check platform support
  ├── routeToPlatformWorkflowStep        // Call Twitter or FB/IG workflow
  ├── mergePublishResultsStep            // Merge with previous attempts
  └── updatePostWithResultsStep          // Update post status
```

**Benefits:**
- ✅ Each step is independently testable
- ✅ Steps can be reused in other workflows
- ✅ Clear separation of concerns
- ✅ Easy to add new platforms
- ✅ Centralized error handling

---

### Step 2: Refactor Route Handler

**Before (351 lines):**
```typescript
export const POST = async (req, res) => {
  // 50 lines of validation
  // 100 lines of content extraction
  // 50 lines of smart retry logic
  // 50 lines of workflow calls
  // 100 lines of result merging
  // Return response
}
```

**After (~50 lines):**
```typescript
export const POST = async (req, res) => {
  const postId = req.params.id
  const { override_page_id, override_ig_user_id } = req.validatedBody

  const { result } = await publishSocialPostUnifiedWorkflow(req.scope).run({
    input: {
      post_id: postId,
      override_page_id,
      override_ig_user_id,
    },
  })

  res.status(200).json({
    success: result.success,
    post: result.post,
    results: result.results,
    retry_info: result.retry_info,
  })
}
```

---

### Step 3: Update Existing Workflows

**Files to update:**
1. `/src/workflows/socials/publish-post.ts` - Use decryption helpers
2. `/src/workflows/socials/publish-to-both-platforms.ts` - Use decryption helpers

**Changes:**
- ✅ Already done in Phase 1!
- ✅ Workflows now use `decryptAccessToken()` helper
- ✅ Backward compatible with plaintext tokens

---

### Step 4: Deprecate Redundant Routes

**Routes to deprecate:**

1. **`/socials/publish`** (105 lines)
   - Redundant: Use post creation + `/social-posts/[id]/publish`
   - Add deprecation warning
   - Keep for backward compatibility

2. **`/socials/publish-both`** (215 lines)
   - Redundant: Handled by unified workflow
   - Add deprecation warning
   - Keep for backward compatibility

**Deprecation Strategy:**
```typescript
// Add to route
console.warn(
  "⚠️  DEPRECATED: /socials/publish is deprecated. " +
  "Use POST /social-posts/:id/publish instead."
)

res.setHeader("X-Deprecated", "true")
res.setHeader("X-Deprecation-Info", "Use POST /social-posts/:id/publish")
```

---

## Detailed Workflow Steps

### 1. `loadPostWithPlatformStep`

**Input:** `{ post_id }`
**Output:** `{ post, platform }`

```typescript
const [post] = await socials.listSocialPosts(
  { id: post_id },
  { relations: ["platform"] }
)

if (!post || !post.platform) {
  throw new MedusaError(...)
}

return new StepResponse({ post, platform: post.platform })
```

---

### 2. `validatePlatformStep`

**Input:** `{ platform }`
**Output:** `{ platform_name, is_fbinsta }`

```typescript
const platformName = platform.name.toLowerCase()
const isFBINSTA = platformName === "fbinsta" || platformName === "facebook & instagram"

return new StepResponse({ platform_name: platformName, is_fbinsta: isFBINSTA })
```

---

### 3. `decryptCredentialsStep`

**Input:** `{ platform, platform_name }`
**Output:** `{ user_access_token, credentials }`

```typescript
import { decryptAccessToken } from "../../modules/socials/utils/token-helpers"

const apiConfig = platform.api_config

// Decrypt access token
const userAccessToken = decryptAccessToken(apiConfig, container)

// Handle Twitter OAuth1 credentials
let credentials = { user_access_token: userAccessToken }

if (platform_name === "twitter" || platform_name === "x") {
  credentials = {
    ...credentials,
    oauth1_user: apiConfig.oauth1_credentials,
    oauth1_app: apiConfig.oauth1_app_credentials || apiConfig.app_credentials,
  }
}

return new StepResponse({ user_access_token: userAccessToken, credentials })
```

---

### 4. `detectSmartRetryStep`

**Input:** `{ post, is_fbinsta }`
**Output:** `{ publish_target, is_retry, previous_results }`

```typescript
const currentInsights = post.insights || {}
const previousResults = currentInsights.publish_results || []

const facebookSucceeded = previousResults.some(
  r => r.platform === "facebook" && r.success
)
const instagramSucceeded = previousResults.some(
  r => r.platform === "instagram" && r.success
)
const facebookFailed = previousResults.some(
  r => r.platform === "facebook" && !r.success
)
const instagramFailed = previousResults.some(
  r => r.platform === "instagram" && !r.success
)

let publishTarget = post.metadata?.publish_target || "both"

// Smart retry logic
if (is_fbinsta && publishTarget === "both") {
  if (facebookSucceeded && instagramFailed) {
    publishTarget = "instagram"
    console.log("🔄 Smart retry: Instagram only")
  } else if (instagramSucceeded && facebookFailed) {
    publishTarget = "facebook"
    console.log("🔄 Smart retry: Facebook only")
  }
}

return new StepResponse({
  publish_target: publishTarget,
  is_retry: previousResults.length > 0,
  previous_results: previousResults,
})
```

---

### 5. `extractTargetAccountsStep`

**Input:** `{ post, override_page_id, override_ig_user_id }`
**Output:** `{ page_id, ig_user_id }`

```typescript
const metadata = post.metadata || {}
const pageId = override_page_id || metadata.page_id
const igUserId = override_ig_user_id || metadata.ig_user_id

return new StepResponse({ page_id: pageId, ig_user_id: igUserId })
```

---

### 6. `extractContentStep`

**Input:** `{ post }`
**Output:** `{ caption, media_attachments }`

```typescript
const caption = post.caption || ""
const mediaAttachments = post.media_attachments || []

return new StepResponse({ caption, media_attachments })
```

---

### 7. `determineContentTypeStep`

**Input:** `{ media_attachments, caption }`
**Output:** `{ content_type, image_url, image_urls, video_url }`

```typescript
const imageAttachments = media_attachments.filter(a => a.type === "image")
const videoAttachment = media_attachments.find(a => a.type === "video")

let contentType = "text"
let imageUrl, imageUrls, videoUrl

if (imageAttachments.length > 1) {
  contentType = "carousel"
  imageUrls = imageAttachments.map(a => a.url)
} else if (imageAttachments.length === 1) {
  contentType = "photo"
  imageUrl = imageAttachments[0].url
} else if (videoAttachment) {
  contentType = "reel"
  videoUrl = videoAttachment.url
}

return new StepResponse({
  content_type: contentType,
  image_url: imageUrl,
  image_urls: imageUrls,
  video_url: videoUrl,
})
```

---

### 8. `validateContentCompatibilityStep`

**Input:** `{ content_type, publish_target, platform_name, caption, media_attachments }`
**Output:** `{ validated: true }`

```typescript
// Instagram doesn't support text-only
if (content_type === "text" && (publish_target === "instagram" || publish_target === "both")) {
  throw new MedusaError(
    MedusaError.Types.INVALID_DATA,
    "Text-only posts not supported on Instagram"
  )
}

// Video to both platforms not yet supported
if (content_type === "reel" && publish_target === "both") {
  throw new MedusaError(
    MedusaError.Types.INVALID_DATA,
    "Video posts to both platforms not yet supported"
  )
}

// Twitter-specific validation
if (platform_name === "twitter" || platform_name === "x") {
  if (caption.length > 280) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Tweet exceeds 280 characters (${caption.length})`
    )
  }
  
  const imageCount = media_attachments.filter(a => a.type === "image").length
  if (imageCount > 4) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Twitter supports max 4 images (${imageCount} provided)`
    )
  }
}

return new StepResponse({ validated: true })
```

---

### 9. `routeToPlatformWorkflowStep`

**Input:** `{ platform_name, post_id, page_id, ig_user_id, user_access_token, publish_target, content_type, caption, image_url, image_urls, video_url }`
**Output:** `{ results }`

```typescript
if (platform_name === "twitter" || platform_name === "x") {
  // Use Twitter workflow
  const { result } = await publishSocialPostWorkflow(container).run({
    input: { post_id },
  })
  
  return new StepResponse({
    results: [{ platform: "twitter", ...result }],
  })
}

// Use Facebook/Instagram workflow
const { result } = await publishToBothPlatformsUnifiedWorkflow(container).run({
  input: {
    pageId: page_id,
    igUserId: ig_user_id,
    userAccessToken: user_access_token,
    publishTarget: publish_target,
    content: {
      type: content_type,
      message: caption,
      caption,
      image_url,
      image_urls,
      video_url,
    },
  },
})

return new StepResponse({ results: result.results })
```

---

### 10. `mergePublishResultsStep`

**Input:** `{ results, previous_results }`
**Output:** `{ merged_results }`

```typescript
const mergedResults = [...previous_results]

results.forEach(newResult => {
  const existingIndex = mergedResults.findIndex(
    r => r.platform === newResult.platform
  )
  
  if (existingIndex >= 0) {
    mergedResults[existingIndex] = newResult
  } else {
    mergedResults.push(newResult)
  }
})

return new StepResponse({ merged_results: mergedResults })
```

---

### 11. `updatePostWithResultsStep`

**Input:** `{ post, merged_results, is_retry }`
**Output:** `{ updated_post, success }`

```typescript
const allSucceeded = merged_results.every(r => r.success)
const anyFailed = merged_results.some(r => !r.success)

const facebookResult = merged_results.find(r => r.platform === "facebook")
const instagramResult = merged_results.find(r => r.platform === "instagram")

let postUrl = post.post_url
const insights = {
  ...post.insights,
  publish_results: merged_results,
  published_at: new Date().toISOString(),
  last_retry_at: is_retry ? new Date().toISOString() : undefined,
}

if (facebookResult?.postId) {
  postUrl = `https://www.facebook.com/${facebookResult.postId}`
  insights.facebook_post_id = facebookResult.postId
}

if (instagramResult?.postId) {
  insights.instagram_media_id = instagramResult.postId
  if (instagramResult.permalink) {
    insights.instagram_permalink = instagramResult.permalink
  }
}

const [updatedPost] = await socials.updateSocialPosts([{
  selector: { id: post.id },
  data: {
    status: allSucceeded ? "posted" : "failed",
    posted_at: allSucceeded ? new Date() : null,
    post_url: postUrl,
    insights,
    error_message: anyFailed
      ? merged_results
          .filter(r => !r.success)
          .map(r => `${r.platform}: ${r.error}`)
          .join("; ")
      : null,
  },
}])

return new StepResponse({
  updated_post: updatedPost,
  success: allSucceeded,
  results: {
    facebook: facebookResult,
    instagram: instagramResult,
  },
  retry_info: is_retry ? {
    is_retry: true,
    previous_attempts: merged_results.length,
  } : undefined,
})
```

---

## Benefits of Refactoring

### 1. **Maintainability**
- Route: 351 lines → ~50 lines (85% reduction)
- Clear separation of concerns
- Easy to understand flow

### 2. **Testability**
- Each workflow step independently testable
- Mock dependencies easily
- Test retry logic in isolation

### 3. **Reusability**
- Steps can be reused in other workflows
- Common validation logic shared
- Platform-specific logic isolated

### 4. **Security**
- All token access goes through decryption helpers
- No plaintext tokens in logs
- Centralized credential management

### 5. **Extensibility**
- Easy to add new platforms
- Simple to modify retry logic
- Clear place for new features

---

## Migration Strategy

### Phase 2.1: Create Unified Workflow ✅
1. Create `/src/workflows/socials/publish-social-post-unified.ts`
2. Implement all 11 workflow steps
3. Write unit tests for each step
4. Test end-to-end

### Phase 2.2: Refactor Route Handler ✅
1. Update `/social-posts/[id]/publish/route.ts`
2. Replace logic with workflow call
3. Maintain same API contract
4. Test all scenarios

### Phase 2.3: Deprecate Redundant Routes ✅
1. Add deprecation warnings to `/socials/publish`
2. Add deprecation warnings to `/socials/publish-both`
3. Update documentation
4. Notify API consumers

### Phase 2.4: Test & Deploy ✅
1. Run integration tests
2. Test all platforms (Facebook, Instagram, Twitter)
3. Test smart retry scenarios
4. Deploy to staging
5. Monitor for issues
6. Deploy to production

---

## Success Criteria

- ✅ Route handler reduced to ~50 lines
- ✅ All business logic in workflows
- ✅ All tests passing
- ✅ Tokens decrypted securely
- ✅ Smart retry working
- ✅ No breaking changes to API
- ✅ Performance maintained or improved
- ✅ Clear deprecation path for old routes

---

## Timeline

**Phase 2.1:** 1 day (Create unified workflow)
**Phase 2.2:** 0.5 days (Refactor route)
**Phase 2.3:** 0.5 days (Deprecate routes)
**Phase 2.4:** 0.5 days (Test & deploy)

**Total:** 2.5 days

---

## Next Steps

1. Start with Phase 2.1: Create unified workflow
2. Implement workflow steps one by one
3. Test each step independently
4. Wire up complete workflow
5. Move to Phase 2.2: Refactor route

Let's begin! 🚀

---
title: "Workflow Steps Created ✅"
sidebar_label: "Steps Created"
sidebar_position: 4
---

# Workflow Steps Created ✅

## Overview

Created 8 modular workflow steps in `/src/workflows/socials/steps/` for the unified social post publishing workflow.

---

## Created Steps

### 1. `load-post-with-platform.ts` ✅
**Purpose:** Load social post with platform relation
**Input:** `{ post_id }`
**Output:** `{ post, platform }`
**Validates:**
- Post exists
- Platform is associated

---

### 2. `validate-platform.ts` ✅
**Purpose:** Extract and validate platform information
**Input:** `{ platform }`
**Output:** `{ platform_name, is_fbinsta }`
**Determines:**
- Platform name (lowercase)
- Whether it's a FBINSTA platform

---

### 3. `decrypt-credentials.ts` ✅
**Purpose:** Decrypt platform credentials securely
**Input:** `{ platform, platform_name }`
**Output:** `{ user_access_token, credentials }`
**Features:**
- Uses `decryptAccessToken()` helper
- Supports encrypted and plaintext tokens
- Validates Twitter OAuth1 credentials
- Backward compatible

---

### 4. `detect-smart-retry.ts` ✅
**Purpose:** Implement smart retry logic
**Input:** `{ post, is_fbinsta }`
**Output:** `{ publish_target, is_retry, previous_results }`
**Logic:**
- Analyzes previous publish attempts
- If Facebook succeeded + Instagram failed → retry Instagram only
- If Instagram succeeded + Facebook failed → retry Facebook only
- Otherwise → publish to both (or as specified)

---

### 5. `extract-target-accounts.ts` ✅
**Purpose:** Extract target account IDs
**Input:** `{ post, override_page_id?, override_ig_user_id? }`
**Output:** `{ page_id, ig_user_id }`
**Features:**
- Overrides take precedence
- Falls back to post metadata

---

### 6. `extract-content.ts` ✅
**Purpose:** Extract post content
**Input:** `{ post }`
**Output:** `{ caption, media_attachments }`
**Extracts:**
- Caption text
- Media attachments array

---

### 7. `determine-content-type.ts` ✅
**Purpose:** Determine content type from media
**Input:** `{ media_attachments, caption }`
**Output:** `{ content_type, image_url?, image_urls?, video_url? }`
**Types:**
- `carousel` - Multiple images
- `photo` - Single image
- `reel` - Video
- `text` - No media

---

### 8. `validate-content-compatibility.ts` ✅
**Purpose:** Validate content compatibility with platform
**Input:** `{ content_type, publish_target, platform_name, caption, media_attachments, page_id?, ig_user_id? }`
**Output:** `{ validated: true }`
**Validates:**
- Instagram doesn't support text-only
- Video to both platforms not supported
- Twitter character limit (280)
- Twitter image limit (4 max)
- Twitter doesn't mix images + videos
- Target accounts exist for FB/IG

---

## File Structure

```
src/workflows/socials/steps/
├── index.ts                            # Exports all steps
├── load-post-with-platform.ts          # Step 1
├── validate-platform.ts                # Step 2
├── decrypt-credentials.ts              # Step 3
├── detect-smart-retry.ts               # Step 4
├── extract-target-accounts.ts          # Step 5
├── extract-content.ts                  # Step 6
├── determine-content-type.ts           # Step 7
└── validate-content-compatibility.ts   # Step 8
```

---

## Benefits

### 1. **Modularity**
- Each step is a separate file
- Easy to understand and maintain
- Clear single responsibility

### 2. **Reusability**
- Steps can be used in other workflows
- Common logic centralized
- Platform-specific logic isolated

### 3. **Testability**
- Each step independently testable
- Mock dependencies easily
- Test edge cases in isolation

### 4. **Maintainability**
- Easy to modify individual steps
- Clear separation of concerns
- Simple to add new validations

### 5. **Security**
- Credentials decrypted via helpers
- No plaintext tokens in logs
- Centralized token management

---

## Next Steps

### Remaining Steps to Create:

**Step 9: Route to Platform Workflow**
- Call Twitter or FB/IG workflow based on platform
- Handle workflow results
- Return publish results

**Step 10: Merge Publish Results**
- Merge new results with previous attempts
- Handle retry scenarios
- Preserve previous successful publishes

**Step 11: Update Post with Results**
- Update post status (posted/failed)
- Store publish results in insights
- Set post URLs
- Handle error messages

---

## Usage Example

```typescript
import {
  loadPostWithPlatformStep,
  validatePlatformStep,
  decryptCredentialsStep,
  // ... other steps
} from "./steps"

export const publishSocialPostUnifiedWorkflow = createWorkflow(
  "publish-social-post-unified",
  (input: { post_id: string }) => {
    // Step 1: Load post
    const postData = loadPostWithPlatformStep({ post_id: input.post_id })
    
    // Step 2: Validate platform
    const platformData = validatePlatformStep({ 
      platform: postData.platform 
    })
    
    // Step 3: Decrypt credentials
    const credentialsData = decryptCredentialsStep({
      platform: postData.platform,
      platform_name: platformData.platform_name
    })
    
    // ... continue with other steps
  }
)
```

---

## Testing Strategy

### Unit Tests (Per Step)
```typescript
describe("loadPostWithPlatformStep", () => {
  it("should load post with platform", async () => {
    // Test successful load
  })
  
  it("should throw error if post not found", async () => {
    // Test error handling
  })
  
  it("should throw error if platform missing", async () => {
    // Test validation
  })
})
```

### Integration Tests
- Test complete workflow flow
- Test smart retry scenarios
- Test all platforms (Facebook, Instagram, Twitter)
- Test error handling

---

## Summary

✅ **8 workflow steps created**
✅ **Modular and reusable**
✅ **Secure token decryption**
✅ **Smart retry logic**
✅ **Comprehensive validation**
✅ **Platform-specific handling**
✅ **Ready for integration**

**Next:** Create remaining 3 steps (route, merge, update) and wire up the complete workflow!

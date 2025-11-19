# Unified Social Post Publishing Workflow - Complete Documentation

## 📋 Table of Contents
- [Overview](#overview)
- [Architecture](#architecture)
- [Workflow Steps](#workflow-steps)
- [API Endpoints](#api-endpoints)
- [Usage Examples](#usage-examples)
- [Testing](#testing)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)

---

## 🎯 Overview

The Unified Social Post Publishing Workflow is a complete refactoring of the social media publishing system, reducing complexity from **351 lines to 67 lines** (81% reduction) while improving maintainability, testability, and security.

### Key Improvements

**Before (Monolithic Route Handler)**:
- ❌ 351 lines of business logic in route handler
- ❌ Difficult to test individual components
- ❌ Hard to modify or extend
- ❌ Validation scattered throughout code
- ❌ No clear separation of concerns

**After (Modular Workflow)**:
- ✅ 67-line route handler (thin HTTP wrapper)
- ✅ 11 independently testable workflow steps
- ✅ Clear separation of concerns
- ✅ Easy to modify and extend
- ✅ Centralized validation
- ✅ Secure token management

---

## 🏗️ Architecture

### Workflow Flow

```
POST /admin/social-posts/:id/publish
         ↓
┌────────────────────────────────────────┐
│  Route Handler (67 lines)              │
│  - Validates request                   │
│  - Calls unified workflow              │
│  - Returns response                    │
└────────────────────────────────────────┘
         ↓
┌────────────────────────────────────────┐
│  Unified Workflow (11 Steps)           │
├────────────────────────────────────────┤
│  1. Load Post with Platform            │
│  2. Validate Platform                  │
│  3. Decrypt Credentials                │
│  4. Detect Smart Retry                 │
│  5. Extract Target Accounts            │
│  6. Extract Content                    │
│  7. Determine Content Type             │
│  8. Validate Content Compatibility     │
│  9. Route to Platform Workflow         │
│ 10. Merge Publish Results              │
│ 11. Update Post with Results           │
└────────────────────────────────────────┘
         ↓
┌────────────────────────────────────────┐
│  Platform-Specific Workflows           │
│  - Twitter Workflow                    │
│  - Facebook/Instagram Workflow         │
└────────────────────────────────────────┘
```

### Directory Structure

```
src/
├── api/admin/social-posts/[id]/publish/
│   ├── route.ts                    # 67-line route handler
│   └── validators.ts               # Request validation
│
├── workflows/socials/
│   ├── publish-social-post-unified.ts  # Main workflow
│   │
│   └── steps/
│       ├── index.ts                    # Export all steps
│       ├── load-post-with-platform.ts  # Step 1
│       ├── validate-platform.ts        # Step 2
│       ├── decrypt-credentials.ts      # Step 3
│       ├── detect-smart-retry.ts       # Step 4
│       ├── extract-target-accounts.ts  # Step 5
│       ├── extract-content.ts          # Step 6
│       ├── determine-content-type.ts   # Step 7
│       ├── validate-content-compatibility.ts  # Step 8
│       ├── route-to-platform-workflow.ts      # Step 9
│       ├── merge-publish-results.ts    # Step 10
│       └── update-post-with-results.ts # Step 11
│
└── modules/socials/utils/
    └── token-helpers.ts            # Token encryption/decryption
```

---

## 📝 Workflow Steps

### Step 1: Load Post with Platform
**File**: `load-post-with-platform.ts`

**Purpose**: Loads the social post by ID with its associated platform.

**Input**:
```typescript
{ post_id: string }
```

**Output**:
```typescript
{ 
  post: SocialPost,
  platform: SocialPlatform 
}
```

**Validation**:
- Post exists
- Platform is associated with post

---

### Step 2: Validate Platform
**File**: `validate-platform.ts`

**Purpose**: Validates platform configuration and status.

**Input**:
```typescript
{ platform: SocialPlatform }
```

**Output**:
```typescript
{ 
  platform_name: string,
  platform_category: string 
}
```

**Validation**:
- Platform is active
- Platform has required configuration

---

### Step 3: Decrypt Credentials
**File**: `decrypt-credentials.ts`

**Purpose**: Securely decrypts OAuth tokens from encrypted storage.

**Input**:
```typescript
{ 
  platform: SocialPlatform,
  platform_name: string 
}
```

**Output**:
```typescript
{ 
  decrypted_token: string,
  api_config: Record<string, unknown> 
}
```

**Security**:
- Uses AES-256-GCM encryption
- Tokens never logged in plaintext
- Supports key rotation

---

### Step 4: Detect Smart Retry
**File**: `detect-smart-retry.ts`

**Purpose**: Implements smart retry logic - only retry failed platforms.

**Input**:
```typescript
{ 
  post: SocialPost,
  platform_name: string 
}
```

**Output**:
```typescript
{ 
  is_retry: boolean,
  target_platforms: string[],
  previous_results: PublishResult[] 
}
```

**Logic**:
- Checks `post.insights.publish_results`
- For FBINSTA: Only retry failed platform (Facebook OR Instagram)
- For single platforms: Retry if failed

---

### Step 5: Extract Target Accounts
**File**: `extract-target-accounts.ts`

**Purpose**: Extracts account IDs from post metadata or overrides.

**Input**:
```typescript
{ 
  post: SocialPost,
  platform_name: string,
  override_page_id?: string,
  override_ig_user_id?: string 
}
```

**Output**:
```typescript
{ 
  page_id?: string,
  ig_user_id?: string 
}
```

**Validation**:
- Facebook requires `page_id`
- Instagram requires `ig_user_id`
- FBINSTA requires both

---

### Step 6: Extract Content
**File**: `extract-content.ts`

**Purpose**: Extracts caption and media from post.

**Input**:
```typescript
{ post: SocialPost }
```

**Output**:
```typescript
{ 
  caption: string,
  media_attachments: Record<string, MediaAttachment> 
}
```

---

### Step 7: Determine Content Type
**File**: `determine-content-type.ts`

**Purpose**: Analyzes media and determines content type.

**Input**:
```typescript
{ media_attachments: Record<string, MediaAttachment> }
```

**Output**:
```typescript
{ 
  content_type: "photo" | "video" | "carousel" | "text" 
}
```

**Logic**:
- No media → `text`
- 1 image → `photo`
- 1 video → `video`
- Multiple images → `carousel`

---

### Step 8: Validate Content Compatibility
**File**: `validate-content-compatibility.ts`

**Purpose**: Validates content against platform-specific rules.

**Input**:
```typescript
{ 
  platform_name: string,
  content_type: string,
  caption: string,
  media_count: number 
}
```

**Validation Rules**:

**Instagram**:
- ❌ Text-only posts not supported
- ✅ Photo, video, carousel supported

**Twitter**:
- ✅ Max 280 characters
- ✅ Max 4 images
- ✅ Text-only supported

**Facebook**:
- ✅ All content types supported

---

### Step 9: Route to Platform Workflow
**File**: `route-to-platform-workflow.ts`

**Purpose**: Routes to appropriate platform-specific workflow.

**Input**:
```typescript
{ 
  platform_name: string,
  post: SocialPost,
  // ... all previous step outputs 
}
```

**Routing Logic**:
- `twitter` → `publishSocialPostWorkflow` (Twitter)
- `facebook`, `instagram`, `fbinsta` → `publishToBothPlatformsUnifiedWorkflow`

**Output**:
```typescript
{ 
  facebook?: PublishResult,
  instagram?: PublishResult,
  twitter?: PublishResult 
}
```

---

### Step 10: Merge Publish Results
**File**: `merge-publish-results.ts`

**Purpose**: Merges new results with previous attempts (for smart retry).

**Input**:
```typescript
{ 
  new_results: PublishResults,
  previous_results: PublishResult[],
  is_retry: boolean 
}
```

**Output**:
```typescript
{ 
  merged_results: PublishResult[] 
}
```

**Logic**:
- First attempt: Use new results
- Retry: Merge with previous, keeping successful results

---

### Step 11: Update Post with Results
**File**: `update-post-with-results.ts`

**Purpose**: Updates post with publish results and status.

**Input**:
```typescript
{ 
  post: SocialPost,
  merged_results: PublishResult[],
  is_retry: boolean,
  platform_name: string 
}
```

**Updates**:
- `status`: `published` or `failed`
- `posted_at`: Current timestamp (if successful)
- `insights.publish_results`: Merged results
- `insights.facebook_post_id`: Facebook post ID
- `insights.instagram_media_id`: Instagram media ID
- `insights.twitter_tweet_id`: Twitter tweet ID
- `error_message`: Error details (if failed)

**Output**:
```typescript
{ 
  success: boolean,
  updated_post: SocialPost,
  results: PublishResults,
  retry_info?: RetryInfo 
}
```

---

## 🔌 API Endpoints

### POST `/admin/social-posts/:id/publish`

Publishes a social media post to configured platforms.

**Request**:
```typescript
POST /admin/social-posts/post_123/publish
Content-Type: application/json
Authorization: Bearer <admin_token>

{
  "override_page_id": "987654321",      // Optional
  "override_ig_user_id": "123456789"    // Optional
}
```

**Response (Success)**:
```typescript
{
  "success": true,
  "post": {
    "id": "post_123",
    "status": "published",
    "posted_at": "2025-11-19T14:00:00Z",
    // ... other post fields
  },
  "results": {
    "facebook": {
      "success": true,
      "post_id": "fb_post_123",
      "url": "https://facebook.com/..."
    },
    "instagram": {
      "success": true,
      "media_id": "ig_media_456",
      "url": "https://instagram.com/..."
    }
  },
  "retry_info": {
    "is_retry": false,
    "retried_platforms": []
  }
}
```

**Response (Failure)**:
```typescript
{
  "success": false,
  "post": {
    "id": "post_123",
    "status": "failed",
    "error_message": "Publishing failed: Invalid OAuth access token"
  },
  "results": {
    "facebook": {
      "success": false,
      "error": "Invalid OAuth access token"
    }
  }
}
```

**Error Codes**:
- `400` - Validation error (missing page_id, invalid content, etc.)
- `404` - Post not found
- `500` - Server error

---

## 💡 Usage Examples

### Example 1: Publish to Facebook

```typescript
// Create a post
const post = await api.post("/admin/social-posts", {
  name: "My Facebook Post",
  caption: "Hello Facebook! #test",
  status: "draft",
  platform_id: "facebook_platform_id",
  media_attachments: {
    "0": {
      type: "image",
      url: "https://example.com/image.jpg"
    }
  },
  metadata: {
    page_id: "123456789",
    publish_target: "facebook"
  }
})

// Publish it
const result = await api.post(`/admin/social-posts/${post.id}/publish`, {})
```

### Example 2: Publish to Both Facebook & Instagram

```typescript
const post = await api.post("/admin/social-posts", {
  name: "My FBINSTA Post",
  caption: "Hello both platforms!",
  status: "draft",
  platform_id: "fbinsta_platform_id",
  media_attachments: {
    "0": {
      type: "image",
      url: "https://example.com/image.jpg"
    }
  },
  metadata: {
    page_id: "123456789",
    ig_user_id: "987654321",
    publish_target: "both"
  }
})

const result = await api.post(`/admin/social-posts/${post.id}/publish`, {})
```

### Example 3: Smart Retry (Only Failed Platform)

```typescript
// First attempt - Facebook succeeds, Instagram fails
const firstAttempt = await api.post(`/admin/social-posts/${post.id}/publish`, {})
// Result: { facebook: { success: true }, instagram: { success: false } }

// Retry - Only retries Instagram
const retryAttempt = await api.post(`/admin/social-posts/${post.id}/publish`, {})
// Result: { facebook: { success: true }, instagram: { success: true } }
// Facebook result preserved from first attempt!
```

### Example 4: Override Account IDs

```typescript
// Override page_id at publish time
const result = await api.post(`/admin/social-posts/${post.id}/publish`, {
  override_page_id: "different_page_id",
  override_ig_user_id: "different_ig_user_id"
})
```

---

## 🧪 Testing

### Integration Tests

**File**: `/integration-tests/http/socials/unified-publish-workflow.spec.ts`

**Test Coverage**:
1. ✅ Workflow execution with fake tokens (expects Facebook API error)
2. ✅ Validation of missing `page_id`
3. ✅ Rejection of array format for `media_attachments`

**Run Tests**:
```bash
yarn test:integration:http ./integration-tests/http/socials/unified-publish-workflow.spec.ts
```

### Test Strategy

**What We Test**:
- ✅ Workflow structure and step execution
- ✅ Validation logic (page_id, content compatibility, etc.)
- ✅ Error handling and messaging
- ✅ Data format validation

**What We Don't Test** (requires real OAuth tokens):
- ❌ Actual publishing to Facebook/Instagram/Twitter
- ❌ Real API responses
- ❌ Live token validation

**For E2E Testing** (manual/staging):
- Set up test social media accounts
- Use real OAuth tokens
- Verify posts actually appear on platforms

---

## 🚀 Deployment

### Prerequisites

1. **Encryption Keys** (if using token encryption)
   ```bash
   # Generate encryption key
   openssl rand -hex 32
   
   # Add to environment
   ENCRYPTION_KEY=your_generated_key
   ```

2. **Database Migration** (if schema changed)
   ```bash
   yarn medusa migrations run
   ```

### Deployment Steps

1. **Staging Deployment**
   ```bash
   # Deploy to staging
   git push staging main
   
   # Monitor logs
   tail -f /var/log/medusa/staging.log
   
   # Test publishing
   curl -X POST https://staging.example.com/admin/social-posts/test_id/publish \
     -H "Authorization: Bearer $STAGING_TOKEN"
   ```

2. **Production Deployment**
   ```bash
   # Deploy to production
   git push production main
   
   # Monitor metrics
   # - Response times
   # - Error rates
   # - Success rates
   ```

3. **Rollback Plan**
   ```bash
   # If issues occur, rollback
   git revert HEAD
   git push production main
   ```

---

## 🔧 Troubleshooting

### Common Issues

#### 1. "Invalid OAuth access token"
**Cause**: Token is invalid or expired  
**Solution**: Re-authenticate the platform

#### 2. "No Facebook page_id found"
**Cause**: Missing `page_id` in post metadata  
**Solution**: Add `page_id` to metadata or provide `override_page_id`

#### 3. "Text-only posts are not supported on Instagram"
**Cause**: Instagram requires media  
**Solution**: Add at least one image or video

#### 4. "Tweet exceeds 280 characters"
**Cause**: Caption too long for Twitter  
**Solution**: Shorten caption to 280 characters or less

#### 5. "Expected type: 'object' for field 'media_attachments', got: 'array'"
**Cause**: Using array format instead of object  
**Solution**: Change `media_attachments` from `[]` to `{}`

```typescript
// ❌ Wrong
media_attachments: [
  { type: "image", url: "..." }
]

// ✅ Correct
media_attachments: {
  "0": { type: "image", url: "..." }
}
```

### Debug Mode

Enable detailed logging:
```typescript
// Each workflow step logs its progress
// Check console for step-by-step execution:
// [Load Post] ✓ Loaded post post_123 with platform Facebook
// [Validate Platform] ✓ Platform Facebook is active
// [Decrypt Credentials] ✓ Access token decrypted successfully
// ...
```

---

## 📊 Metrics & Monitoring

### Key Metrics to Track

1. **Success Rate**: % of successful publishes
2. **Error Rate**: % of failed publishes
3. **Response Time**: Average time to publish
4. **Retry Rate**: % of posts that needed retry
5. **Platform-Specific Success**: Success rate per platform

### Monitoring Setup

```typescript
// Example monitoring with custom metrics
const publishMetrics = {
  total_attempts: 0,
  successful: 0,
  failed: 0,
  retries: 0,
  avg_response_time: 0
}

// Track in workflow
publishMetrics.total_attempts++
if (result.success) publishMetrics.successful++
else publishMetrics.failed++
```

---

## 🎓 Best Practices

1. **Always Use Object Format for media_attachments**
   ```typescript
   media_attachments: { "0": {...}, "1": {...} }
   ```

2. **Provide Required Account IDs**
   - Facebook: `page_id`
   - Instagram: `ig_user_id`
   - FBINSTA: Both

3. **Handle Errors Gracefully**
   - Check `result.success` before assuming success
   - Display error messages to users
   - Implement retry logic for transient failures

4. **Test Before Production**
   - Use staging environment
   - Test all platforms
   - Verify content appears correctly

5. **Monitor Production**
   - Track success/failure rates
   - Set up alerts for high error rates
   - Monitor API rate limits

---

## 📚 Additional Resources

- [Token Encryption Service](./TOKEN_ENCRYPTION_SERVICE.md)
- [Social Platform API Config Schema](./SOCIAL_PLATFORM_API_CONFIG_SCHEMA.md)
- [Refactoring Overview](./REFACTORING_OVERVIEW.md)
- [Test Summary](./UNIFIED_WORKFLOW_TEST_SUMMARY.md)

---

## 🤝 Support

For issues or questions:
1. Check [Troubleshooting](#troubleshooting) section
2. Review integration tests for examples
3. Check workflow step logs for detailed execution flow
4. Contact development team

---

**Last Updated**: November 19, 2025  
**Version**: 1.0.0  
**Status**: ✅ Production Ready

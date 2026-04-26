# Social Posts API Analysis & Refactoring Plan

## Current State Analysis

### API Structure Overview

#### `/api/admin/social-posts/`
- **GET** - List social posts with filters
- **POST** - Create new social post
- Uses workflows: `listSocialPostWorkflow`, `createSocialPostWorkflow`

#### `/api/admin/social-posts/[id]/`
- **GET** - Get single post
- **POST** - Update post
- **DELETE** - Delete post
- Uses workflows: `listSocialPostWorkflow`, `updateSocialPostWorkflow`, `deleteSocialPostWorkflow`

#### `/api/admin/social-posts/[id]/publish/`
- **POST** - Publish a post (351 lines - **TOO COMPLEX**)
- Contains massive business logic in route handler
- Handles: Facebook, Instagram, Twitter, FBINSTA platforms
- Smart retry logic, validation, token resolution
- **PROBLEM**: All logic in route, no workflow orchestration

#### `/api/admin/socials/publish/`
- **POST** - Generic publish endpoint (105 lines)
- Uses workflows: `publishToBothPlatformsSeriesWorkflow`, `publishToBothPlatformsUnifiedWorkflow`
- Cleaner separation of concerns

#### `/api/admin/socials/publish-both/`
- **POST** - Publish to both FB & IG (215 lines - **REDUNDANT**)
- Duplicates logic from `/social-posts/[id]/publish`
- Uses workflow: `publishToBothPlatformsUnifiedWorkflow`

---

## Key Issues Identified

### 1. **Route Handler Complexity**
**File**: `/api/admin/social-posts/[id]/publish/route.ts` (351 lines)

**Problems**:
- Business logic embedded in route handler
- Platform detection logic
- Token resolution logic
- Content type detection
- Validation logic
- Smart retry logic
- Post update logic
- All mixed together in one handler

**Should be**: Thin route handler that calls workflows

### 2. **Code Duplication**
**Duplicate Logic Between**:
- `/social-posts/[id]/publish/route.ts`
- `/socials/publish-both/route.ts`

Both implement:
- Platform validation
- Token extraction
- Content type detection
- Post metadata handling
- Insights preservation
- Post update logic

### 3. **Workflow Inconsistency**
**Current Workflows**:
- `publishSocialPostWorkflow` - Used for single platform publishing
- `publishToBothPlatformsSeriesWorkflow` - Sequential publishing
- `publishToBothPlatformsUnifiedWorkflow` - Parallel publishing

**Problems**:
- `/social-posts/[id]/publish` route doesn't use workflows for orchestration
- Direct service calls mixed with workflow calls
- Inconsistent error handling patterns

### 4. **Missing Workflow Steps**
**Should be separate steps**:
- Load post with platform
- Validate platform and credentials
- Resolve tokens (page token, IG token, Twitter OAuth)
- Detect content type
- Validate content compatibility
- Handle smart retry logic
- Publish to platform(s)
- Update post with results
- Preserve insights data

### 5. **Endpoint Confusion**
**Three ways to publish**:
1. `/social-posts/[id]/publish` - Publish existing post
2. `/socials/publish` - Generic publish with content
3. `/socials/publish-both` - Publish to FB & IG

**Unclear**:
- When to use which endpoint?
- Why three different approaches?
- Inconsistent patterns

---

## Recommended Refactoring

### Phase 1: Create Unified Publishing Workflow

#### New Workflow: `publishSocialPostUnifiedWorkflow`

**Steps**:
```typescript
1. loadPostWithPlatformStep
   - Load post by ID
   - Include platform relation
   - Validate post exists

2. validatePlatformAndCredentialsStep
   - Check platform exists
   - Validate access tokens
   - Check OAuth credentials (Twitter)
   - Return platform type

3. resolvePublishTargetStep
   - Determine: facebook, instagram, both, twitter
   - Handle smart retry logic
   - Check previous publish attempts
   - Return target platforms

4. extractContentStep
   - Extract media attachments
   - Extract caption/message
   - Determine content type (photo, video, text, reel, carousel)
   - Return structured content

5. validateContentCompatibilityStep
   - Check platform constraints
   - Twitter: 280 chars, 4 images max
   - Instagram: requires media
   - Validate content type support

6. resolveTokensStep
   - Get page access token (Facebook)
   - Get user access token (Instagram)
   - Get OAuth tokens (Twitter)
   - Return platform-specific tokens

7. publishToTargetPlatformsStep
   - Call appropriate workflow based on target
   - publishToBothPlatformsUnifiedWorkflow (FB/IG)
   - publishToTwitterStep (Twitter)
   - Handle errors per platform

8. mergePublishResultsStep
   - Merge new results with previous attempts
   - Handle retry scenarios
   - Preserve webhook insights data
   - Determine overall success

9. updatePostWithResultsStep
   - Update post status (posted/failed)
   - Set post_url
   - Update insights
   - Set error_message if failed
```

### Phase 2: Simplify Route Handlers

#### Refactored `/social-posts/[id]/publish/route.ts`
```typescript
export const POST = async (
  req: MedusaRequest<PublishSocialPostRequest>,
  res: MedusaResponse
) => {
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

**Benefits**:
- Route handler reduced from 351 lines to ~20 lines
- All business logic in workflow
- Testable workflow steps
- Reusable logic

### Phase 3: Consolidate Endpoints

#### Recommended Structure:
```
/api/admin/social-posts/
  - GET, POST (list, create)
  
/api/admin/social-posts/[id]/
  - GET, POST, DELETE (get, update, delete)
  
/api/admin/social-posts/[id]/publish
  - POST (publish existing post)
  
/api/admin/social-posts/[id]/sync-insights
  - POST (sync insights from platform)
  
/api/admin/social-posts/[id]/update-platform
  - POST (change platform)
```

**Remove**:
- `/socials/publish` - Redundant, use post creation + publish
- `/socials/publish-both` - Redundant, handled by unified workflow

**Keep**:
- `/socials/accounts` - List managed accounts
- `/socials/hashtags` - Hashtag management
- `/socials/mentions` - Mention management
- `/socials/sync-platform-data` - Platform data sync

### Phase 4: Improve Workflow Composition

#### Workflow Hierarchy:
```
publishSocialPostUnifiedWorkflow (main)
  ├── loadPostWithPlatformStep
  ├── validatePlatformAndCredentialsStep
  ├── resolvePublishTargetStep
  ├── extractContentStep
  ├── validateContentCompatibilityStep
  ├── resolveTokensStep
  ├── publishToTargetPlatformsStep
  │   ├── publishToBothPlatformsUnifiedWorkflow (FB/IG)
  │   │   ├── publishToFacebookStep
  │   │   └── publishToInstagramStep
  │   └── publishToTwitterStep
  ├── mergePublishResultsStep
  └── updatePostWithResultsStep
```

---

## Benefits of Refactoring

### 1. **Separation of Concerns**
- Routes handle HTTP concerns only
- Workflows handle business logic
- Services handle platform API calls

### 2. **Testability**
- Each workflow step is independently testable
- Mock dependencies easily
- Test retry logic in isolation

### 3. **Reusability**
- Steps can be reused across workflows
- Common validation logic shared
- Platform-specific logic isolated

### 4. **Maintainability**
- Clear flow of operations
- Easy to add new platforms
- Simple to modify retry logic
- Centralized error handling

### 5. **Observability**
- Workflow execution tracking
- Step-by-step logging
- Easy to debug failures
- Clear rollback points

---

## Migration Strategy

### Step 1: Create New Workflow (No Breaking Changes)
- Implement `publishSocialPostUnifiedWorkflow`
- Create all workflow steps
- Test thoroughly

### Step 2: Update Route Handler
- Replace logic in `/social-posts/[id]/publish` with workflow call
- Keep same API contract
- Maintain backward compatibility

### Step 3: Deprecate Redundant Endpoints
- Mark `/socials/publish` as deprecated
- Mark `/socials/publish-both` as deprecated
- Add deprecation warnings

### Step 4: Remove Deprecated Endpoints
- After migration period, remove old endpoints
- Update documentation
- Update client code

---

## Implementation Priority

### High Priority
1. ✅ Create `publishSocialPostUnifiedWorkflow`
2. ✅ Refactor `/social-posts/[id]/publish` route
3. ✅ Add comprehensive tests

### Medium Priority
4. Deprecate `/socials/publish-both`
5. Update documentation
6. Add workflow execution monitoring

### Low Priority
7. Remove deprecated endpoints
8. Optimize workflow performance
9. Add advanced retry strategies

---

## Conclusion

The current social posts API has grown organically with duplicated logic and mixed concerns. By refactoring to a workflow-based architecture, we can:

- **Reduce complexity** in route handlers
- **Eliminate duplication** between endpoints
- **Improve testability** of business logic
- **Enable better observability** of publishing operations
- **Make it easier** to add new platforms

The refactoring can be done incrementally without breaking existing functionality, making it a low-risk, high-value improvement.

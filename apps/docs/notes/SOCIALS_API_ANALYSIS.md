# Social Media API Architecture Analysis

## Current API Structure

```
/admin/socials/
├── accounts/                    # GET - Fetch FB pages & IG accounts
├── debug-instagram/            # GET - Debug IG account linking
├── facebook/
│   └── pages/                  # POST - Publish by post_id (legacy)
│                              # GET - List FB pages
├── publish/                    # POST - Generic publish endpoint
└── publish-both/              # POST - Publish to FBINSTA platform
```

## Endpoint Analysis

### 1. `/admin/socials/accounts` ✅ **Well-Designed**

**Purpose**: Fetch managed Facebook Pages and Instagram Business accounts

```typescript
GET /admin/socials/accounts?userAccessToken=xxx
```

**Strengths**:
- Clear purpose
- Uses ContentPublishingService
- Good error handling

**Issues**:
- ⚠️ Token in query parameter (should be in header or body)
- ⚠️ No validation schema

---

### 2. `/admin/socials/debug-instagram` 🔧 **Debug Tool**

**Purpose**: Debug Instagram account linking issues

```typescript
GET /admin/socials/debug-instagram?platform_id=xxx
```

**Strengths**:
- Excellent for troubleshooting
- Detailed diagnostics
- Helpful instructions

**Issues**:
- ⚠️ Should be removed in production or protected
- ⚠️ Hardcoded API version (v18.0, should be v24.0)

---

### 3. `/admin/socials/facebook/pages` ⚠️ **Inconsistent**

**Purpose**: Two different operations in one endpoint

```typescript
POST /admin/socials/facebook/pages
Body: { post_id, page_id? }
// Publishes a social post (uses publishSocialPostWorkflow)

GET /admin/socials/facebook/pages?platform_id=xxx
// Lists Facebook pages
```

**Issues**:
- ❌ **Violates REST principles** - POST should not be for publishing
- ❌ **Confusing naming** - "pages" endpoint publishes posts?
- ❌ **Duplicate functionality** - GET overlaps with `/accounts`
- ❌ **Legacy workflow** - Uses old `publishSocialPostWorkflow`

**Recommendation**: 
- Move POST to `/admin/social-posts/:id/publish`
- Remove GET (use `/accounts` instead)
- Or deprecate entirely in favor of standardized endpoints

---

### 4. `/admin/socials/publish` ✅ **Well-Designed**

**Purpose**: Generic publish endpoint for any platform

```typescript
POST /admin/socials/publish?mode=unified
Body: {
  platform: "facebook" | "instagram" | "both",
  pageId?: string,
  igUserId?: string,
  userAccessToken: string,
  content: { type, message, image_url, etc. }
}
```

**Strengths**:
- Platform-agnostic
- Proper validation (Zod schema)
- Supports both series and unified modes
- Good error handling

**Issues**:
- ⚠️ Not used by current UI (UI uses `/publish-both`)
- ⚠️ Token in body (consider header)
- ⚠️ Requires manual content construction

---

### 5. `/admin/socials/publish-both` ✅ **UI-Focused**

**Purpose**: Publish posts created in the UI (FBINSTA platform)

```typescript
POST /admin/socials/publish-both
Body: { post_id: string }
```

**Strengths**:
- Simple API (just post_id)
- Extracts all data from post metadata
- Updates post status after publishing
- Good error messages

**Issues**:
- ⚠️ Name is misleading (can publish to single platform too)
- ⚠️ Only works with FBINSTA platform
- ⚠️ Duplicate functionality with `/publish`

---

## Issues & Inconsistencies

### 1. **Duplicate Functionality**

| Functionality | Endpoint 1 | Endpoint 2 |
|---------------|------------|------------|
| List FB Pages | `/facebook/pages` (GET) | `/accounts` (GET) |
| Publish Post | `/facebook/pages` (POST) | `/publish-both` (POST) |
| Publish Content | `/publish` | `/publish-both` |

### 2. **Naming Inconsistencies**

- `/facebook/pages` - Implies page management, but publishes posts
- `/publish-both` - Implies "both platforms", but can publish to one
- `/accounts` - Generic name, but specifically for FB/IG

### 3. **Authentication Patterns**

- `/accounts` - Token in query parameter
- `/publish` - Token in request body
- `/facebook/pages` - Token from platform.api_config
- `/publish-both` - Token from platform.api_config

### 4. **Workflow Inconsistencies**

- `/facebook/pages` uses `publishSocialPostWorkflow` (old)
- `/publish` uses `publishToBothPlatformsUnifiedWorkflow` (new)
- `/publish-both` uses `publishToBothPlatformsUnifiedWorkflow` (new)

---

## Recommended Standardization

### Option A: Resource-Based REST API (Recommended)

```
/admin/social-posts/              # Social post CRUD
├── [id]/
│   ├── publish                   # POST - Publish a draft post
│   └── unpublish                 # POST - Remove published post

/admin/social-platforms/          # Platform management
├── [id]/
│   ├── accounts                  # GET - List FB pages & IG accounts
│   └── test-connection          # GET - Test platform connection

/admin/socials/                   # Generic operations
└── publish                       # POST - Direct publish (no draft)
```

### Option B: Action-Based API

```
/admin/socials/
├── posts/
│   └── [id]/publish             # POST - Publish existing post
├── content/
│   └── publish                  # POST - Direct publish
├── platforms/
│   ├── [id]/accounts           # GET - List accounts
│   └── [id]/debug              # GET - Debug connection
```

---

## Proposed Refactoring

### Phase 1: Consolidate Publishing

**Remove**:
- ❌ `/admin/socials/facebook/pages` (POST) - Legacy

**Keep**:
- ✅ `/admin/socials/publish-both` → Rename to `/admin/social-posts/:id/publish`
- ✅ `/admin/socials/publish` → Keep for direct publishing

**New Endpoint**:
```typescript
POST /admin/social-posts/:id/publish
Body: {
  override_page_id?: string,    // Optional override
  override_ig_user_id?: string  // Optional override
}

// Extracts everything from post metadata
// Updates post status after publishing
// Returns published URLs
```

### Phase 2: Consolidate Account Management

**Remove**:
- ❌ `/admin/socials/facebook/pages` (GET) - Duplicate

**Keep**:
- ✅ `/admin/socials/accounts` → Rename to `/admin/social-platforms/:id/accounts`

**New Endpoint**:
```typescript
GET /admin/social-platforms/:id/accounts

// Extracts token from platform.api_config
// Returns FB pages and IG accounts
// No token in query parameter
```

### Phase 3: Standardize Authentication

**Current**: Mixed (query params, body, platform config)

**Proposed**: Always use platform.api_config

```typescript
// All endpoints use platform_id
// Token retrieved from platform.api_config
// No tokens in request body/query

POST /admin/social-posts/:id/publish
// Gets token from post.platform.api_config

GET /admin/social-platforms/:id/accounts
// Gets token from platform.api_config
```

### Phase 4: Move Debug Endpoint

**Current**: `/admin/socials/debug-instagram`

**Proposed**: `/admin/social-platforms/:id/debug`

```typescript
GET /admin/social-platforms/:id/debug

// Platform-agnostic debugging
// Works for Facebook, Instagram, or FBINSTA
// Protected by admin permissions
```

---

## Migration Plan

### Step 1: Add New Endpoints (Non-Breaking)

```typescript
// New standardized endpoints
POST /admin/social-posts/:id/publish
GET /admin/social-platforms/:id/accounts
GET /admin/social-platforms/:id/debug
```

### Step 2: Update UI to Use New Endpoints

```typescript
// Update hooks
usePublishSocialPost() → calls /social-posts/:id/publish
useSocialPlatformAccounts() → calls /social-platforms/:id/accounts
```

### Step 3: Deprecate Old Endpoints

```typescript
// Add deprecation warnings
// @deprecated Use /admin/social-posts/:id/publish instead
POST /admin/socials/facebook/pages
POST /admin/socials/publish-both
```

### Step 4: Remove Old Endpoints (Breaking Change)

```typescript
// Remove after migration period
❌ /admin/socials/facebook/pages
❌ /admin/socials/publish-both (or keep as alias)
```

---

## Validation Standardization

### Current State

- `/publish` - Has Zod schema ✅
- `/publish-both` - Has Zod schema ✅
- `/accounts` - No validation ❌
- `/facebook/pages` - No validation ❌

### Proposed

All endpoints should have:
1. **Request validation** (Zod schemas)
2. **Response typing** (TypeScript interfaces)
3. **Error handling** (Consistent MedusaError usage)

```typescript
// Example: validators.ts
export const PublishPostSchema = z.object({
  override_page_id: z.string().optional(),
  override_ig_user_id: z.string().optional(),
})

export const GetAccountsSchema = z.object({
  platform_id: z.string().min(1),
})
```

---

## Error Handling Standardization

### Current Issues

- Mix of `res.status().json()` and `throw MedusaError`
- Inconsistent error messages
- Some endpoints return errors, others throw

### Proposed Standard

```typescript
// Always throw MedusaError
throw new MedusaError(
  MedusaError.Types.INVALID_DATA,
  "Clear, user-friendly error message"
)

// Let MedusaJS handle the response
// Consistent error format across all endpoints
```

---

## Documentation Needs

### API Documentation

Create OpenAPI/Swagger docs:
```yaml
/admin/social-posts/{id}/publish:
  post:
    summary: Publish a social media post
    parameters:
      - name: id
        in: path
        required: true
        schema:
          type: string
    requestBody:
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/PublishPostRequest'
```

### Code Documentation

Add JSDoc comments:
```typescript
/**
 * Publish a social media post to configured platforms
 * 
 * @route POST /admin/social-posts/:id/publish
 * @param {string} id - Social post ID
 * @param {PublishPostRequest} body - Optional overrides
 * @returns {PublishPostResponse} Published post with URLs
 * @throws {MedusaError} If post not found or publishing fails
 */
```

---

## Testing Requirements

### Current State
- No API tests visible
- Manual testing only

### Proposed
```typescript
// Integration tests for each endpoint
describe("POST /admin/social-posts/:id/publish", () => {
  it("should publish to Instagram only", async () => {
    // Test Instagram-only publishing
  })
  
  it("should publish to Facebook only", async () => {
    // Test Facebook-only publishing
  })
  
  it("should publish to both platforms", async () => {
    // Test dual publishing
  })
  
  it("should handle invalid aspect ratios", async () => {
    // Test error handling
  })
})
```

---

## Summary of Recommendations

### Immediate Actions (High Priority)

1. ✅ **Rename `/publish-both`** → `/social-posts/:id/publish`
2. ✅ **Remove `/facebook/pages` POST** (use new endpoint)
3. ✅ **Add validation** to `/accounts` endpoint
4. ✅ **Standardize error handling** across all endpoints
5. ✅ **Update API version** in debug endpoint (v18.0 → v24.0)

### Medium Priority

6. 📝 **Add OpenAPI documentation**
7. 📝 **Create integration tests**
8. 📝 **Add JSDoc comments**
9. 🔒 **Protect debug endpoint** (admin-only)

### Low Priority

10. 🎨 **Consolidate workflows** (remove old `publishSocialPostWorkflow`)
11. 🎨 **Create unified service layer**
12. 🎨 **Add rate limiting**
13. 🎨 **Add request logging**

---

## Benefits of Standardization

✅ **Consistency** - Predictable API patterns  
✅ **Maintainability** - Easier to understand and modify  
✅ **Discoverability** - Clear resource hierarchy  
✅ **Type Safety** - Full TypeScript coverage  
✅ **Documentation** - Self-documenting code  
✅ **Testing** - Easier to write comprehensive tests  
✅ **Scalability** - Easy to add new platforms  

---

## Next Steps

1. **Review this analysis** with the team
2. **Prioritize changes** based on impact
3. **Create implementation tickets**
4. **Start with high-priority items**
5. **Update UI incrementally**
6. **Monitor for issues**
7. **Document changes**

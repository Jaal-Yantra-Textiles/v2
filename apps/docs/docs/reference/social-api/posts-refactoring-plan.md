---
title: "Social Posts Publishing Refactoring - Implementation Plan"
sidebar_label: "Posts Refactoring Plan"
sidebar_position: 5
---

# Social Posts Publishing Refactoring - Implementation Plan

## Overview

This document outlines the step-by-step implementation plan for refactoring the social posts publishing system from route-heavy logic to workflow-based orchestration.

---

## Current Problems Summary

### 1. Route Handler Complexity
- `/api/admin/social-posts/[id]/publish/route.ts` - **351 lines**
- Contains all business logic directly in route handler
- Difficult to test, maintain, and extend

### 2. Code Duplication
- Logic duplicated between:
  - `/social-posts/[id]/publish`
  - `/socials/publish-both`
- Same validation, token resolution, content detection repeated

### 3. Inconsistent Patterns
- Some routes use workflows
- Others use direct service calls
- Mixed error handling approaches

---

## Refactoring Goals

1. ✅ **Thin route handlers** - Only HTTP concerns
2. ✅ **Workflow orchestration** - Business logic in workflows
3. ✅ **Reusable steps** - Shared across workflows
4. ✅ **Testable components** - Each step independently testable
5. ✅ **Clear separation** - Routes → Workflows → Services → APIs

---

## Implementation Steps

### Step 0: Security Foundation - Token Encryption ⭐ **CRITICAL**

Before storing any tokens, implement encryption to protect sensitive data.

#### 0.0 Create Encryption Service
**File**: `/src/services/encryption-service.ts`

```typescript
import crypto from "crypto"
import { MedusaError } from "@medusajs/utils"

interface EncryptedData {
  encrypted: string      // Base64 encoded encrypted data
  iv: string            // Base64 encoded initialization vector
  authTag: string       // Base64 encoded authentication tag
  keyVersion: number    // For key rotation support
}

export class EncryptionService {
  private readonly algorithm = "aes-256-gcm"
  private readonly keyVersion: number
  private readonly encryptionKey: Buffer

  constructor() {
    const keyString = process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY_V1
    
    if (!keyString) {
      throw new Error("ENCRYPTION_KEY not found in environment variables")
    }

    const keyBuffer = Buffer.from(keyString, "base64")
    if (keyBuffer.length !== 32) {
      throw new Error("Invalid encryption key length. Must be 32 bytes for AES-256")
    }

    this.encryptionKey = keyBuffer
    this.keyVersion = parseInt(process.env.ENCRYPTION_KEY_VERSION || "1", 10)
  }

  encrypt(plaintext: string): EncryptedData {
    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv(this.algorithm, this.encryptionKey, iv)
    
    let encrypted = cipher.update(plaintext, "utf8", "base64")
    encrypted += cipher.final("base64")
    
    const authTag = cipher.getAuthTag()

    return {
      encrypted,
      iv: iv.toString("base64"),
      authTag: authTag.toString("base64"),
      keyVersion: this.keyVersion,
    }
  }

  decrypt(encryptedData: EncryptedData): string {
    const key = this.getKeyForVersion(encryptedData.keyVersion)
    const iv = Buffer.from(encryptedData.iv, "base64")
    const authTag = Buffer.from(encryptedData.authTag, "base64")

    const decipher = crypto.createDecipheriv(this.algorithm, key, iv)
    decipher.setAuthTag(authTag)

    let decrypted = decipher.update(encryptedData.encrypted, "base64", "utf8")
    decrypted += decipher.final("utf8")

    return decrypted
  }

  private getKeyForVersion(version: number): Buffer {
    if (version === this.keyVersion) {
      return this.encryptionKey
    }

    const oldKeyString = process.env[`ENCRYPTION_KEY_V${version}`]
    if (!oldKeyString) {
      throw new Error(`Encryption key version ${version} not found`)
    }

    return Buffer.from(oldKeyString, "base64")
  }
}

// Singleton
let instance: EncryptionService | null = null
export function getEncryptionService(): EncryptionService {
  if (!instance) {
    instance = new EncryptionService()
  }
  return instance
}
```

**Generate Encryption Key:**
```bash
# Generate a secure 256-bit key
openssl rand -base64 32

# Add to .env
ENCRYPTION_KEY=<generated-key>
ENCRYPTION_KEY_VERSION=1
```

**See full implementation**: `/docs/implementation/security/encryption-service`

---

### Step 1: Create API Config Schema (Foundation)

After encryption is in place, establish the schema foundation for platform configurations.

#### 0.1 Create Schema Definitions
**File**: `/src/schemas/platform-api-config.ts`

```typescript
import { z } from "zod"

// Base schema for all platforms
const BasePlatformConfigSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.enum(["USER", "PAGE", "APP"]),
  expires_at: z.string().optional(),
  refresh_token: z.string().optional(),
  scopes: z.array(z.string()).optional(),
  authenticated_at: z.string(),
  last_refreshed_at: z.string().optional(),
})

// Facebook schema
const FacebookApiConfigSchema = BasePlatformConfigSchema.extend({
  platform: z.literal("facebook"),
  token_type: z.literal("PAGE"),
  user_id: z.string(),
  page_id: z.string(),
  page_access_token: z.string(),
  user_access_token: z.string().optional(),
  // ... see full schema in /docs/reference/social-api/config-schema
})

// Instagram schema
const InstagramApiConfigSchema = BasePlatformConfigSchema.extend({
  platform: z.literal("instagram"),
  token_type: z.literal("USER"),
  user_id: z.string(),
  ig_user_id: z.string(),
  page_id: z.string(),
  // ... see full schema in /docs/reference/social-api/config-schema
})

// FBINSTA schema
const FBINSTAApiConfigSchema = BasePlatformConfigSchema.extend({
  platform: z.literal("fbinsta"),
  token_type: z.literal("PAGE"),
  user_id: z.string(),
  page_id: z.string(),
  page_access_token: z.string(),
  ig_user_id: z.string(),
  user_access_token: z.string(),
  // ... see full schema in /docs/reference/social-api/config-schema
})

// Twitter schema
const TwitterApiConfigSchema = BasePlatformConfigSchema.extend({
  platform: z.enum(["twitter", "x"]),
  token_type: z.literal("USER"),
  user_id: z.string(),
  oauth1_credentials: z.object({
    access_token: z.string(),
    access_token_secret: z.string(),
  }).optional(),
  // ... see full schema in /docs/reference/social-api/config-schema
})

// Union type for all platforms
export const PlatformApiConfigSchema = z.discriminatedUnion("platform", [
  FacebookApiConfigSchema,
  InstagramApiConfigSchema,
  FBINSTAApiConfigSchema,
  TwitterApiConfigSchema,
])

export type PlatformApiConfig = z.infer<typeof PlatformApiConfigSchema>
export type FacebookApiConfig = z.infer<typeof FacebookApiConfigSchema>
export type InstagramApiConfig = z.infer<typeof InstagramApiConfigSchema>
export type FBINSTAApiConfig = z.infer<typeof FBINSTAApiConfigSchema>
export type TwitterApiConfig = z.infer<typeof TwitterApiConfigSchema>
```

#### 0.2 Update OAuth Callback to Validate and Store Schema
**File**: `/src/api/admin/oauth/[platform]/callback/route.ts`

```typescript
import { PlatformApiConfigSchema } from "../../../../schemas/platform-api-config"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const platform = req.params.platform
  const { code } = req.query

  // Exchange code for tokens
  const tokens = await exchangeCodeForToken(code, platform)

  // Build platform-specific config
  const apiConfig = await buildPlatformConfig(platform, tokens)

  // Validate against schema
  const validation = PlatformApiConfigSchema.safeParse(apiConfig)
  
  if (!validation.success) {
    console.error("API config validation failed:", validation.error)
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Invalid API config: ${validation.error.message}`
    )
  }

  // Store validated config
  await socials.updateSocialPlatforms([{
    selector: { id: platformId },
    data: {
      api_config: validation.data,
      status: "active",
    },
  }])

  res.redirect("/admin/social-platforms")
}

// Helper to build platform-specific config
async function buildPlatformConfig(platform: string, tokens: any) {
  switch (platform) {
    case "facebook":
      return {
        platform: "facebook",
        access_token: tokens.page_access_token,
        token_type: "PAGE",
        page_id: tokens.page_id,
        page_access_token: tokens.page_access_token,
        user_access_token: tokens.user_access_token,
        user_id: tokens.user_id,
        scopes: tokens.scopes,
        authenticated_at: new Date().toISOString(),
        expires_at: tokens.expires_at,
      }
    
    case "instagram":
      return {
        platform: "instagram",
        access_token: tokens.access_token,
        token_type: "USER",
        user_id: tokens.user_id,
        ig_user_id: tokens.ig_user_id,
        page_id: tokens.page_id,
        scopes: tokens.scopes,
        authenticated_at: new Date().toISOString(),
        expires_at: tokens.expires_at,
      }
    
    // ... other platforms
  }
}
```

**Benefits**:
- ✅ **Type-safe** config storage at OAuth time
- ✅ **Runtime validation** prevents invalid data
- ✅ **Self-documenting** structure
- ✅ **Easier debugging** with clear error messages

---

### Step 1: Create Workflow Steps

#### 1.1 Load Post Step
**File**: `/src/workflows/socials/steps/load-post.ts`

```typescript
import { createStep, StepResponse } from "@medusajs/workflows-sdk"
import { MedusaError } from "@medusajs/utils"
import { SOCIALS_MODULE } from "../../../modules/socials"
import SocialsService from "../../../modules/socials/service"

interface LoadPostInput {
  post_id: string
}

export const loadPostWithPlatformStep = createStep(
  "load-post-with-platform",
  async (input: LoadPostInput, { container }) => {
    const socials = container.resolve(SOCIALS_MODULE) as SocialsService

    const [post] = await socials.listSocialPosts(
      { id: input.post_id },
      { relations: ["platform"] }
    )

    if (!post) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Social post ${input.post_id} not found`
      )
    }

    return new StepResponse(post)
  }
)
```

#### 1.2 Validate Platform Step
**File**: `/src/workflows/socials/steps/validate-platform.ts`

```typescript
import { createStep, StepResponse } from "@medusajs/workflows-sdk"
import { MedusaError } from "@medusajs/utils"
import { PlatformApiConfigSchema } from "../../../schemas/platform-api-config"

interface ValidatePlatformInput {
  post: any
}

export const validatePlatformAndCredentialsStep = createStep(
  "validate-platform-and-credentials",
  async (input: ValidatePlatformInput) => {
    const platform = input.post.platform

    if (!platform) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Post has no associated platform"
      )
    }

    const platformName = (platform.name || "").toLowerCase()
    const apiConfig = platform.api_config

    if (!apiConfig) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Platform has no API configuration. Please authenticate the platform."
      )
    }

    // Validate API config against schema
    const validation = PlatformApiConfigSchema.safeParse(apiConfig)
    
    if (!validation.success) {
      console.error("API config validation failed:", validation.error)
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Invalid platform configuration. Please re-authenticate: ${validation.error.message}`
      )
    }

    const validatedConfig = validation.data
    const userAccessToken = validatedConfig.access_token

    if (!userAccessToken) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "No access token found in platform configuration. Please re-authenticate."
      )
    }

    // Check token expiration
    if (validatedConfig.expires_at) {
      const expiresAt = new Date(validatedConfig.expires_at)
      if (expiresAt < new Date()) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Access token has expired. Please re-authenticate the platform."
        )
      }
    }

    return new StepResponse({
      platform,
      platformName,
      apiConfig: validatedConfig,
      userAccessToken,
    })
  }
)
```

#### 1.3 Resolve Publish Target Step
**File**: `/src/workflows/socials/steps/resolve-publish-target.ts`

```typescript
import { createStep, StepResponse } from "@medusajs/workflows-sdk"

interface ResolvePublishTargetInput {
  post: any
  platformName: string
  override_page_id?: string
  override_ig_user_id?: string
}

export const resolvePublishTargetStep = createStep(
  "resolve-publish-target",
  async (input: ResolvePublishTargetInput) => {
    const metadata = (input.post.metadata || {}) as Record<string, any>
    const pageId = input.override_page_id || metadata.page_id
    const igUserId = input.override_ig_user_id || metadata.ig_user_id
    let publishTarget = metadata.publish_target || "both"

    // Check for previous publish attempts
    const currentInsights = (input.post.insights || {}) as Record<string, any>
    const previousResults = (currentInsights.publish_results || []) as any[]

    // Smart retry logic
    const isFBINSTA = input.platformName === "fbinsta" || 
                      input.platformName === "facebook & instagram"

    if (isFBINSTA && publishTarget === "both" && previousResults.length > 0) {
      const facebookSucceeded = previousResults.some(
        (r: any) => r.platform === "facebook" && r.success
      )
      const instagramSucceeded = previousResults.some(
        (r: any) => r.platform === "instagram" && r.success
      )
      const facebookFailed = previousResults.some(
        (r: any) => r.platform === "facebook" && !r.success
      )
      const instagramFailed = previousResults.some(
        (r: any) => r.platform === "instagram" && !r.success
      )

      if (facebookSucceeded && instagramFailed) {
        publishTarget = "instagram"
        console.log("🔄 Smart retry: Publishing only to Instagram")
      } else if (instagramSucceeded && facebookFailed) {
        publishTarget = "facebook"
        console.log("🔄 Smart retry: Publishing only to Facebook")
      }
    }

    return new StepResponse({
      publishTarget,
      pageId,
      igUserId,
      previousResults,
      currentInsights,
    })
  }
)
```

#### 1.4 Extract Content Step
**File**: `/src/workflows/socials/steps/extract-content.ts`

```typescript
import { createStep, StepResponse } from "@medusajs/workflows-sdk"

interface ExtractContentInput {
  post: any
}

export const extractContentStep = createStep(
  "extract-content",
  async (input: ExtractContentInput) => {
    const mediaAttachments = (input.post.media_attachments || []) as Array<{
      type: string
      url: string
    }>
    const caption = input.post.caption || ""

    // Determine content type
    let contentType: "photo" | "video" | "text" | "reel" | "carousel" = "text"
    let imageUrl: string | undefined
    let imageUrls: string[] | undefined
    let videoUrl: string | undefined

    const imageAttachments = mediaAttachments.filter((a) => a.type === "image")
    const videoAttachment = mediaAttachments.find((a) => a.type === "video")

    if (imageAttachments.length > 1) {
      contentType = "carousel"
      imageUrls = imageAttachments.map((a) => a.url)
    } else if (imageAttachments.length === 1) {
      contentType = "photo"
      imageUrl = imageAttachments[0].url
    } else if (videoAttachment) {
      contentType = "reel"
      videoUrl = videoAttachment.url
    } else if (caption) {
      contentType = "text"
    }

    return new StepResponse({
      contentType,
      caption,
      imageUrl,
      imageUrls,
      videoUrl,
      mediaAttachments,
    })
  }
)
```

#### 1.5 Validate Content Compatibility Step
**File**: `/src/workflows/socials/steps/validate-content-compatibility.ts`

```typescript
import { createStep, StepResponse } from "@medusajs/workflows-sdk"
import { MedusaError } from "@medusajs/utils"

interface ValidateContentInput {
  platformName: string
  publishTarget: string
  contentType: string
  caption: string
  imageAttachments: any[]
  videoAttachment?: any
}

export const validateContentCompatibilityStep = createStep(
  "validate-content-compatibility",
  async (input: ValidateContentInput) => {
    // Instagram requires media
    if (
      input.contentType === "text" &&
      (input.publishTarget === "instagram" || input.publishTarget === "both")
    ) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Text-only posts are not supported on Instagram. Please add media."
      )
    }

    // Video to both platforms not supported yet
    if (input.contentType === "reel" && input.publishTarget === "both") {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Video/reel posts to both platforms are not yet supported."
      )
    }

    // Twitter-specific validation
    if (input.platformName === "twitter" || input.platformName === "x") {
      if (input.caption && input.caption.length > 280) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Tweet text exceeds 280 characters (${input.caption.length})`
        )
      }

      if (input.imageAttachments.length > 4) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Twitter supports maximum 4 images (${input.imageAttachments.length} provided)`
        )
      }

      if (input.videoAttachment && input.imageAttachments.length > 0) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Twitter does not support mixing images and videos"
        )
      }
    }

    return new StepResponse({ validated: true })
  }
)
```

#### 1.6 Merge Results Step
**File**: `/src/workflows/socials/steps/merge-results.ts`

```typescript
import { createStep, StepResponse } from "@medusajs/workflows-sdk"

interface MergeResultsInput {
  previousResults: any[]
  newResults: any[]
  currentInsights: Record<string, any>
}

export const mergePublishResultsStep = createStep(
  "merge-publish-results",
  async (input: MergeResultsInput) => {
    const mergedResults = [...input.previousResults]

    // Replace or add new results
    input.newResults.forEach((newResult: any) => {
      const existingIndex = mergedResults.findIndex(
        (r: any) => r.platform === newResult.platform
      )
      if (existingIndex >= 0) {
        mergedResults[existingIndex] = newResult
      } else {
        mergedResults.push(newResult)
      }
    })

    const allPlatformsSucceeded = mergedResults.every((r: any) => r.success)
    const anyPlatformFailed = mergedResults.some((r: any) => !r.success)

    const insights: Record<string, any> = {
      ...input.currentInsights,
      publish_results: mergedResults,
      published_at: new Date().toISOString(),
      last_retry_at: input.previousResults.length > 0 
        ? new Date().toISOString() 
        : undefined,
    }

    return new StepResponse({
      mergedResults,
      allPlatformsSucceeded,
      anyPlatformFailed,
      insights,
    })
  }
)
```

#### 1.7 Update Post Step
**File**: `/src/workflows/socials/steps/update-post.ts`

```typescript
import { createStep, StepResponse } from "@medusajs/workflows-sdk"
import { SOCIALS_MODULE } from "../../../modules/socials"
import SocialsService from "../../../modules/socials/service"

interface UpdatePostInput {
  post_id: string
  allPlatformsSucceeded: boolean
  anyPlatformFailed: boolean
  mergedResults: any[]
  insights: Record<string, any>
  postUrl?: string
}

export const updatePostWithResultsStep = createStep(
  "update-post-with-results",
  async (input: UpdatePostInput, { container }) => {
    const socials = container.resolve(SOCIALS_MODULE) as SocialsService

    const errorMessage = input.anyPlatformFailed
      ? input.mergedResults
          .filter((r: any) => !r.success)
          .map((r: any) => `${r.platform}: ${r.error}`)
          .join("; ")
      : null

    const [updatedPost] = await socials.updateSocialPosts([
      {
        selector: { id: input.post_id },
        data: {
          status: input.allPlatformsSucceeded ? "posted" : "failed",
          posted_at: input.allPlatformsSucceeded ? new Date() : null,
          post_url: input.postUrl,
          insights: input.insights,
          error_message: errorMessage,
        },
      },
    ])

    return new StepResponse(updatedPost)
  }
)
```

### Step 2: Create Main Workflow

**File**: `/src/workflows/socials/publish-social-post-unified.ts`

```typescript
import {
  createWorkflow,
  WorkflowData,
  WorkflowResponse,
  transform,
} from "@medusajs/workflows-sdk"
import { loadPostWithPlatformStep } from "./steps/load-post"
import { validatePlatformAndCredentialsStep } from "./steps/validate-platform"
import { resolvePublishTargetStep } from "./steps/resolve-publish-target"
import { extractContentStep } from "./steps/extract-content"
import { validateContentCompatibilityStep } from "./steps/validate-content-compatibility"
import { mergePublishResultsStep } from "./steps/merge-results"
import { updatePostWithResultsStep } from "./steps/update-post"
import { publishToBothPlatformsUnifiedWorkflow } from "./publish-to-both-platforms"
import { publishSocialPostWorkflow } from "./publish-post"

interface PublishSocialPostUnifiedInput {
  post_id: string
  override_page_id?: string
  override_ig_user_id?: string
}

export const publishSocialPostUnifiedWorkflow = createWorkflow(
  "publish-social-post-unified",
  function (input: WorkflowData<PublishSocialPostUnifiedInput>) {
    // Step 1: Load post with platform
    const post = loadPostWithPlatformStep({ post_id: input.post_id })

    // Step 2: Validate platform and credentials
    const platformInfo = validatePlatformAndCredentialsStep({ post })

    // Step 3: Resolve publish target (with smart retry)
    const targetInfo = resolvePublishTargetStep({
      post,
      platformName: transform(platformInfo, (p) => p.platformName),
      override_page_id: input.override_page_id,
      override_ig_user_id: input.override_ig_user_id,
    })

    // Step 4: Extract content
    const content = extractContentStep({ post })

    // Step 5: Validate content compatibility
    validateContentCompatibilityStep({
      platformName: transform(platformInfo, (p) => p.platformName),
      publishTarget: transform(targetInfo, (t) => t.publishTarget),
      contentType: transform(content, (c) => c.contentType),
      caption: transform(content, (c) => c.caption),
      imageAttachments: transform(content, (c) => 
        c.mediaAttachments.filter((a: any) => a.type === "image")
      ),
      videoAttachment: transform(content, (c) => 
        c.mediaAttachments.find((a: any) => a.type === "video")
      ),
    })

    // Step 6: Publish based on platform
    const platformName = transform(platformInfo, (p) => p.platformName)
    const isTwitter = transform(platformName, (name) => 
      name === "twitter" || name === "x"
    )

    // Branch: Twitter vs Facebook/Instagram
    const publishResult = transform(
      { isTwitter, post, targetInfo, content, platformInfo },
      async (data) => {
        if (data.isTwitter) {
          // Use existing Twitter workflow
          const { result } = await publishSocialPostWorkflow.run({
            input: { post_id: data.post.id },
          })
          return result
        } else {
          // Use unified FB/IG workflow
          const { result } = await publishToBothPlatformsUnifiedWorkflow.run({
            input: {
              pageId: data.targetInfo.pageId || "",
              igUserId: data.targetInfo.igUserId || "",
              userAccessToken: data.platformInfo.userAccessToken,
              publishTarget: data.targetInfo.publishTarget,
              content: {
                type: data.content.contentType,
                message: data.content.caption,
                caption: data.content.caption,
                image_url: data.content.imageUrl,
                image_urls: data.content.imageUrls,
                video_url: data.content.videoUrl,
              },
            },
          })
          return result
        }
      }
    )

    // Step 7: Merge results with previous attempts
    const mergedResults = mergePublishResultsStep({
      previousResults: transform(targetInfo, (t) => t.previousResults),
      newResults: transform(publishResult, (r) => r.results || []),
      currentInsights: transform(targetInfo, (t) => t.currentInsights),
    })

    // Step 8: Update post with results
    const updatedPost = updatePostWithResultsStep({
      post_id: input.post_id,
      allPlatformsSucceeded: transform(mergedResults, (m) => m.allPlatformsSucceeded),
      anyPlatformFailed: transform(mergedResults, (m) => m.anyPlatformFailed),
      mergedResults: transform(mergedResults, (m) => m.mergedResults),
      insights: transform(mergedResults, (m) => m.insights),
      postUrl: transform(publishResult, (r) => r.postUrl),
    })

    return new WorkflowResponse({
      success: transform(mergedResults, (m) => m.allPlatformsSucceeded),
      post: updatedPost,
      results: transform(mergedResults, (m) => m.mergedResults),
      retry_info: transform(targetInfo, (t) => ({
        is_retry: t.previousResults.length > 0,
        previous_attempts: t.previousResults.length,
      })),
    })
  }
)
```

### Step 3: Refactor Route Handler

**File**: `/src/api/admin/social-posts/[id]/publish/route.ts` (NEW)

```typescript
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/utils"
import { publishSocialPostUnifiedWorkflow } from "../../../../../workflows/socials/publish-social-post-unified"
import type { PublishSocialPostRequest } from "./validators"

/**
 * POST /admin/social-posts/:id/publish
 * 
 * Publish a social media post to configured platforms
 */
export const POST = async (
  req: MedusaRequest<PublishSocialPostRequest>,
  res: MedusaResponse
) => {
  const postId = req.params.id

  if (!postId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_ARGUMENT,
      "Post ID is required"
    )
  }

  const { override_page_id, override_ig_user_id } = req.validatedBody

  try {
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
  } catch (error) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Publishing failed: ${error.message}`
    )
  }
}
```

**Result**: Route handler reduced from **351 lines** to **~45 lines**

---

## Testing Strategy

### Unit Tests for Workflow Steps

```typescript
// Test load post step
describe("loadPostWithPlatformStep", () => {
  it("should load post with platform relation", async () => {
    // Test implementation
  })

  it("should throw error if post not found", async () => {
    // Test implementation
  })
})

// Test validate platform step
describe("validatePlatformAndCredentialsStep", () => {
  it("should validate platform exists", async () => {
    // Test implementation
  })

  it("should validate access token exists", async () => {
    // Test implementation
  })

  it("should validate Twitter OAuth credentials", async () => {
    // Test implementation
  })
})

// Test smart retry logic
describe("resolvePublishTargetStep", () => {
  it("should detect failed Facebook and retry only Facebook", async () => {
    // Test implementation
  })

  it("should detect failed Instagram and retry only Instagram", async () => {
    // Test implementation
  })
})
```

### Integration Tests

```typescript
describe("POST /admin/social-posts/:id/publish", () => {
  it("should publish to Facebook successfully", async () => {
    // Test implementation
  })

  it("should publish to Instagram successfully", async () => {
    // Test implementation
  })

  it("should publish to both platforms", async () => {
    // Test implementation
  })

  it("should handle smart retry after partial failure", async () => {
    // Test implementation
  })

  it("should publish to Twitter successfully", async () => {
    // Test implementation
  })
})
```

---

## Migration Checklist

### Phase 0: Security & Schema Foundation ⭐ **START HERE**
- [ ] **Encryption Service**
  - [ ] Create `/src/services/encryption-service.ts`
  - [ ] Generate encryption keys for all environments
  - [ ] Add encryption keys to environment variables
  - [ ] Add unit tests for encryption/decryption
  - [ ] Test key rotation support
- [ ] **Schema Definition**
  - [ ] Create `/src/schemas/platform-api-config.ts` with encrypted field schemas
  - [ ] Create helper functions for token encryption/decryption
  - [ ] Add schema validation to OAuth callback handlers
  - [ ] Test OAuth flow with encryption + validation
- [ ] **Data Migration**
  - [ ] Create migration script to encrypt existing tokens
  - [ ] Backup database before migration
  - [ ] Run migration on staging environment
  - [ ] Verify all platforms work after migration
  - [ ] Run migration on production

### Phase 1: Workflow Implementation
- [ ] Create workflow steps directory structure
- [ ] Implement all workflow steps with schema validation
- [ ] Create unified workflow
- [ ] Add comprehensive unit tests for each step
- [ ] Add integration tests for complete workflow

### Phase 2: Route Refactoring
- [ ] Update `/social-posts/[id]/publish` route handler
- [ ] Maintain backward compatibility
- [ ] Test all publishing scenarios (FB, IG, Twitter, FBINSTA)
- [ ] Test smart retry logic
- [ ] Test error handling

### Phase 3: Documentation & Deployment
- [ ] Update API documentation
- [ ] Document schema structure for each platform
- [ ] Test in staging environment
- [ ] Deploy to production
- [ ] Monitor for errors

### Phase 4: Cleanup
- [ ] Mark `/socials/publish-both` as deprecated
- [ ] Add deprecation warnings
- [ ] Remove deprecated endpoints (after grace period)

---

## Success Metrics

### Before Refactoring
- Route handler: **351 lines**
- Code duplication: **High**
- Testability: **Low**
- Maintainability: **Low**

### After Refactoring
- Route handler: **~45 lines** (87% reduction)
- Code duplication: **None**
- Testability: **High** (each step independently testable)
- Maintainability: **High** (clear separation of concerns)

---

## Conclusion

This refactoring will transform the social posts publishing system from a monolithic route handler to a well-structured, workflow-based architecture. The benefits include:

- ✅ **Reduced complexity** - Thin route handlers
- ✅ **Improved testability** - Independent workflow steps
- ✅ **Better maintainability** - Clear separation of concerns
- ✅ **Enhanced observability** - Workflow execution tracking
- ✅ **Easier extensibility** - Add new platforms easily

The implementation can be done incrementally without breaking existing functionality.

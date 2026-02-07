---
title: "Social Platform API Config Schema"
sidebar_label: "Config Schema"
sidebar_position: 3
---

# Social Platform API Config Schema

## Overview

Each social platform stores its credentials and configuration in the `api_config` field. This document defines the schema for each platform to ensure consistency and enable validation.

---

## Schema Structure

### Base Schema (All Platforms)

```typescript
interface BasePlatformConfig {
  access_token: string           // Primary access token
  token_type: "USER" | "PAGE" | "APP"
  expires_at?: string            // ISO timestamp
  refresh_token?: string         // For token refresh
  scopes?: string[]              // Granted permissions
  authenticated_at: string       // ISO timestamp
  last_refreshed_at?: string     // ISO timestamp
}
```

---

## Platform-Specific Schemas

### 1. Facebook

```typescript
interface FacebookApiConfig extends BasePlatformConfig {
  platform: "facebook"
  token_type: "PAGE"             // Always PAGE token for publishing
  
  // User info
  user_id: string
  user_name?: string
  user_email?: string
  
  // Page info
  page_id: string
  page_name?: string
  page_access_token: string      // Explicit page token
  
  // Original user token (for reference)
  user_access_token?: string
  
  // Metadata
  metadata?: {
    pages?: Array<{
      id: string
      name: string
      access_token: string
      category?: string
      tasks?: string[]
    }>
  }
}
```

**Example:**
```json
{
  "platform": "facebook",
  "access_token": "EAABwzLixnjYBO...",
  "token_type": "PAGE",
  "page_id": "123456789",
  "page_name": "My Business Page",
  "page_access_token": "EAABwzLixnjYBO...",
  "user_access_token": "EAABwzLixnjYBO...",
  "user_id": "987654321",
  "user_name": "John Doe",
  "scopes": ["pages_show_list", "pages_manage_posts", "pages_read_engagement"],
  "authenticated_at": "2024-01-15T10:30:00Z",
  "expires_at": "2024-04-15T10:30:00Z",
  "metadata": {
    "pages": [
      {
        "id": "123456789",
        "name": "My Business Page",
        "access_token": "EAABwzLixnjYBO...",
        "category": "Business",
        "tasks": ["ANALYZE", "ADVERTISE", "MODERATE", "CREATE_CONTENT"]
      }
    ]
  }
}
```

---

### 2. Instagram

```typescript
interface InstagramApiConfig extends BasePlatformConfig {
  platform: "instagram"
  token_type: "USER"
  
  // User info
  user_id: string
  username?: string
  
  // Instagram Business Account
  ig_user_id: string
  ig_username?: string
  
  // Connected Facebook Page
  page_id: string
  page_name?: string
  
  // Metadata
  metadata?: {
    ig_accounts?: Array<{
      id: string
      username: string
      profile_picture_url?: string
      followers_count?: number
      follows_count?: number
      media_count?: number
    }>
  }
}
```

**Example:**
```json
{
  "platform": "instagram",
  "access_token": "EAABwzLixnjYBO...",
  "token_type": "USER",
  "user_id": "987654321",
  "ig_user_id": "17841405793187218",
  "ig_username": "mybusiness",
  "page_id": "123456789",
  "page_name": "My Business Page",
  "scopes": ["instagram_basic", "instagram_content_publish"],
  "authenticated_at": "2024-01-15T10:30:00Z",
  "expires_at": "2024-04-15T10:30:00Z",
  "metadata": {
    "ig_accounts": [
      {
        "id": "17841405793187218",
        "username": "mybusiness",
        "profile_picture_url": "https://...",
        "followers_count": 1250,
        "media_count": 45
      }
    ]
  }
}
```

---

### 3. FBINSTA (Facebook & Instagram Combined)

```typescript
interface FBINSTAApiConfig extends BasePlatformConfig {
  platform: "fbinsta"
  token_type: "PAGE"
  
  // User info
  user_id: string
  user_name?: string
  
  // Facebook Page
  page_id: string
  page_name?: string
  page_access_token: string
  
  // Instagram Business Account
  ig_user_id: string
  ig_username?: string
  
  // Original user token
  user_access_token: string
  
  // Metadata
  metadata?: {
    pages?: Array<{
      id: string
      name: string
      access_token: string
      ig_accounts?: Array<{
        id: string
        username: string
      }>
    }>
    ig_accounts?: Array<{
      id: string
      username: string
      connected_page_id: string
    }>
  }
}
```

**Example:**
```json
{
  "platform": "fbinsta",
  "access_token": "EAABwzLixnjYBO...",
  "token_type": "PAGE",
  "user_id": "987654321",
  "user_name": "John Doe",
  "page_id": "123456789",
  "page_name": "My Business Page",
  "page_access_token": "EAABwzLixnjYBO...",
  "ig_user_id": "17841405793187218",
  "ig_username": "mybusiness",
  "user_access_token": "EAABwzLixnjYBO...",
  "scopes": [
    "pages_show_list",
    "pages_manage_posts",
    "pages_read_engagement",
    "instagram_basic",
    "instagram_content_publish"
  ],
  "authenticated_at": "2024-01-15T10:30:00Z",
  "expires_at": "2024-04-15T10:30:00Z",
  "metadata": {
    "pages": [
      {
        "id": "123456789",
        "name": "My Business Page",
        "access_token": "EAABwzLixnjYBO...",
        "ig_accounts": [
          {
            "id": "17841405793187218",
            "username": "mybusiness"
          }
        ]
      }
    ],
    "ig_accounts": [
      {
        "id": "17841405793187218",
        "username": "mybusiness",
        "connected_page_id": "123456789"
      }
    ]
  }
}
```

---

### 4. Twitter/X

```typescript
interface TwitterApiConfig extends BasePlatformConfig {
  platform: "twitter" | "x"
  
  // OAuth 2.0 User Context (for tweets)
  access_token: string           // OAuth 2.0 Bearer token
  token_type: "USER"
  refresh_token?: string
  
  // OAuth 1.0a User Credentials (for media upload)
  oauth1_credentials?: {
    access_token: string
    access_token_secret: string
  }
  
  // OAuth 1.0a App Credentials (alternative for media upload)
  oauth1_app_credentials?: {
    consumer_key: string         // or api_key
    consumer_secret: string      // or api_secret
  }
  
  // App-only Bearer Token (alternative)
  app_bearer_token?: string
  
  // User info
  user_id: string
  username?: string
  name?: string
  
  // Metadata
  metadata?: {
    profile_image_url?: string
    followers_count?: number
    following_count?: number
    tweet_count?: number
    verified?: boolean
  }
}
```

**Example (OAuth 2.0 User Context):**
```json
{
  "platform": "twitter",
  "access_token": "bG9uZ1VzZXJBY2Nlc3NUb2tlbg==",
  "token_type": "USER",
  "refresh_token": "cmVmcmVzaFRva2VuRm9yVXNlcg==",
  "oauth1_credentials": {
    "access_token": "123456-abcdef",
    "access_token_secret": "secret123"
  },
  "user_id": "123456789",
  "username": "mybusiness",
  "name": "My Business",
  "scopes": ["tweet.read", "tweet.write", "users.read"],
  "authenticated_at": "2024-01-15T10:30:00Z",
  "expires_at": "2024-01-15T12:30:00Z",
  "metadata": {
    "profile_image_url": "https://...",
    "followers_count": 5000,
    "tweet_count": 1234,
    "verified": false
  }
}
```

---

## Schema Validation

### Zod Schemas for Validation

```typescript
import { z } from "zod"

// Base schema
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
  user_name: z.string().optional(),
  user_email: z.string().email().optional(),
  page_id: z.string(),
  page_name: z.string().optional(),
  page_access_token: z.string(),
  user_access_token: z.string().optional(),
  metadata: z.object({
    pages: z.array(z.object({
      id: z.string(),
      name: z.string(),
      access_token: z.string(),
      category: z.string().optional(),
      tasks: z.array(z.string()).optional(),
    })).optional(),
  }).optional(),
})

// Instagram schema
const InstagramApiConfigSchema = BasePlatformConfigSchema.extend({
  platform: z.literal("instagram"),
  token_type: z.literal("USER"),
  user_id: z.string(),
  username: z.string().optional(),
  ig_user_id: z.string(),
  ig_username: z.string().optional(),
  page_id: z.string(),
  page_name: z.string().optional(),
  metadata: z.object({
    ig_accounts: z.array(z.object({
      id: z.string(),
      username: z.string(),
      profile_picture_url: z.string().url().optional(),
      followers_count: z.number().optional(),
      follows_count: z.number().optional(),
      media_count: z.number().optional(),
    })).optional(),
  }).optional(),
})

// FBINSTA schema
const FBINSTAApiConfigSchema = BasePlatformConfigSchema.extend({
  platform: z.literal("fbinsta"),
  token_type: z.literal("PAGE"),
  user_id: z.string(),
  user_name: z.string().optional(),
  page_id: z.string(),
  page_name: z.string().optional(),
  page_access_token: z.string(),
  ig_user_id: z.string(),
  ig_username: z.string().optional(),
  user_access_token: z.string(),
  metadata: z.object({
    pages: z.array(z.object({
      id: z.string(),
      name: z.string(),
      access_token: z.string(),
      ig_accounts: z.array(z.object({
        id: z.string(),
        username: z.string(),
      })).optional(),
    })).optional(),
    ig_accounts: z.array(z.object({
      id: z.string(),
      username: z.string(),
      connected_page_id: z.string(),
    })).optional(),
  }).optional(),
})

// Twitter schema
const TwitterApiConfigSchema = BasePlatformConfigSchema.extend({
  platform: z.enum(["twitter", "x"]),
  token_type: z.literal("USER"),
  refresh_token: z.string().optional(),
  oauth1_credentials: z.object({
    access_token: z.string(),
    access_token_secret: z.string(),
  }).optional(),
  oauth1_app_credentials: z.object({
    consumer_key: z.string(),
    consumer_secret: z.string(),
  }).optional(),
  app_bearer_token: z.string().optional(),
  user_id: z.string(),
  username: z.string().optional(),
  name: z.string().optional(),
  metadata: z.object({
    profile_image_url: z.string().url().optional(),
    followers_count: z.number().optional(),
    following_count: z.number().optional(),
    tweet_count: z.number().optional(),
    verified: z.boolean().optional(),
  }).optional(),
})

// Union type for all platforms
export const PlatformApiConfigSchema = z.discriminatedUnion("platform", [
  FacebookApiConfigSchema,
  InstagramApiConfigSchema,
  FBINSTAApiConfigSchema,
  TwitterApiConfigSchema,
])

export type PlatformApiConfig = z.infer<typeof PlatformApiConfigSchema>
```

---

## Usage in OAuth Callback

### Updated OAuth Callback Handler

```typescript
// /src/api/admin/oauth/[platform]/callback/route.ts

import { PlatformApiConfigSchema } from "../../../../schemas/platform-api-config"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const platform = req.params.platform
  const { code, state } = req.query

  // Exchange code for tokens
  const tokens = await exchangeCodeForToken(code, platform)

  // Build platform-specific config
  let apiConfig: any

  switch (platform) {
    case "facebook": {
      const userToken = tokens.access_token
      const pages = await fb.listManagedPages(userToken)
      const selectedPage = pages[0] // or from state
      const pageToken = await fb.getPageAccessToken(selectedPage.id, userToken)

      apiConfig = {
        platform: "facebook",
        access_token: pageToken,
        token_type: "PAGE",
        page_id: selectedPage.id,
        page_name: selectedPage.name,
        page_access_token: pageToken,
        user_access_token: userToken,
        user_id: tokens.user_id,
        user_name: tokens.user_name,
        scopes: tokens.scopes,
        authenticated_at: new Date().toISOString(),
        expires_at: tokens.expires_at,
        metadata: {
          pages: pages.map(p => ({
            id: p.id,
            name: p.name,
            access_token: p.access_token,
            category: p.category,
            tasks: p.tasks,
          })),
        },
      }
      break
    }

    case "instagram": {
      const userToken = tokens.access_token
      const pages = await fb.listManagedPages(userToken)
      const igAccounts = await fb.getInstagramAccounts(pages[0].id, userToken)
      const selectedIgAccount = igAccounts[0]

      apiConfig = {
        platform: "instagram",
        access_token: userToken,
        token_type: "USER",
        user_id: tokens.user_id,
        ig_user_id: selectedIgAccount.id,
        ig_username: selectedIgAccount.username,
        page_id: pages[0].id,
        page_name: pages[0].name,
        scopes: tokens.scopes,
        authenticated_at: new Date().toISOString(),
        expires_at: tokens.expires_at,
        metadata: {
          ig_accounts: igAccounts.map(ig => ({
            id: ig.id,
            username: ig.username,
            profile_picture_url: ig.profile_picture_url,
            followers_count: ig.followers_count,
            media_count: ig.media_count,
          })),
        },
      }
      break
    }

    case "fbinsta": {
      const userToken = tokens.access_token
      const pages = await fb.listManagedPages(userToken)
      const selectedPage = pages[0]
      const pageToken = await fb.getPageAccessToken(selectedPage.id, userToken)
      const igAccounts = await fb.getInstagramAccounts(selectedPage.id, userToken)

      apiConfig = {
        platform: "fbinsta",
        access_token: pageToken,
        token_type: "PAGE",
        user_id: tokens.user_id,
        user_name: tokens.user_name,
        page_id: selectedPage.id,
        page_name: selectedPage.name,
        page_access_token: pageToken,
        ig_user_id: igAccounts[0]?.id,
        ig_username: igAccounts[0]?.username,
        user_access_token: userToken,
        scopes: tokens.scopes,
        authenticated_at: new Date().toISOString(),
        expires_at: tokens.expires_at,
        metadata: {
          pages: pages.map(p => ({
            id: p.id,
            name: p.name,
            access_token: p.access_token,
            ig_accounts: p.ig_accounts?.map(ig => ({
              id: ig.id,
              username: ig.username,
            })),
          })),
          ig_accounts: igAccounts.map(ig => ({
            id: ig.id,
            username: ig.username,
            connected_page_id: selectedPage.id,
          })),
        },
      }
      break
    }

    case "twitter":
    case "x": {
      apiConfig = {
        platform: platform,
        access_token: tokens.access_token,
        token_type: "USER",
        refresh_token: tokens.refresh_token,
        oauth1_credentials: tokens.oauth1_credentials,
        user_id: tokens.user_id,
        username: tokens.username,
        name: tokens.name,
        scopes: tokens.scopes,
        authenticated_at: new Date().toISOString(),
        expires_at: tokens.expires_at,
        metadata: {
          profile_image_url: tokens.profile_image_url,
          followers_count: tokens.followers_count,
          following_count: tokens.following_count,
          verified: tokens.verified,
        },
      }
      break
    }
  }

  // Validate the config against schema
  const validation = PlatformApiConfigSchema.safeParse(apiConfig)
  
  if (!validation.success) {
    console.error("API config validation failed:", validation.error)
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Invalid API config structure: ${validation.error.message}`
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
```

---

## Benefits

### 1. **Type Safety**
- TypeScript interfaces for each platform
- Compile-time type checking
- IDE autocomplete support

### 2. **Runtime Validation**
- Zod schemas validate at OAuth time
- Catch configuration errors early
- Prevent invalid data storage

### 3. **Self-Documenting**
- Clear structure for each platform
- Example configs for reference
- Easy to understand requirements

### 4. **Easier Debugging**
- Consistent structure across platforms
- Clear field naming conventions
- Metadata for additional context

### 5. **Workflow Simplification**
- Workflows can rely on consistent structure
- No need for defensive checks
- Clear error messages when validation fails

---

## Migration Strategy

### Step 1: Add Schema Validation
- Create schema file with Zod definitions
- Add validation to OAuth callback
- Test with new authentications

### Step 2: Validate Existing Data
- Create migration script to validate existing platforms
- Log validation errors
- Fix or migrate invalid configs

### Step 3: Update Workflows
- Use typed interfaces in workflow steps
- Remove defensive null checks
- Rely on validated structure

### Step 4: Documentation
- Update API documentation
- Add examples for each platform
- Document required fields

---

## Conclusion

By enforcing a structured schema for `api_config`, we ensure:
- ✅ **Consistency** across all platforms
- ✅ **Type safety** in TypeScript
- ✅ **Runtime validation** at OAuth time
- ✅ **Self-documenting** code
- ✅ **Easier debugging** and maintenance

This makes the publishing workflows more robust and easier to maintain.

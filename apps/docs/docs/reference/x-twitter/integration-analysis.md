---
title: "X (Twitter) Integration Analysis & Implementation Plan"
sidebar_label: "Integration Analysis"
sidebar_position: 2
---

# X (Twitter) Integration Analysis & Implementation Plan

## 📊 Current State Assessment

### ✅ What's Already Implemented

1. **TwitterService** (`src/modules/social-provider/twitter-service.ts`)
   - OAuth 2.0 PKCE flow for user authentication
   - App-only OAuth 2.0 (client credentials) flow
   - Token refresh functionality
   - Basic tweet fetching (`getTweet()`)
   - Environment variable support for both X and Twitter prefixes

2. **OAuth Integration**
   - OAuth initiation endpoint: `/api/admin/oauth/[platform]/route.ts`
   - OAuth callback handler: `/api/admin/oauth/[platform]/callback/route.ts`
   - Token refresh workflow: `src/workflows/socials/refresh-token.ts`

3. **Social Platform Infrastructure**
   - Social platform model with `api_config` storage
   - Social post model with media attachments
   - Workflow infrastructure for publishing

### ❌ What's Missing

1. **Tweet Publishing**
   - No `createTweet()` or `publishTweet()` methods
   - No media upload implementation
   - No integration with publishing workflows

2. **Media Upload**
   - Twitter API v2 doesn't support media uploads
   - Must use v1.1 API (`POST media/upload`) with OAuth 1.0a
   - Requires separate authentication flow

3. **Insights/Analytics**
   - No tweet metrics fetching
   - No webhook support for real-time updates
   - No engagement tracking

4. **Publishing Workflow**
   - Twitter not integrated in `publish-post.ts` workflow
   - Not supported in `publish-to-both-platforms.ts`
   - No Twitter-specific publish endpoint

## 🏗️ Twitter/X API Architecture

### Authentication Flow

**For Publishing (OAuth 2.0):**
```
User → OAuth 2.0 PKCE → Access Token → Create Tweet (v2)
```

**For Media Upload (OAuth 1.0a):**
```
API Key + API Secret + Access Token + Access Token Secret → Upload Media (v1.1) → Media ID
```

### Publishing Process

1. **Upload Media** (if needed)
   - Endpoint: `POST https://upload.twitter.com/1.1/media/upload.json`
   - Auth: OAuth 1.0a
   - Returns: `media_id`

2. **Create Tweet**
   - Endpoint: `POST https://api.x.com/2/tweets`
   - Auth: OAuth 2.0 Bearer token
   - Body:
     ```json
     {
       "text": "Tweet content",
       "media": {
         "media_ids": ["media_id_1", "media_id_2"]
       }
     }
     ```

### Required Credentials

**OAuth 2.0 (for tweets):**
- `X_CLIENT_ID` / `TWITTER_CLIENT_ID`
- `X_CLIENT_SECRET` / `TWITTER_CLIENT_SECRET`

**OAuth 1.0a (for media):**
- `X_API_KEY` / `TWITTER_API_KEY`
- `X_API_SECRET` / `TWITTER_API_SECRET`
- User's `ACCESS_TOKEN`
- User's `ACCESS_TOKEN_SECRET`

## 📋 Implementation Plan

### Phase 1: Media Upload Support

**File:** `src/modules/social-provider/twitter-service.ts`

Add methods:
```typescript
/**
 * Upload media using OAuth 1.0a (v1.1 API)
 * Required for attaching images/videos to tweets
 */
async uploadMedia(
  imageUrl: string,
  oauth1Credentials: {
    apiKey: string
    apiSecret: string
    accessToken: string
    accessTokenSecret: string
  }
): Promise<string> // Returns media_id
```

**Implementation:**
1. Download image from URL
2. Use OAuth 1.0a signature generation
3. POST to `https://upload.twitter.com/1.1/media/upload.json`
4. Extract and return `media_id_string`

### Phase 2: Tweet Publishing

**File:** `src/modules/social-provider/twitter-service.ts`

Add methods:
```typescript
/**
 * Create a tweet using OAuth 2.0 (v2 API)
 */
async createTweet(
  content: {
    text: string
    mediaIds?: string[]
  },
  accessToken: string
): Promise<{
  id: string
  text: string
}>

/**
 * Publish tweet with media (combines upload + create)
 */
async publishTweetWithMedia(
  content: {
    text: string
    imageUrls?: string[]
    videoUrl?: string
  },
  oauth2Token: string,
  oauth1Credentials: {
    apiKey: string
    apiSecret: string
    accessToken: string
    accessTokenSecret: string
  }
): Promise<{
  tweetId: string
  tweetUrl: string
}>
```

### Phase 3: Workflow Integration

**File:** `src/workflows/socials/publish-post.ts`

Add Twitter support:
```typescript
// In resolveTokensStep
if (providerName === "twitter" || providerName === "x") {
  return new StepResponse({ 
    providerName, 
    accessToken: userAccessToken,
    oauth1Credentials: extractOAuth1Credentials(platform)
  })
}

// In publishStep
if (input.providerName === "twitter" || input.providerName === "x") {
  const twitter = new TwitterService()
  const results: any[] = []
  
  // Upload media if present
  const mediaIds: string[] = []
  for (const att of imageAttachments) {
    const mediaId = await twitter.uploadMedia(att.url, input.oauth1Credentials)
    mediaIds.push(mediaId)
  }
  
  // Create tweet
  const tweet = await twitter.createTweet(
    { text: message, mediaIds },
    input.accessToken
  )
  
  results.push({ 
    kind: "tweet", 
    tweetId: tweet.id,
    response: tweet 
  })
  
  return new StepResponse(results)
}
```

### Phase 4: API Endpoints

**File:** `src/api/admin/social-posts/[id]/publish/route.ts`

Update to support Twitter:
```typescript
// Add Twitter validation
const platformName = (platform.name || "").toLowerCase()
if (platformName === "twitter" || platformName === "x") {
  // Validate OAuth 1.0a credentials exist
  const oauth1 = apiConfig.oauth1_credentials
  if (!oauth1?.access_token || !oauth1?.access_token_secret) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Twitter requires OAuth 1.0a credentials for media upload"
    )
  }
}
```

### Phase 5: Insights & Analytics

**File:** `src/modules/social-provider/twitter-service.ts`

Add methods:
```typescript
/**
 * Get tweet metrics
 */
async getTweetMetrics(
  tweetId: string,
  accessToken: string
): Promise<{
  impressions: number
  likes: number
  retweets: number
  replies: number
  quotes: number
}>

/**
 * Get user's tweets with metrics
 */
async getUserTweets(
  userId: string,
  accessToken: string,
  options?: {
    maxResults?: number
    sinceId?: string
  }
): Promise<Array<{
  id: string
  text: string
  created_at: string
  metrics: TweetMetrics
}>>
```

### Phase 6: Webhook Support (Optional)

Twitter doesn't provide webhooks in the free tier, but for paid tiers:

**File:** `src/api/webhooks/social/twitter/route.ts`

```typescript
/**
 * GET /webhooks/social/twitter
 * Twitter CRC (Challenge-Response Check) verification
 */
export const GET = async (req, res) => {
  const crc_token = req.query.crc_token
  const hmac = crypto
    .createHmac('sha256', process.env.TWITTER_CONSUMER_SECRET)
    .update(crc_token)
    .digest('base64')
  
  return res.json({
    response_token: `sha256=${hmac}`
  })
}

/**
 * POST /webhooks/social/twitter
 * Receive tweet events
 */
export const POST = async (req, res) => {
  // Process tweet events
  // Update insights in database
}
```

## 🔧 Required Environment Variables

Add to `.env`:
```bash
# OAuth 2.0 (for creating tweets)
X_CLIENT_ID=your_client_id
X_CLIENT_SECRET=your_client_secret

# OAuth 1.0a (for media uploads)
X_API_KEY=your_api_key
X_API_SECRET=your_api_secret

# Optional: Webhook secret (paid tier only)
X_WEBHOOK_ENV=production
X_CONSUMER_SECRET=your_consumer_secret
```

## 📝 Data Model Updates

### SocialPlatform `api_config` Structure

```typescript
{
  access_token: string          // OAuth 2.0 access token
  refresh_token: string          // OAuth 2.0 refresh token
  expires_at: number            // Token expiration timestamp
  
  // OAuth 1.0a credentials (stored after user auth)
  oauth1_credentials: {
    access_token: string
    access_token_secret: string
  }
  
  // User info
  metadata: {
    user_id: string
    username: string
    name: string
    profile_image_url: string
  }
}
```

### SocialPost `insights` Structure

```typescript
{
  twitter_tweet_id: string
  twitter_insights: {
    impressions: number
    likes: number
    retweets: number
    replies: number
    quotes: number
    bookmarks: number
    last_updated: string
  }
  publish_results: Array<{
    platform: "twitter"
    success: boolean
    tweetId: string
    error?: string
  }>
}
```

## 🎯 Content Type Support

| Content Type | Twitter Support | Implementation |
|-------------|----------------|----------------|
| Text only | ✅ Yes | Direct tweet creation |
| Single image | ✅ Yes | Upload media → Create tweet |
| Multiple images (2-4) | ✅ Yes | Upload all → Create tweet with media_ids |
| Video | ✅ Yes | Upload video → Create tweet |
| GIF | ✅ Yes | Upload GIF → Create tweet |
| Polls | ⚠️ Possible | Requires poll_options in tweet payload |
| Threads | ⚠️ Possible | Multiple tweet creation with reply_settings |

## 🚀 Testing Strategy

### 1. Unit Tests

Test individual methods:
```typescript
describe("TwitterService", () => {
  it("should upload media and return media_id", async () => {
    const mediaId = await twitter.uploadMedia(imageUrl, oauth1Creds)
    expect(mediaId).toMatch(/^\d+$/)
  })
  
  it("should create tweet with text only", async () => {
    const tweet = await twitter.createTweet({ text: "Hello" }, token)
    expect(tweet.id).toBeDefined()
  })
  
  it("should create tweet with media", async () => {
    const tweet = await twitter.createTweet(
      { text: "Hello", mediaIds: ["123"] },
      token
    )
    expect(tweet.id).toBeDefined()
  })
})
```

### 2. Integration Tests

Test full publishing flow:
```typescript
describe("Twitter Publishing", () => {
  it("should publish tweet with image", async () => {
    const result = await publishSocialPostWorkflow.run({
      input: {
        post_id: twitterPostId,
      }
    })
    expect(result.status).toBe("posted")
    expect(result.post_url).toContain("twitter.com")
  })
})
```

### 3. Manual Testing

1. Authenticate with Twitter OAuth
2. Create post with text + image
3. Publish via API
4. Verify tweet appears on Twitter
5. Check insights are fetched correctly

## 📊 API Rate Limits

### Free Tier (Basic)
- **Tweet creation**: 1,500 tweets per month
- **Media upload**: Included in tweet limit
- **Read tweets**: 10,000 per month

### Paid Tiers
- **Pro**: 300,000 tweets per month
- **Enterprise**: Custom limits

## 🔒 Security Considerations

1. **OAuth 1.0a Credentials**
   - Store securely in `api_config`
   - Never expose in API responses
   - Encrypt at rest

2. **Token Management**
   - Refresh OAuth 2.0 tokens before expiry
   - Handle token revocation gracefully
   - Implement retry logic for 401 errors

3. **Media Handling**
   - Validate image URLs before upload
   - Limit file sizes (max 5MB for images)
   - Support HTTPS URLs only

## 📚 References

- [Twitter API v2 Documentation](https://developer.x.com/en/docs/twitter-api)
- [Media Upload API](https://developer.x.com/en/docs/x-api/v1/media/upload-media/overview)
- [Tweet Creation](https://developer.x.com/en/docs/twitter-api/tweets/manage-tweets/api-reference/post-tweets)
- [OAuth 2.0 PKCE](https://developer.x.com/en/docs/authentication/oauth-2-0/authorization-code)
- [OAuth 1.0a](https://developer.x.com/en/docs/authentication/oauth-1-0a)

## 🎯 Success Criteria

- [ ] Can authenticate users via OAuth 2.0
- [ ] Can upload images using OAuth 1.0a
- [ ] Can create text-only tweets
- [ ] Can create tweets with single image
- [ ] Can create tweets with multiple images (up to 4)
- [ ] Can create tweets with video
- [ ] Can fetch tweet metrics
- [ ] Proper error handling for rate limits
- [ ] Token refresh works automatically
- [ ] Integration tests pass
- [ ] Documentation complete

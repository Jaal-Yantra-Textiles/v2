---
title: "X (Twitter) Integration - Testing Guide"
sidebar_label: "X/Twitter Testing"
sidebar_position: 7
---

# X (Twitter) Integration - Testing Guide

## 🎯 What's Been Implemented

### ✅ Core Features Ready
1. **TwitterService** - Media upload, tweet creation, metrics fetching
2. **Workflow Integration** - Twitter support in `publish-post.ts`
3. **API Validation** - Character limits, media limits, OAuth checks
4. **Post Updates** - Tweet URLs and IDs stored in database

### ⚠️ What's Missing
1. **OAuth 1.0a Storage** - Need to store credentials during OAuth callback
2. **Integration Tests** - Automated tests not yet created
3. **Insights Polling** - No automatic metrics fetching (webhooks not available in free tier)

## 🔧 Setup Requirements

### 1. Twitter Developer Account

1. Go to https://developer.x.com
2. Create a new app
3. Get credentials:
   - **OAuth 2.0**: Client ID, Client Secret
   - **OAuth 1.0a**: API Key, API Secret

### 2. Environment Variables

Add to `/Users/saranshsharma/Documents/jyt/.env`:

```bash
# OAuth 2.0 (for creating tweets)
X_CLIENT_ID=your_client_id_here
X_CLIENT_SECRET=your_client_secret_here

# OAuth 1.0a (for media uploads)
X_API_KEY=your_api_key_here
X_API_SECRET=your_api_secret_here
```

### 3. Twitter App Permissions

In your Twitter App settings, ensure you have:
- ✅ Read and Write permissions
- ✅ OAuth 2.0 enabled
- ✅ Callback URL configured (e.g., `http://localhost:9000/admin/oauth/twitter/callback`)

## 📝 Manual Testing Steps

### Step 1: Create Twitter Platform

```bash
# Via Admin API
POST http://localhost:9000/admin/social-platforms
Authorization: Bearer {admin_token}
Content-Type: application/json

{
  "name": "Twitter",
  "provider": "twitter",
  "is_active": true
}
```

**Expected Response:**
```json
{
  "social_platform": {
    "id": "sp_twitter_123",
    "name": "Twitter",
    "provider": "twitter",
    "is_active": true
  }
}
```

### Step 2: Authenticate (OAuth Flow)

**Currently Manual - OAuth 1.0a Storage Not Automated Yet**

For now, you need to manually update the platform with OAuth 1.0a credentials:

```bash
# Update platform with both OAuth 2.0 and OAuth 1.0a credentials
PATCH http://localhost:9000/admin/social-platforms/sp_twitter_123
Authorization: Bearer {admin_token}
Content-Type: application/json

{
  "api_config": {
    "access_token": "oauth2_access_token_from_twitter",
    "refresh_token": "oauth2_refresh_token_from_twitter",
    "expires_at": 1234567890000,
    "oauth1_credentials": {
      "access_token": "your_oauth1_access_token",
      "access_token_secret": "your_oauth1_access_token_secret"
    }
  }
}
```

**Note:** In production, this should be automated in the OAuth callback handler.

### Step 3: Create Social Post

```bash
POST http://localhost:9000/admin/social-posts
Authorization: Bearer {admin_token}
Content-Type: application/json

{
  "platform_id": "sp_twitter_123",
  "caption": "Testing Twitter integration! 🚀",
  "media_attachments": [
    {
      "type": "image",
      "url": "https://example.com/test-image.jpg"
    }
  ],
  "status": "draft"
}
```

**Expected Response:**
```json
{
  "social_post": {
    "id": "post_123",
    "platform_id": "sp_twitter_123",
    "caption": "Testing Twitter integration! 🚀",
    "status": "draft",
    "media_attachments": [...]
  }
}
```

### Step 4: Publish Tweet

```bash
POST http://localhost:9000/admin/social-posts/post_123/publish
Authorization: Bearer {admin_token}
Content-Type: application/json

{}
```

**Expected Response:**
```json
{
  "success": true,
  "post": {
    "id": "post_123",
    "status": "posted",
    "posted_at": "2025-01-13T16:30:00.000Z",
    "post_url": "https://twitter.com/i/web/status/1234567890",
    "insights": {
      "twitter_tweet_id": "1234567890",
      "publish_results": [
        {
          "kind": "tweet",
          "tweetId": "1234567890",
          "tweetUrl": "https://twitter.com/i/web/status/1234567890"
        }
      ]
    }
  }
}
```

### Step 5: Verify on Twitter

1. Open the `post_url` in your browser
2. Verify the tweet appears on your Twitter account
3. Check that the image is attached
4. Verify the text matches your caption

## 🧪 Test Cases

### ✅ Text-Only Tweet

```json
{
  "platform_id": "sp_twitter_123",
  "caption": "Hello Twitter! This is a text-only tweet.",
  "status": "draft"
}
```

**Expected:** Tweet created successfully without media

### ✅ Tweet with Single Image

```json
{
  "platform_id": "sp_twitter_123",
  "caption": "Check out this image!",
  "media_attachments": [
    {
      "type": "image",
      "url": "https://picsum.photos/800/600"
    }
  ],
  "status": "draft"
}
```

**Expected:** Tweet with image attached

### ✅ Tweet with Multiple Images (2-4)

```json
{
  "platform_id": "sp_twitter_123",
  "caption": "Multiple images test",
  "media_attachments": [
    { "type": "image", "url": "https://picsum.photos/800/600?random=1" },
    { "type": "image", "url": "https://picsum.photos/800/600?random=2" },
    { "type": "image", "url": "https://picsum.photos/800/600?random=3" }
  ],
  "status": "draft"
}
```

**Expected:** Tweet with all images attached

### ❌ Tweet Exceeding 280 Characters

```json
{
  "platform_id": "sp_twitter_123",
  "caption": "This is a very long tweet that exceeds the 280 character limit. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit.",
  "status": "draft"
}
```

**Expected Error:**
```json
{
  "type": "invalid_data",
  "message": "Tweet text exceeds 280 characters (350 characters)"
}
```

### ❌ Tweet with More Than 4 Images

```json
{
  "platform_id": "sp_twitter_123",
  "caption": "Too many images",
  "media_attachments": [
    { "type": "image", "url": "https://picsum.photos/800/600?random=1" },
    { "type": "image", "url": "https://picsum.photos/800/600?random=2" },
    { "type": "image", "url": "https://picsum.photos/800/600?random=3" },
    { "type": "image", "url": "https://picsum.photos/800/600?random=4" },
    { "type": "image", "url": "https://picsum.photos/800/600?random=5" }
  ],
  "status": "draft"
}
```

**Expected Error:**
```json
{
  "type": "invalid_data",
  "message": "Twitter supports maximum 4 images per tweet (5 provided)"
}
```

### ❌ Missing OAuth 1.0a Credentials

If platform doesn't have `oauth1_credentials`:

**Expected Error:**
```json
{
  "type": "invalid_data",
  "message": "Twitter requires OAuth 1.0a credentials for media upload. Please re-authenticate."
}
```

## 🔍 Debugging

### Check Logs

```bash
# In your terminal where the server is running
# Look for these log messages:

# ✅ Success
"Twitter media upload successful: media_id_123"
"Tweet created: tweet_id_456"
"Post updated with tweet URL"

# ❌ Errors
"Media upload failed: 401 - Invalid OAuth signature"
"Tweet creation failed: 403 - Forbidden"
"Failed to update post: post_id not found"
```

### Common Issues

1. **"Invalid OAuth signature"**
   - Check that `X_API_KEY` and `X_API_SECRET` are correct
   - Verify OAuth 1.0a credentials in platform `api_config`

2. **"Forbidden" or "Unauthorized"**
   - Check OAuth 2.0 access token is valid
   - Verify app has read/write permissions
   - Token may have expired - refresh it

3. **"Media upload failed"**
   - Check image URL is publicly accessible
   - Verify image format (JPEG, PNG, GIF supported)
   - Check file size (max 5MB for images)

4. **"Tweet not appearing on Twitter"**
   - Check `post_url` in response
   - Verify you're logged into correct Twitter account
   - Check Twitter API rate limits (1,500 tweets/month on free tier)

## 📊 Monitoring

### Check Post Status

```bash
GET http://localhost:9000/admin/social-posts/post_123
Authorization: Bearer {admin_token}
```

**Response includes:**
- `status`: "draft" | "posted" | "failed"
- `post_url`: Link to tweet
- `insights.twitter_tweet_id`: Tweet ID
- `insights.publish_results`: Full publish details

### Fetch Tweet Metrics (Manual)

```bash
# This requires implementing a separate endpoint
# For now, you can test the service method directly:

import TwitterService from './src/modules/social-provider/twitter-service'

const twitter = new TwitterService()
const metrics = await twitter.getTweetMetrics(
  'tweet_id_123',
  'oauth2_access_token'
)

console.log(metrics)
// { impressions: 100, likes: 5, retweets: 2, replies: 1, quotes: 0 }
```

## ✅ Success Criteria

- [ ] Can create Twitter platform
- [ ] Can authenticate (manual OAuth 1.0a setup)
- [ ] Can create social post with text
- [ ] Can create social post with image
- [ ] Can create social post with multiple images (2-4)
- [ ] Can publish tweet successfully
- [ ] Tweet appears on Twitter with correct content
- [ ] Post URL is correct format
- [ ] Tweet ID stored in database
- [ ] Character limit validation works
- [ ] Image limit validation works
- [ ] OAuth 1.0a validation works

## 🚀 Next Steps After Testing

1. **Automate OAuth 1.0a Storage**
   - Update OAuth callback handler
   - Store credentials automatically during auth flow

2. **Create Integration Tests**
   - Automated test suite
   - Mock Twitter API responses
   - Test error scenarios

3. **Implement Insights Polling**
   - Scheduled job to fetch metrics
   - Update post insights periodically
   - Display metrics in admin UI

4. **Add Video Support**
   - Implement chunked upload for large videos
   - Handle video processing status

5. **UI Updates**
   - Twitter-specific post creation form
   - Character counter (280 limit)
   - Image preview (max 4)
   - Tweet preview

---

**Last Updated:** 2025-01-13
**Status:** Core implementation complete, ready for manual testing

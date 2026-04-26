# Post Insights Sync System

## Overview

Comprehensive post insights sync system that fetches all relevant data from social platforms (Instagram, Facebook, Twitter, LinkedIn) and stores it in the `insights` JSON field of social posts.

## Features

### Data Collected

**Engagement Metrics:**
- ❤️ Likes/Reactions
- 💬 Comments (with full comment data)
- 🔄 Shares/Retweets
- 🔖 Saves (Instagram)
- 📊 Total Engagement

**Reach & Impressions:**
- 👁️ Impressions (total views)
- 👥 Reach (unique users)
- 📈 Engagement Rate (%)

**Video Metrics (if applicable):**
- ▶️ Video Views
- ⏱️ Average Watch Time
- ✅ Complete Views

**Platform-Specific:**
- **Facebook**: Detailed reactions (Like, Love, Wow, Haha, Sad, Angry)
- **Instagram**: Profile visits, follows, saves
- **Twitter**: Retweets, quote tweets
- **LinkedIn**: Professional engagement metrics

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Social Post (status: "posted")                 │
│  insights: {                                    │
│    facebook_post_id: "123456"                   │
│    instagram_media_id: "789012"                 │
│  }                                              │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│  POST /admin/social-posts/:id/sync-insights     │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│  PostInsightsService                            │
│  - syncInstagramInsights()                      │
│  - syncFacebookInsights()                       │
│  - syncTwitterInsights()                        │
│  - syncLinkedInInsights()                       │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│  Platform APIs                                  │
│  - Instagram: /media/{id}, /media/{id}/insights │
│  - Facebook: /{post-id}, /{post-id}/insights    │
│  - Twitter: /tweets/{id}                        │
│  - LinkedIn: /socialActions/{id}                │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│  Store in insights field                        │
│  {                                              │
│    platform: "instagram",                       │
│    likes: 150,                                  │
│    comments: 25,                                │
│    impressions: 5000,                           │
│    reach: 3500,                                 │
│    engagement_rate: 5.0,                        │
│    last_synced_at: "2025-11-15T14:00:00Z"      │
│  }                                              │
└─────────────────────────────────────────────────┘
```

## API Endpoints

### 1. Sync Single Post Insights

```http
POST /admin/social-posts/:id/sync-insights
```

**Response:**
```json
{
  "message": "Insights synced successfully",
  "insights": {
    "platform": "instagram",
    "platform_post_id": "18123456789",
    "permalink": "https://www.instagram.com/p/ABC123/",
    "likes": 150,
    "comments": 25,
    "shares": 10,
    "saves": 30,
    "impressions": 5000,
    "reach": 3500,
    "engagement": 215,
    "engagement_rate": 6.14,
    "instagram_insights": {
      "impressions": 5000,
      "reach": 3500,
      "engagement": 215,
      "saved": 30,
      "profile_visits": 45,
      "follows": 12
    },
    "comments_data": [
      {
        "id": "17890",
        "text": "Love this!",
        "from": { "id": "user123", "name": "user123" },
        "created_time": "2025-11-15T10:30:00Z",
        "like_count": 5
      }
    ],
    "last_synced_at": "2025-11-15T14:00:00Z",
    "sync_status": "success"
  }
}
```

### 2. Bulk Sync All Posts

```http
POST /admin/social-posts/sync-all-insights?platform_id=xxx&limit=50
```

**Query Parameters:**
- `platform_id` (optional): Sync only posts from specific platform
- `limit` (optional): Limit number of posts (default: 50)

**Response:**
```json
{
  "message": "Synced insights for 45 posts",
  "success": 45,
  "failed": 5,
  "total": 50,
  "results": [
    {
      "postId": "post_01",
      "status": "success"
    },
    {
      "postId": "post_02",
      "status": "failed",
      "error": "Platform post ID not found"
    }
  ]
}
```

## Instagram Insights

### API Calls

```typescript
// 1. Get media details
GET /{media-id}?fields=id,media_type,permalink,caption,timestamp,like_count,comments_count

// 2. Get insights metrics
GET /{media-id}/insights?metric=impressions,reach,engagement,saved,profile_visits,follows,shares

// 3. Get comments
GET /{media-id}/comments?fields=id,text,username,timestamp,like_count&limit=100

// 4. Get video insights (if video/reel)
GET /{media-id}/insights?metric=video_views,total_interactions
```

### Data Stored

```json
{
  "platform": "instagram",
  "media_type": "IMAGE",
  "permalink": "https://www.instagram.com/p/ABC123/",
  "likes": 150,
  "comments": 25,
  "impressions": 5000,
  "reach": 3500,
  "engagement": 215,
  "engagement_rate": 6.14,
  "saves": 30,
  "instagram_insights": {
    "impressions": 5000,
    "reach": 3500,
    "engagement": 215,
    "saved": 30,
    "profile_visits": 45,
    "follows": 12,
    "shares": 10
  },
  "video_views": 2500,
  "comments_data": [...]
}
```

## Facebook Insights

### API Calls

```typescript
// 1. Get post details
GET /{post-id}?fields=id,message,created_time,permalink_url,shares,reactions.summary(true),comments.summary(true)

// 2. Get detailed reactions
GET /{post-id}/reactions?type=LIKE&summary=total_count
GET /{post-id}/reactions?type=LOVE&summary=total_count
// ... for each reaction type

// 3. Get insights
GET /{post-id}/insights?metric=post_impressions,post_impressions_unique,post_engaged_users,post_clicks

// 4. Get comments
GET /{post-id}/comments?fields=id,message,from,created_time,like_count&limit=100
```

### Data Stored

```json
{
  "platform": "facebook",
  "permalink": "https://www.facebook.com/123/posts/456",
  "likes": 200,
  "comments": 35,
  "shares": 15,
  "reactions": {
    "like": 120,
    "love": 50,
    "wow": 15,
    "haha": 10,
    "sad": 3,
    "angry": 2,
    "total": 200
  },
  "impressions": 8000,
  "reach": 6000,
  "engagement": 250,
  "engagement_rate": 4.17,
  "facebook_insights": {
    "post_impressions": 8000,
    "post_impressions_unique": 6000,
    "post_impressions_paid": 2000,
    "post_impressions_organic": 6000,
    "post_engaged_users": 250,
    "post_clicks": 45
  },
  "comments_data": [...]
}
```

## Twitter/X Insights

### API Calls

```typescript
// Twitter API v2
GET /2/tweets/{id}?tweet.fields=created_at,public_metrics,organic_metrics
```

### Data Stored

```json
{
  "platform": "twitter",
  "likes": 85,
  "comments": 12,
  "shares": 25,
  "impressions": 3500,
  "engagement": 122,
  "engagement_rate": 3.49
}
```

## LinkedIn Insights

### API Calls

```typescript
// LinkedIn API
GET /v2/socialActions/{post-id}
```

### Data Stored

```json
{
  "platform": "linkedin",
  "likes": 45,
  "comments": 8,
  "shares": 12,
  "engagement": 65
}
```

## React Usage

### Single Post Sync

```typescript
import { useSyncPostInsights } from "../../hooks/api/post-insights"

const { mutate: syncInsights, isPending } = useSyncPostInsights()

// Trigger sync
syncInsights(postId, {
  onSuccess: (data) => {
    console.log("Insights synced:", data)
  }
})
```

### Bulk Sync

```typescript
import { useSyncAllPostInsights } from "../../hooks/api/post-insights"

const { mutate: syncAll, isPending } = useSyncAllPostInsights()

// Sync all posts
syncAll({ platform_id: "xxx", limit: 50 })

// Sync all posts from all platforms
syncAll()
```

### Display Insights

```typescript
import { PostInsightsPanel } from "../../components/social-posts/post-insights-panel"

<PostInsightsPanel
  postId={post.id}
  insights={post.insights}
  status={post.status}
/>
```

## UI Components

### PostInsightsPanel

Displays comprehensive post insights with:
- Sync button
- Metrics grid (likes, comments, shares, impressions, reach, etc.)
- Reactions breakdown (Facebook)
- Recent comments list
- Sync status and errors

**Features:**
- ✅ Real-time sync
- ✅ Visual metrics with emojis
- ✅ Engagement rate calculation
- ✅ Platform-specific data
- ✅ Error handling

## Database Schema

The `insights` field stores all data as JSON:

```typescript
{
  // Platform info
  platform: "instagram" | "facebook" | "twitter" | "linkedin",
  platform_post_id: string,
  permalink?: string,
  
  // Basic metrics
  likes: number,
  comments: number,
  shares: number,
  saves?: number,
  
  // Reach & impressions
  impressions: number,
  reach: number,
  engagement: number,
  engagement_rate: number,
  
  // Platform-specific
  instagram_insights?: {...},
  facebook_insights?: {...},
  reactions?: {...},
  
  // Comments
  comments_data?: [...],
  
  // Metadata
  last_synced_at: string,
  sync_status: "success" | "partial" | "failed",
  sync_errors?: string[]
}
```

## Automation

### Auto-Sync After Publishing

Add to publish workflow:

```typescript
// After successful publish
if (publishResult.success) {
  // Trigger insights sync (async, don't wait)
  setTimeout(async () => {
    await syncPostInsights(postId, platformPostId, platform, accessToken, socials)
  }, 60000) // Wait 1 minute for platform to process
}
```

### Scheduled Sync

Create a cron job to sync all posts daily:

```typescript
// Run daily at 2 AM
cron.schedule('0 2 * * *', async () => {
  await fetch('/admin/social-posts/sync-all-insights?limit=100', {
    method: 'POST'
  })
})
```

## Performance Considerations

### Rate Limits

**Instagram:**
- 200 calls per hour per user
- Mitigation: Batch requests, cache results

**Facebook:**
- 200 calls per hour per user
- Mitigation: Use field expansion, batch requests

**Twitter:**
- 300 requests per 15 minutes
- Mitigation: Queue requests, exponential backoff

### Optimization

1. **Batch Processing**: Sync multiple posts in parallel (max 5 concurrent)
2. **Caching**: Store insights for 1 hour, don't re-sync immediately
3. **Incremental Updates**: Only fetch new comments since last sync
4. **Field Selection**: Request only needed fields to reduce payload

## Error Handling

```typescript
{
  "sync_status": "partial",
  "sync_errors": [
    "Insights metrics: Rate limit exceeded",
    "Comments: Permission denied"
  ]
}
```

**Common Errors:**
- `Rate limit exceeded`: Wait and retry
- `Permission denied`: Check access token permissions
- `Post not found`: Post may have been deleted
- `Invalid media ID`: Platform post ID is incorrect

## Files Created

1. `/src/modules/socials/services/post-insights-service.ts` - Core service
2. `/src/api/admin/social-posts/[id]/sync-insights/route.ts` - Single sync endpoint
3. `/src/api/admin/social-posts/sync-all-insights/route.ts` - Bulk sync endpoint
4. `/src/admin/hooks/api/post-insights.ts` - React hooks
5. `/src/admin/components/social-posts/post-insights-panel.tsx` - UI component
6. `/docs/POST_INSIGHTS_SYNC.md` - This documentation

## Related Documentation

- [Hashtags & Mentions Feature](./HASHTAGS_MENTIONS_FEATURE.md)
- [Multi-Platform Hashtag Search](./MULTI_PLATFORM_HASHTAG_SEARCH.md)
- [Social Publishing Implementation](./SOCIAL_PUBLISHING_IMPLEMENTATION.md)

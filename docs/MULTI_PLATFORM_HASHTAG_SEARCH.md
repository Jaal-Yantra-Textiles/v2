# Multi-Platform Hashtag Search with Smart Caching

## Overview

Intelligent hashtag search system that fetches relevant hashtags from social platform APIs (Instagram, Facebook, Twitter/X, LinkedIn) and caches them in the database for fast subsequent searches.

## Architecture

```
User types "#fash"
       ↓
1. Check DB cache (fast)
       ↓
2. If not found → Fetch from Platform API
       ↓
3. Store in DB for future searches
       ↓
4. Return results
```

## Supported Platforms

### 1. Instagram
- **API**: Instagram Hashtag Search API
- **Endpoint**: `GET /ig_hashtag_search`
- **Features**:
  - Real-time hashtag search
  - Returns matching hashtags
  - Requires Instagram Business Account
- **Requirements**:
  - `instagram_basic` permission
  - Instagram Public Content Access feature approval

### 2. Facebook
- **API**: Facebook Graph API (Page Feed)
- **Method**: Extract from recent posts
- **Features**:
  - Analyzes last 50 page posts
  - Extracts and counts hashtags
  - Returns hashtags matching query
- **Requirements**:
  - `pages_read_engagement` permission
  - Facebook Page access token

### 3. Twitter/X
- **API**: Trending Topics (fallback to curated list)
- **Method**: Common trending hashtags
- **Features**:
  - Returns popular tech, business, lifestyle hashtags
  - Can be enhanced with Twitter API v2
- **Note**: Twitter API v2 requires separate Bearer token authentication

### 4. LinkedIn
- **API**: Curated professional hashtags
- **Method**: Common professional hashtags
- **Features**:
  - Returns business, career, tech hashtags
  - Optimized for professional content
- **Note**: LinkedIn doesn't have public hashtag search API

## How It Works

### Flow Diagram

```
┌─────────────────────────────────────────────────┐
│  User types "#fashion" in caption field        │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│  1. Check DB Cache                              │
│     SELECT * FROM hashtag                       │
│     WHERE tag LIKE 'fashion%'                   │
│     AND platform = 'instagram'                  │
└────────────────┬────────────────────────────────┘
                 │
         ┌───────┴───────┐
         │               │
    Cache Hit        Cache Miss
         │               │
         ▼               ▼
┌─────────────┐  ┌──────────────────────────────┐
│ Return      │  │ 2. Fetch from Platform API   │
│ Cached      │  │    - Instagram: Hashtag      │
│ Results     │  │      Search API              │
│             │  │    - Facebook: Extract from  │
│             │  │      page posts              │
│             │  │    - Twitter: Trending list  │
│             │  │    - LinkedIn: Professional  │
│             │  │      hashtags                │
└─────────────┘  └──────────┬───────────────────┘
                            │
                            ▼
                 ┌──────────────────────────────┐
                 │ 3. Store in DB               │
                 │    INSERT INTO hashtag       │
                 │    (tag, platform, ...)      │
                 └──────────┬───────────────────┘
                            │
                            ▼
                 ┌──────────────────────────────┐
                 │ 4. Return Results            │
                 └──────────────────────────────┘
```

### API Call Example

**Request:**
```http
GET /admin/socials/hashtags?q=fashion&platform=instagram&platform_id=01K9D25PAZHKTQ2ZYE64VRN1F8
```

**Response:**
```json
{
  "hashtags": [
    {
      "tag": "fashion",
      "platform": "instagram",
      "usage_count": 15,
      "last_used_at": "2025-11-15T12:00:00Z"
    },
    {
      "tag": "fashiondesign",
      "platform": "instagram",
      "usage_count": 8,
      "last_used_at": "2025-11-14T10:30:00Z"
    },
    {
      "tag": "fashionista",
      "platform": "instagram",
      "usage_count": 3,
      "last_used_at": "2025-11-13T15:45:00Z"
    }
  ]
}
```

## Platform-Specific Implementation

### Instagram Hashtag Search

```typescript
// 1. Search for hashtag ID
GET /ig_hashtag_search?user_id={ig-user-id}&q=fashion

// 2. Get hashtag details
GET /{hashtag-id}?fields=id,name

// 3. Cache in DB
INSERT INTO hashtag (tag, platform, usage_count)
VALUES ('fashion', 'instagram', 1)
```

### Facebook Hashtag Extraction

```typescript
// 1. Fetch recent posts
GET /{page-id}/feed?fields=message&limit=50

// 2. Extract hashtags from messages
const hashtags = message.match(/#[\p{L}\p{N}_]+/gu)

// 3. Filter by query and cache
hashtags.filter(tag => tag.includes(query))
```

### Twitter Trending Hashtags

```typescript
// Curated list of trending topics
const trending = [
  'tech', 'ai', 'startup', 'innovation',
  'fashion', 'style', 'fitness', 'health',
  // ... more
]

// Filter by query
trending.filter(tag => tag.includes(query))
```

### LinkedIn Professional Hashtags

```typescript
// Curated list of professional hashtags
const professional = [
  'linkedin', 'networking', 'career', 'jobs',
  'business', 'entrepreneur', 'leadership',
  // ... more
]

// Filter by query
professional.filter(tag => tag.includes(query))
```

## Usage

### React Component

```typescript
import { CaptionInputWithSuggestions } from "./caption-input-with-suggestions"

<CaptionInputWithSuggestions
  value={caption}
  onChange={setCaption}
  placeholder="Write your caption..."
  platform="instagram"
  platformId="01K9D25PAZHKTQ2ZYE64VRN1F8"
/>
```

### React Hook

```typescript
import { useHashtagSuggestions } from "../../hooks/api/hashtags"

const { data } = useHashtagSuggestions(
  "fashion",              // query
  "instagram",            // platform
  "01K9D25PAZHKTQ2ZYE64VRN1F8",  // platformId
  true                    // enabled
)
```

### API Endpoint

```typescript
// GET /admin/socials/hashtags
// Query params:
// - q: search query
// - platform: instagram | facebook | twitter | linkedin | all
// - platform_id: optional, for API access
// - limit: number of results (default 10)
// - type: suggestions | popular | recent
```

## Caching Strategy

### Cache TTL
- **Duration**: 24 hours
- **Refresh**: Automatic on next search after expiration

### Cache Key
```
hashtag:{tag}:{platform}
```

### Cache Hit Ratio
- **First search**: API call (cache miss)
- **Subsequent searches**: DB lookup (cache hit)
- **Expected hit ratio**: >80% after initial usage

## Performance

### Without Caching
```
User types "#fashion"
  ↓
API call to Instagram (500-1000ms)
  ↓
Response
```

### With Caching
```
User types "#fashion"
  ↓
DB query (5-10ms)
  ↓
Response
```

**Performance Improvement**: 50-100x faster

## Database Schema

```sql
CREATE TABLE hashtag (
  id VARCHAR PRIMARY KEY,
  tag VARCHAR NOT NULL,
  platform VARCHAR NOT NULL,  -- instagram | facebook | twitter | linkedin | all
  usage_count INTEGER DEFAULT 0,
  last_used_at TIMESTAMP,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  UNIQUE(tag, platform)
);

CREATE INDEX idx_hashtag_search ON hashtag(tag, platform);
CREATE INDEX idx_hashtag_usage ON hashtag(usage_count DESC);
```

## API Rate Limits

### Instagram
- **Limit**: 30 unique hashtags per 7 days
- **Mitigation**: DB caching reduces API calls

### Facebook
- **Limit**: Standard Graph API limits
- **Mitigation**: Batch requests, caching

### Twitter
- **Limit**: 15 requests per 15 minutes (if using API)
- **Mitigation**: Curated list fallback

### LinkedIn
- **Limit**: N/A (using curated list)
- **Mitigation**: None needed

## Error Handling

```typescript
try {
  // Try platform API
  const results = await searchInstagramAPI(query)
  await cacheResults(results)
  return results
} catch (error) {
  console.error("API error:", error)
  // Fallback to DB fuzzy search
  return fuzzySearchFromDB(query)
}
```

## Future Enhancements

1. **Twitter API v2 Integration**
   - Real-time trending topics
   - Hashtag analytics

2. **LinkedIn API Integration**
   - If/when LinkedIn provides hashtag API
   - Professional network insights

3. **Machine Learning**
   - Predict relevant hashtags based on caption
   - Personalized suggestions

4. **Analytics**
   - Track hashtag performance
   - Engagement metrics per hashtag

5. **Hashtag Groups**
   - Save frequently used hashtag combinations
   - One-click insertion of hashtag sets

## Files Created/Modified

### New Files
- `/src/modules/socials/services/hashtag-search-service.ts` - Smart caching service
- `/docs/MULTI_PLATFORM_HASHTAG_SEARCH.md` - This documentation

### Modified Files
- `/src/api/admin/socials/hashtags/route.ts` - Integrated smart search
- `/src/admin/hooks/api/hashtags.ts` - Added platformId parameter
- `/src/admin/hooks/api/mentions.ts` - Added LinkedIn support
- `/src/admin/components/social-posts/caption-input-with-suggestions.tsx` - Added platformId prop

## Testing

### Test Hashtag Search

```bash
# Instagram
curl "http://localhost:9000/admin/socials/hashtags?q=fashion&platform=instagram&platform_id=YOUR_PLATFORM_ID"

# Facebook
curl "http://localhost:9000/admin/socials/hashtags?q=business&platform=facebook&platform_id=YOUR_PLATFORM_ID"

# Twitter
curl "http://localhost:9000/admin/socials/hashtags?q=tech&platform=twitter"

# LinkedIn
curl "http://localhost:9000/admin/socials/hashtags?q=career&platform=linkedin"
```

### Expected Behavior

1. **First search**: Slower (API call + caching)
2. **Second search**: Fast (DB cache hit)
3. **After 24h**: Refresh from API

## Related Documentation

- [Hashtags & Mentions Feature](./HASHTAGS_MENTIONS_FEATURE.md)
- [Hashtags & Mentions UI Implementation](./HASHTAGS_MENTIONS_UI_IMPLEMENTATION.md)
- [Sync Platform Data](./SYNC_PLATFORM_HASHTAGS_MENTIONS.md)

---
title: "Hashtags and Mentions Feature"
sidebar_label: "Hashtags & Mentions"
sidebar_position: 7
---

# Hashtags and Mentions Feature

## Overview
Automatic extraction, storage, and suggestion system for hashtags and user mentions in social media posts. This feature helps users reuse popular hashtags and mentions without having to remember or search for them each time.

## Features

### 1. Automatic Extraction
- **Hashtags**: Automatically extracts hashtags (e.g., `#fashion`, `#handmade`) from post captions
- **Mentions**: Automatically extracts user mentions (e.g., `@username`) from post captions
- **Platform-Specific**: Tracks usage per platform (Facebook, Instagram, Twitter)
- **Real-Time**: Extraction happens during post creation/update

### 2. Smart Storage
- **Deduplication**: Stores each unique hashtag/mention only once
- **Usage Tracking**: Counts how many times each hashtag/mention is used
- **Last Used**: Tracks when each hashtag/mention was last used
- **Platform Association**: Links hashtags/mentions to specific platforms

### 3. Intelligent Suggestions
- **Autocomplete**: Type-ahead suggestions as you type
- **Popular**: Shows most frequently used hashtags/mentions
- **Recent**: Shows recently used hashtags/mentions
- **Platform-Filtered**: Suggestions filtered by selected platform

## Database Schema

### Hashtag Model
```typescript
{
  id: string (primary key)
  tag: string (searchable, without #)
  platform: "facebook" | "instagram" | "twitter" | "all"
  usage_count: number (default: 0)
  last_used_at: datetime (nullable)
  metadata: json (nullable)
}
```

### Mention Model
```typescript
{
  id: string (primary key)
  username: string (searchable, without @)
  display_name: string (nullable)
  platform: "facebook" | "instagram" | "twitter"
  platform_user_id: string (nullable)
  usage_count: number (default: 0)
  last_used_at: datetime (nullable)
  metadata: json (nullable)
}
```

## API Endpoints

### Get Hashtag Suggestions
```
GET /admin/socials/hashtags
```

**Query Parameters:**
- `q` (string): Search query
- `platform` (string): facebook | instagram | twitter | all
- `limit` (number): Number of results (default: 10)
- `type` (string): suggestions | popular | recent

**Response:**
```json
{
  "hashtags": [
    {
      "tag": "fashion",
      "platform": "instagram",
      "usage_count": 15,
      "last_used_at": "2025-11-15T12:00:00Z"
    }
  ]
}
```

### Get Mention Suggestions
```
GET /admin/socials/mentions
```

**Query Parameters:**
- `q` (string): Search query
- `platform` (string): facebook | instagram | twitter
- `limit` (number): Number of results (default: 10)

**Response:**
```json
{
  "mentions": [
    {
      "username": "jaalyantra",
      "display_name": "Jaal Yantra Textiles",
      "platform": "instagram",
      "usage_count": 8,
      "last_used_at": "2025-11-15T12:00:00Z"
    }
  ]
}
```

## React Hooks

### useHashtagSuggestions
```typescript
import { useHashtagSuggestions } from "../../hooks/api/hashtags"

const { data, isLoading } = useHashtagSuggestions(
  "fash",           // query
  "instagram",      // platform (optional)
  true              // enabled (optional)
)

// data.hashtags = [{ tag: "fashion", ... }, { tag: "fashiondesign", ... }]
```

### usePopularHashtags
```typescript
import { usePopularHashtags } from "../../hooks/api/hashtags"

const { data } = usePopularHashtags(
  "instagram",  // platform (optional)
  20            // limit (optional)
)
```

### useRecentHashtags
```typescript
import { useRecentHashtags } from "../../hooks/api/hashtags"

const { data } = useRecentHashtags(
  "instagram",  // platform (optional)
  20            // limit (optional)
```

### useMentionSuggestions
```typescript
import { useMentionSuggestions } from "../../hooks/api/mentions"

const { data, isLoading } = useMentionSuggestions(
  "jaal",       // query
  "instagram",  // platform (optional)
  true          // enabled (optional)
)
```

## Utility Functions

### Extract Hashtags
```typescript
import { extractHashtags } from "../utils/text-extraction"

const text = "Check out our #handmade #fashion collection!"
const hashtags = extractHashtags(text)
// Returns: ["handmade", "fashion"]
```

### Extract Mentions
```typescript
import { extractMentions } from "../utils/text-extraction"

const text = "Thanks @jaalyantra for the collaboration!"
const mentions = extractMentions(text)
// Returns: ["jaalyantra"]
```

### Validate Hashtag
```typescript
import { isValidHashtag } from "../utils/text-extraction"

isValidHashtag("#fashion")  // true
isValidHashtag("#")         // false
isValidHashtag("#a".repeat(101))  // false (too long)
```

### Validate Mention
```typescript
import { isValidMention } from "../utils/text-extraction"

isValidMention("@jaalyantra", "instagram")  // true
isValidMention("@ab", "instagram")          // false (too short)
isValidMention("@".repeat(31), "instagram") // false (too long)
```

## Workflow Integration

The extraction happens automatically when creating or updating social posts:

```typescript
// In create-social-post workflow
if (enriched.caption) {
  extractHashtagsMentionsStep({
    caption: enriched.caption,
    platform_name: input.platform_name || "all",
  })
}
```

This runs asynchronously and doesn't block post creation.

## Platform-Specific Rules

### Instagram
- **Hashtags**: 1-100 characters, alphanumeric + underscores
- **Mentions**: 1-30 characters, alphanumeric + underscores + dots
- **Restrictions**: Cannot start/end with dot, no consecutive dots

### Twitter
- **Hashtags**: 1-100 characters, alphanumeric + underscores
- **Mentions**: 1-15 characters, alphanumeric + underscores only

### Facebook
- **Hashtags**: 1-100 characters, alphanumeric + underscores
- **Mentions**: 5-50 characters, alphanumeric + underscores + dots

## Usage Examples

### Example 1: Create Post with Hashtags
```typescript
const post = {
  name: "New Collection",
  caption: "Check out our #handmade #fashion #kashmir collection! 🧵",
  platform_id: "instagram_platform_id"
}

// Hashtags automatically extracted and stored:
// - handmade
// - fashion
// - kashmir
```

### Example 2: Get Suggestions While Typing
```typescript
// User types "#fash"
const { data } = useHashtagSuggestions("#fash", "instagram")

// Returns suggestions:
// - fashion (used 15 times)
// - fashiondesign (used 8 times)
// - fashionista (used 3 times)
```

### Example 3: Show Popular Hashtags
```typescript
const { data } = usePopularHashtags("instagram", 10)

// Returns top 10 most used hashtags:
// - handmade (50 uses)
// - fashion (45 uses)
// - kashmir (40 uses)
// ...
```

## UI Component Integration

### Autocomplete Input (Future Enhancement)
```typescript
import { useHashtagSuggestions } from "../../hooks/api/hashtags"

const HashtagInput = ({ value, onChange, platform }) => {
  const [query, setQuery] = useState("")
  const { data } = useHashtagSuggestions(query, platform)
  
  return (
    <Textarea
      value={value}
      onChange={(e) => {
        onChange(e.target.value)
        // Extract last word being typed
        const words = e.target.value.split(/\s/)
        const lastWord = words[words.length - 1]
        if (lastWord.startsWith('#')) {
          setQuery(lastWord)
        }
      }}
    />
    {data?.hashtags && (
      <SuggestionList>
        {data.hashtags.map(h => (
          <SuggestionItem onClick={() => insertHashtag(h.tag)}>
            #{h.tag} ({h.usage_count} uses)
          </SuggestionItem>
        ))}
      </SuggestionList>
    )}
  )
}
```

## Performance Considerations

1. **Async Extraction**: Hashtag/mention extraction doesn't block post creation
2. **Debounced Suggestions**: UI should debounce autocomplete queries
3. **Caching**: React Query caches suggestions for better performance
4. **Indexing**: Database indexes on `tag` and `username` fields for fast lookups

## Future Enhancements

1. **Trending Hashtags**: Track trending hashtags over time periods
2. **Hashtag Analytics**: Show performance metrics for each hashtag
3. **Mention Verification**: Verify mentions against actual social media accounts
4. **Hashtag Groups**: Create and save hashtag groups for quick insertion
5. **Smart Suggestions**: ML-based suggestions based on post content
6. **Cross-Platform Sync**: Sync hashtags across platforms
7. **Hashtag Research**: Suggest related hashtags based on content

## Testing

### Unit Tests
```typescript
describe("extractHashtags", () => {
  it("should extract hashtags from text", () => {
    const text = "Love #fashion and #design"
    expect(extractHashtags(text)).toEqual(["fashion", "design"])
  })
  
  it("should handle Unicode hashtags", () => {
    const text = "#नमस्ते #مرحبا"
    expect(extractHashtags(text).length).toBe(2)
  })
})
```

### Integration Tests
```typescript
describe("Hashtag Extraction Workflow", () => {
  it("should extract and store hashtags on post creation", async () => {
    const post = await createPost({
      caption: "Test #hashtag",
      platform_id: "test_platform"
    })
    
    const hashtags = await listHashtags({ tag: "hashtag" })
    expect(hashtags.length).toBe(1)
    expect(hashtags[0].usage_count).toBe(1)
  })
})
```

## Files Created

### Models
- `/src/modules/socials/models/hashtag.ts`
- `/src/modules/socials/models/mention.ts`

### Services
- `/src/modules/socials/service.ts` (updated)
- `/src/modules/socials/utils/text-extraction.ts`

### Workflows
- `/src/workflows/socials/extract-hashtags-mentions.ts`
- `/src/workflows/socials/create-social-post.ts` (updated)

### API Routes
- `/src/api/admin/socials/hashtags/route.ts`
- `/src/api/admin/socials/mentions/route.ts`

### React Hooks
- `/src/admin/hooks/api/hashtags.ts`
- `/src/admin/hooks/api/mentions.ts`

## Migration Required

After implementing this feature, run database migrations to create the new tables:

```bash
npx medusa db:migrate
```

This will create:
- `hashtag` table
- `mention` table

## Related Documentation

- [Social Posts UI Improvements](/docs/reference/social-api/posts-ui-improvements)
- [FBINSTA Integration Guide](/docs/reference/facebook/integration-guide)
- [Webhook Diagnostic Guide](/docs/reference/webhooks/diagnostic-guide)

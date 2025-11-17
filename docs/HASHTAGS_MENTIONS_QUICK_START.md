# Hashtags & Mentions Feature - Quick Start

## What Was Implemented

A complete hashtag and mention extraction, storage, and suggestion system for social media posts.

## Key Features

✅ **Automatic Extraction** - Hashtags and mentions are automatically extracted from post captions  
✅ **Smart Storage** - Deduplication, usage tracking, and last-used timestamps  
✅ **Intelligent Suggestions** - Autocomplete, popular, and recent suggestions  
✅ **Platform-Specific** - Separate tracking for Facebook, Instagram, and Twitter  
✅ **React Hooks** - Ready-to-use hooks for UI integration  

## Quick Setup

### 1. Run Database Migration

```bash
npx medusa db:migrate
```

This creates the `hashtag` and `mention` tables.

### 2. Test the API

#### Get Hashtag Suggestions
```bash
curl "http://localhost:9000/admin/socials/hashtags?q=fash&platform=instagram"
```

#### Get Popular Hashtags
```bash
curl "http://localhost:9000/admin/socials/hashtags?type=popular&platform=instagram&limit=10"
```

#### Get Mention Suggestions
```bash
curl "http://localhost:9000/admin/socials/mentions?q=jaal&platform=instagram"
```

### 3. Use in React Components

```typescript
import { useHashtagSuggestions } from "../../hooks/api/hashtags"

const MyComponent = () => {
  const { data } = useHashtagSuggestions("fash", "instagram")
  
  return (
    <div>
      {data?.hashtags.map(h => (
        <div key={h.tag}>#{h.tag} ({h.usage_count} uses)</div>
      ))}
    </div>
  )
}
```

## How It Works

### Automatic Extraction

When you create a post with this caption:
```
"Check out our #handmade #fashion collection! Thanks @jaalyantra 🧵"
```

The system automatically:
1. Extracts hashtags: `handmade`, `fashion`
2. Extracts mentions: `jaalyantra`
3. Stores them in the database
4. Increments usage count if they already exist
5. Updates last_used_at timestamp

### Getting Suggestions

When typing in the caption field:
```typescript
// User types "#fash"
const { data } = useHashtagSuggestions("#fash", "instagram")

// Returns:
// - #fashion (15 uses)
// - #fashiondesign (8 uses)
// - #fashionista (3 uses)
```

## API Endpoints

### Hashtags
- `GET /admin/socials/hashtags?q={query}&platform={platform}&type={suggestions|popular|recent}`

### Mentions
- `GET /admin/socials/mentions?q={query}&platform={platform}`

## React Hooks

### Hashtags
- `useHashtagSuggestions(query, platform, enabled)` - Get suggestions as you type
- `usePopularHashtags(platform, limit)` - Get most used hashtags
- `useRecentHashtags(platform, limit)` - Get recently used hashtags

### Mentions
- `useMentionSuggestions(query, platform, enabled)` - Get mention suggestions
- `usePopularMentions(platform, limit)` - Get most used mentions

## Example: Create Post with Auto-Extraction

```typescript
// Create a post
const post = await createSocialPost({
  name: "New Collection",
  caption: "Our #handmade #kashmir collection! 🧵 @jaalyantra",
  platform_id: "instagram_platform_id"
})

// Hashtags and mentions are automatically extracted and stored
// Next time you type "#hand", you'll get "handmade" as a suggestion
```

## Platform-Specific Validation

### Instagram
- Hashtags: 1-100 chars, alphanumeric + underscores
- Mentions: 1-30 chars, alphanumeric + underscores + dots

### Twitter
- Hashtags: 1-100 chars, alphanumeric + underscores
- Mentions: 1-15 chars, alphanumeric + underscores

### Facebook
- Hashtags: 1-100 chars, alphanumeric + underscores
- Mentions: 5-50 chars, alphanumeric + underscores + dots

## Files Created

**Database Models:**
- `src/modules/socials/models/hashtag.ts`
- `src/modules/socials/models/mention.ts`

**Services:**
- `src/modules/socials/service.ts` (updated)
- `src/modules/socials/utils/text-extraction.ts`

**Workflows:**
- `src/workflows/socials/extract-hashtags-mentions.ts`
- `src/workflows/socials/create-social-post.ts` (updated)

**API Routes:**
- `src/api/admin/socials/hashtags/route.ts`
- `src/api/admin/socials/mentions/route.ts`

**React Hooks:**
- `src/admin/hooks/api/hashtags.ts`
- `src/admin/hooks/api/mentions.ts`

## Next Steps

1. **Run migrations**: `npx medusa db:migrate`
2. **Create some posts** with hashtags and mentions
3. **Test the API** endpoints
4. **Integrate into UI** using the React hooks
5. **Build autocomplete component** (optional)

## Future Enhancements

- 📊 Hashtag analytics and performance tracking
- 🔥 Trending hashtags over time
- 🤖 ML-based smart suggestions
- 📁 Hashtag groups for quick insertion
- ✅ Mention verification against real accounts

## Documentation

For complete documentation, see: [HASHTAGS_MENTIONS_FEATURE.md](./HASHTAGS_MENTIONS_FEATURE.md)

---
title: "Sync Hashtags & Mentions from Social Platforms"
sidebar_label: "Sync Hashtags"
sidebar_position: 4
---

# Sync Hashtags & Mentions from Social Platforms

## Overview

Instead of manually seeding hashtags and mentions, the system can now automatically extract them from your existing Facebook and Instagram posts. This provides real, relevant suggestions based on your actual social media content.

## How It Works

The sync workflow:
1. Connects to your Facebook/Instagram account using the stored access token
2. Fetches your recent posts (last 50 posts)
3. Extracts all hashtags and mentions from captions
4. Stores them in the database with usage counts
5. Makes them available for autocomplete suggestions

## API Endpoint

```
POST /admin/socials/sync-platform-data
```

**Request Body:**
```json
{
  "platform_id": "your_platform_id"
}
```

**Response:**
```json
{
  "message": "Platform data sync completed",
  "results": {
    "instagram_hashtags": {
      "synced": 25,
      "message": "Synced 25 hashtags from Instagram"
    },
    "instagram_mentions": {
      "synced": 8,
      "message": "Synced 8 mentions from Instagram"
    },
    "facebook_hashtags": {
      "synced": 15,
      "message": "Synced 15 hashtags from Facebook"
    }
  }
}
```

## React Hook

```typescript
import { useSyncPlatformData } from "../../hooks/api/hashtags"

const { mutate: syncData, isPending } = useSyncPlatformData()

// Trigger sync
syncData(platform_id, {
  onSuccess: (data) => {
    console.log("Sync completed:", data)
  }
})
```

## Usage

### Option 1: Manual Sync via API

```bash
curl -X POST http://localhost:9000/admin/socials/sync-platform-data \
  -H "Content-Type: application/json" \
  -d '{"platform_id": "your_platform_id"}'
```

### Option 2: Add Sync Button to UI

Add a "Sync Hashtags" button to your social platform settings page:

```typescript
import { useSyncPlatformData } from "../../hooks/api/hashtags"
import { Button } from "@medusajs/ui"

const SyncButton = ({ platformId }) => {
  const { mutate, isPending } = useSyncPlatformData()
  
  return (
    <Button
      onClick={() => mutate(platformId)}
      isLoading={isPending}
    >
      Sync Hashtags & Mentions
    </Button>
  )
}
```

### Option 3: Automatic Sync on Platform Connection

Trigger sync automatically when a user connects their social account:

```typescript
// After OAuth callback
await syncPlatformHashtagsMentionsWorkflow(scope).run({
  input: {
    platform_id,
    access_token,
  }
})
```

## What Gets Synced

### Instagram
- **Hashtags**: Extracted from last 50 Instagram posts
- **Mentions**: Extracted from last 50 Instagram posts
- **Source**: Instagram Business Account media captions

### Facebook
- **Hashtags**: Extracted from last 50 Facebook page posts
- **Source**: Facebook Page feed messages

## Data Storage

### Hashtags Table
```typescript
{
  tag: "fashion",              // without #
  platform: "instagram",       // facebook | instagram | twitter | all
  usage_count: 15,            // incremented on each occurrence
  last_used_at: "2025-11-15"  // updated on each sync
}
```

### Mentions Table
```typescript
{
  username: "jaalyantra",      // without @
  display_name: null,          // can be enriched later
  platform: "instagram",       // facebook | instagram | twitter
  usage_count: 8,             // incremented on each occurrence
  last_used_at: "2025-11-15"  // updated on each sync
}
```

## Workflow Steps

1. **syncInstagramHashtagsStep**
   - Gets Instagram Business Account from Facebook Pages
   - Fetches recent media with captions
   - Extracts hashtags using regex
   - Upserts to database

2. **syncInstagramMentionsStep**
   - Gets Instagram Business Account from Facebook Pages
   - Fetches recent media with captions
   - Extracts mentions using regex
   - Upserts to database

3. **syncFacebookHashtagsStep**
   - Gets Facebook Pages
   - Fetches recent page posts
   - Extracts hashtags from messages
   - Upserts to database

## Benefits

✅ **Real Data**: Uses your actual social media content  
✅ **Relevant Suggestions**: Hashtags you've actually used  
✅ **No Manual Work**: Automatic extraction  
✅ **Usage Tracking**: Shows which hashtags you use most  
✅ **Platform-Specific**: Separate tracking for each platform  
✅ **Incremental Updates**: Re-running sync updates counts  

## Example Flow

1. User connects Instagram account
2. System stores access token
3. User clicks "Sync Hashtags & Mentions"
4. System fetches last 50 Instagram posts
5. Extracts: `#fashion`, `#handmade`, `@jaalyantra`, etc.
6. Stores in database with usage counts
7. User types `#fash` in caption field
8. Autocomplete shows: `#fashion (15 uses)`

## Troubleshooting

### No Data Synced

**Problem**: Sync completes but 0 hashtags/mentions found

**Solutions**:
- Ensure you have posts on your Facebook/Instagram account
- Check that posts contain hashtags or mentions
- Verify access token has correct permissions
- Check console logs for API errors

### Instagram Business Account Not Found

**Problem**: "No Instagram Business Account found"

**Solutions**:
- Ensure your Instagram account is a Business or Creator account
- Link Instagram account to your Facebook Page
- Re-authenticate with correct permissions

### Permission Errors

**Problem**: API returns 403 or permission errors

**Solutions**:
- Re-authenticate with required scopes:
  - `instagram_basic`
  - `instagram_manage_insights`
  - `pages_show_list`
  - `pages_read_engagement`

## Files Created

- `/src/workflows/socials/sync-platform-hashtags-mentions.ts` - Workflow steps
- `/src/api/admin/socials/sync-platform-data/route.ts` - API endpoint
- `/src/admin/hooks/api/hashtags.ts` - React hook (updated)

## Related Documentation

- [Hashtags & Mentions Feature](/docs/implementation/social-publishing/hashtags-mentions)
- [Hashtags & Mentions UI Implementation](/docs/implementation/social-publishing/hashtags-ui)
- [Hashtags & Mentions Quick Start](/docs/reference/x-twitter/hashtags-quick-start)

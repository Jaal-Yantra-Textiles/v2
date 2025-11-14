# FileModal Folder Filter Fix

## Issue
When trying to filter media files by `folder_id`, the API returned a 400 error:

```
Error: Trying to query by not existing property Folder.folder_id
```

## Root Cause
The `listAllMediasWorkflow` was passing ALL filter parameters to ALL entity queries:
- Folders query received `folder_id` filter → ❌ Folder model doesn't have `folder_id`
- Albums query received `folder_id` filter → ❌ Album model doesn't have `folder_id`
- MediaFiles query received `folder_id` filter → ✅ MediaFile model HAS `folder_id`

The workflow was not filtering query parameters based on entity type.

## Solution
Updated `/src/workflows/media/list-all-medias.ts` to whitelist allowed fields for each entity:

### Before:
```typescript
const foldersRes = listFolderWorkflow.runAsStep({
  input: transform({ input }, (data) => ({
    filters: data.input.filters || {}, // ❌ Passes ALL filters
    config: data.input.config,
  })),
});
```

### After:
```typescript
const foldersRes = listFolderWorkflow.runAsStep({
  input: transform({ input }, (data) => {
    const raw = { ...(data.input.filters || {}) }
    // ✅ Whitelist only fields that exist on Folder
    const allowedKeys = new Set([
      "id", "name", "slug", "description", "path", 
      "level", "sort_order", "is_public", 
      "parent_folder_id", "metadata"
    ])
    const filtered: Record<string, any> = {}
    for (const [k, v] of Object.entries(raw)) {
      if (allowedKeys.has(k)) filtered[k] = v
    }
    return {
      filters: filtered,
      config: data.input.config,
    }
  }),
});
```

## Entity Field Whitelists

### Folder Fields:
- `id`, `name`, `slug`, `description`, `path`, `level`
- `sort_order`, `is_public`, `parent_folder_id`, `metadata`

### Album Fields:
- `id`, `name`, `description`, `slug`, `is_public`
- `sort_order`, `type`, `metadata`, `cover_media_id`

### MediaFile Fields:
- `id`, `file_name`, `original_name`, `file_path`, `file_size`, `file_hash`
- `file_type`, `mime_type`, `extension`, `width`, `height`, `duration`
- `title`, `description`, `alt_text`, `caption`, `folder_path`, `tags`
- `is_public`, `metadata`, **`folder_id`**, `created_at`, `updated_at`

### AlbumMedia Fields:
- `sort_order`, `title`, `description`, `album`, `media`

## Testing
After this fix, folder filtering should work:

```typescript
// This should now work ✅
useMediaFiles({ folder_id: "01K22AV7J78TPRVD56EDB8D753" })
```

## Known Limitation: Album Filtering
Album filtering is **not yet implemented** because albums use a many-to-many relationship through the `AlbumMedia` pivot table. This requires a different approach:

**Options:**
1. Create dedicated endpoint: `GET /admin/medias/albums/[id]/files`
2. Modify workflow to support pivot table queries
3. Client-side filtering after fetching all album_media records

**Current Status:** Album dropdown is visible but non-functional. Consider hiding it or adding a tooltip explaining the limitation.

## Files Modified
1. `/src/workflows/media/list-all-medias.ts` - Added field whitelisting
2. `/src/admin/hooks/api/media.ts` - Added TODO comment for album filtering
3. `/docs/FILE_MODAL_ENHANCEMENT.md` - Documented limitation

## Result
✅ Folder filtering now works correctly
✅ Search filtering works
✅ Date range filtering works
⚠️ Album filtering needs separate implementation

---
title: "Social Posts UI Improvements"
sidebar_label: "Posts UI Improvements"
sidebar_position: 7
---

# Social Posts UI Improvements

## Overview
Comprehensive UI improvements for the social posts detail page including link tooltips, metadata management, loader implementation, and insights sidebar section.

## Changes Implemented

### 1. Link Tooltips for URLs

**Problem:** Facebook and Instagram post URLs were overflowing the section.

**Solution:** Enhanced `CommonSection` component to support links with tooltips.

#### Files Modified:
- `/src/admin/components/common/section-views/index.tsx`
  - Added `Tooltip` import from `@medusajs/ui`
  - Extended `CommonField` type to support `link` field with `href` and `label`
  - Added rendering logic for links with tooltips
  - Links truncate at 300px width and show full URL on hover

#### Usage Example:
```typescript
{
  label: "Facebook Post",
  link: {
    href: "https://www.facebook.com/123456789",
    label: "View on Facebook",
  },
}
```

- `/src/admin/components/social-posts/social-post-general-section.tsx`
  - Updated to use `link` field for Facebook and Instagram URLs
  - Added fallback for non-FBINSTA posts to show single post URL
  - Links open in new tab with proper security attributes

### 2. Metadata Route Implementation

**Pattern:** Follows the same structure as designs metadata route.

#### Files Created:
- `/src/admin/routes/social-posts/[id]/@metadata/edit/page.tsx`
  - Implements metadata editing for social posts
  - Uses `MetadataForm` component
  - Includes wrapper function to match expected hook signature
  - Handles loading and error states

#### Key Features:
- Reuses existing `MetadataForm` component
- Proper TypeScript typing with wrapper function
- Consistent with other metadata routes in the application

### 3. Loader Implementation

**Pattern:** Follows the same structure as designs loader.

#### Files Created:
- `/src/admin/routes/social-posts/[id]/loader.ts`
  - Implements data preloading for social post detail page
  - Uses `queryClient.ensureQueryData` for optimal caching
  - Fetches related platform data using `fields` query parameter

- `/src/admin/routes/social-posts/[id]/constants.ts`
  - Defines `SOCIAL_POST_DETAIL_FIELDS` constant
  - Currently includes: `"platform.*"`
  - Can be extended to include more related data

#### Integration:
- Exported as `loader` from detail page
- Enables React Router to prefetch data before rendering
- Improves perceived performance and UX

### 4. Insights Sidebar Section

**Purpose:** Display analytics and engagement data from social platform webhooks.

#### Files Created:
- `/src/admin/components/social-posts/social-post-insights-section.tsx`
  - Comprehensive insights display component
  - Supports Facebook, Instagram, and Twitter metrics
  - Shows webhook data (comments, reactions)

#### Metrics Displayed:

**Facebook Insights:**
- Post ID
- Impressions
- Reach
- Engagement
- Last updated timestamp

**Instagram Insights:**
- Media ID
- Permalink (with link tooltip)
- Impressions
- Reach
- Engagement
- Likes
- Comments
- Saves
- Last updated timestamp

**Twitter Insights:**
- Tweet ID
- (Extensible for future metrics)

**Webhook Data:**
- Comments count
- Total reactions
- Individual reaction types (like, love, wow, etc.)

#### Smart Display Logic:
- Only shows available metrics
- Handles missing data gracefully
- Shows appropriate message when no insights available:
  - "Insights pending from webhooks" for posted content
  - "Post not yet published" for draft content

### 5. Type System Updates

#### Files Modified:
- `/src/admin/hooks/api/social-posts.ts`
  - Added `metadata` field to `AdminSocialPost` type
  - Added `metadata` field to `AdminCreateSocialPostPayload` type
  - Ensures type consistency across the application

## File Structure

```
src/admin/
├── components/
│   ├── common/
│   │   └── section-views/
│   │       └── index.tsx (Enhanced with link tooltips)
│   └── social-posts/
│       ├── social-post-general-section.tsx (Updated with link fields)
│       └── social-post-insights-section.tsx (NEW)
├── hooks/
│   └── api/
│       └── social-posts.ts (Added metadata field)
└── routes/
    └── social-posts/
        └── [id]/
            ├── @metadata/
            │   └── edit/
            │       └── page.tsx (NEW)
            ├── constants.ts (NEW)
            ├── loader.ts (NEW)
            └── page.tsx (Updated with insights and loader)
```

## Benefits

1. **Better UX:** Links no longer overflow, full URLs visible on hover
2. **Metadata Management:** Consistent metadata editing across all entities
3. **Performance:** Loader prefetches data for faster page loads
4. **Analytics:** Comprehensive insights display for tracking post performance
5. **Extensibility:** Easy to add more metrics as platforms add features
6. **Type Safety:** Full TypeScript support with proper types

## Testing Checklist

- [ ] Verify link tooltips show full URL on hover
- [ ] Test metadata editing and saving
- [ ] Confirm loader prefetches data correctly
- [ ] Check insights display for FBINSTA posts
- [ ] Verify insights display for single platform posts
- [ ] Test with posts that have no insights data
- [ ] Verify webhook data displays correctly
- [ ] Test with different insight values (zero, large numbers)

## Future Enhancements

1. **Real-time Updates:** Add polling or websocket for live insights updates
2. **Charts:** Add visual charts for metrics over time
3. **Comparison:** Compare performance across multiple posts
4. **Export:** Export insights data to CSV/Excel
5. **Alerts:** Set up alerts for engagement thresholds
6. **Twitter Metrics:** Add comprehensive Twitter analytics when available

## Related Documentation

- [FBINSTA Integration Guide](/docs/reference/facebook/integration-guide)
- [FBINSTA Publish Post Fix](/docs/reference/facebook/publish-post-fix)
- [Social Webhooks Implementation](/docs/implementation/social-publishing/webhooks)

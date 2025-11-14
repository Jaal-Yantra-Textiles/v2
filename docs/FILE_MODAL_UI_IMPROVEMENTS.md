# FileModal UI Improvements - Loading States & Bounce Fix

## Problem
When changing folder filters, the UI was "bouncing" - content would disappear and reappear, causing a jarring user experience.

## Root Cause
1. **Initial Loading State**: Component returned early with a small spinner, hiding all content
2. **No Min-Height**: Grid container had no minimum height, causing layout shifts
3. **No Loading Overlay**: Content disappeared completely during filter changes
4. **No Disabled State**: Users could rapidly change filters while loading

## Solutions Implemented

### 1. Loading Overlay Instead of Full Replace ✅
**Before:**
```typescript
if (isLoading) {
  return (
    <div className="flex h-48 items-center justify-center">
      <RoundSpinner />
    </div>
  )
}
```

**After:**
```typescript
// Removed early return - show content with overlay instead
<div className="relative min-h-[400px]">
  {/* Loading Overlay */}
  {isLoading && (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-ui-bg-base/80 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-2">
        <RoundSpinner />
        <Text size="small" className="text-ui-fg-subtle">Loading files...</Text>
      </div>
    </div>
  )}
  
  {/* Content stays visible underneath */}
  <div className="grid grid-cols-4 gap-3 ...">
    {/* Files and folders */}
  </div>
</div>
```

### 2. Minimum Height to Prevent Bouncing ✅
Added `min-h-[400px]` to the grid container:
- Prevents layout shifts when content loads
- Maintains consistent height during filter changes
- Provides space for the loading overlay

### 3. Disabled Filter Controls While Loading ✅
All filter inputs are now disabled during loading:
```typescript
<Select 
  value={folderId || "all"} 
  onValueChange={(val) => setFolderId(val === "all" ? undefined : val)}
  disabled={isLoading}  // ✅ Prevents rapid changes
>
```

Applied to:
- Folder dropdown
- Album dropdown
- Search input
- Date range inputs (From/To)

### 4. Visual Feedback Improvements ✅
- **Backdrop Blur**: `backdrop-blur-sm` on overlay for depth
- **Semi-transparent Background**: `bg-ui-bg-base/80` shows content beneath
- **Loading Text**: "Loading files..." message for clarity
- **Spinner + Text**: Combined visual indicator

### 5. Hide Load More During Loading ✅
```typescript
{hasNextPage && !isLoading && (  // ✅ Only show when not loading
  <Button>Load more</Button>
)}
```

## User Experience Improvements

### Before:
1. User selects folder
2. ❌ Entire UI disappears
3. ❌ Small spinner shows
4. ❌ Content pops back in
5. ❌ Layout shifts/bounces
6. ❌ User can spam filter changes

### After:
1. User selects folder
2. ✅ Content stays visible
3. ✅ Overlay appears with spinner
4. ✅ "Loading files..." message
5. ✅ No layout shifts
6. ✅ Filters disabled during load
7. ✅ Smooth transition

## Technical Details

### Layout Structure:
```
┌─────────────────────────────────────┐
│ Filters (disabled while loading)   │
├─────────────────────────────────────┤
│ Breadcrumb                          │
├─────────────────────────────────────┤
│ ┌─────────────────────────────────┐ │
│ │ min-h-[400px] container         │ │
│ │                                 │ │
│ │ [Loading Overlay - if loading]  │ │
│ │   🔄 Loading files...           │ │
│ │                                 │ │
│ │ [Grid - always rendered]        │ │
│ │   📁 Folders                    │ │
│ │   🖼️ Files                       │ │
│ └─────────────────────────────────┘ │
│                                     │
│ [Load More - hidden while loading] │
└─────────────────────────────────────┘
```

### CSS Classes Used:
- `relative` - Position context for overlay
- `min-h-[400px]` - Prevent bouncing
- `absolute inset-0 z-10` - Full overlay coverage
- `bg-ui-bg-base/80` - Semi-transparent background
- `backdrop-blur-sm` - Blur effect
- `disabled={isLoading}` - Disable inputs

## Performance Considerations

✅ **No Performance Impact:**
- Content is rendered once and stays in DOM
- Overlay is conditional (only when loading)
- No expensive re-renders
- React Query handles caching

✅ **Better Perceived Performance:**
- Users see content immediately
- Loading state is clear
- No jarring transitions
- Professional feel

## Testing Checklist

- [x] Select different folders - no bouncing
- [x] Change filters rapidly - inputs disabled
- [x] Loading overlay appears smoothly
- [x] Content visible beneath overlay
- [x] Min-height prevents layout shifts
- [x] Load More hidden during loading
- [x] Empty state works correctly
- [x] Error state still functional

## Files Modified

1. `/src/admin/components/forms/raw-material/media-upload.tsx`
   - Removed early return for loading state
   - Added loading overlay with backdrop
   - Added min-height to grid container
   - Disabled all filter inputs during loading
   - Moved empty state inside grid
   - Hide Load More during loading

## Result

✅ **Smooth, professional loading experience**
✅ **No UI bouncing or layout shifts**
✅ **Clear visual feedback**
✅ **Prevents user errors (rapid filter changes)**
✅ **Maintains content visibility**

The FileModal now provides a polished, production-ready user experience! 🎉

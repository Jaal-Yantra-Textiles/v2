---
title: "Product Media Widget Implementation"
sidebar_label: "Product Media"
sidebar_position: 1
---

# Product Media Widget Implementation

## Overview
Implemented a media selection system for products that allows associating images from the media library with products using the MedusaJS Product API.

## Architecture

### 1. **useUpdateProduct Hook** (`src/admin/hooks/api/products.ts`)
- New mutation hook for updating products
- Supports the MedusaJS `UpsertProductImageDTO` format
- Handles cache invalidation for all product queries
- Provides toast notifications for success/error states

**Type Definition:**
```typescript
type UpdateProductPayload = {
  images?: Array<{
    url: string  // Required by MedusaJS API
  }>
  [key: string]: any
}
```

**Usage:**
```typescript
const updateProduct = useUpdateProduct()

await updateProduct.mutateAsync({
  productId: "prod_123",
  payload: { 
    images: [
      { url: "https://example.com/image1.jpg" },
      { url: "https://example.com/image2.jpg" }
    ]
  }
})
```

### 2. **Product Media Widget** (`src/admin/widgets/product-media.tsx`)
A new widget that displays and manages product images, following the same pattern as `product-designs.tsx`.

**Features:**
- ✅ Display current product images in a grid layout
- ✅ Badge showing image count
- ✅ "Add Media" button that opens `RawMaterialMediaModal`
- ✅ Individual image removal with confirmation
- ✅ Reuses existing `RawMaterialMediaModal` component
- ✅ Loading and error states
- ✅ Empty state with helpful messaging

**Widget Configuration:**
```typescript
export const config = defineWidgetConfig({
  zone: "product.details.side.after",
})
```
This places the widget in the product detail page sidebar, after other widgets.

## Data Flow

### Adding Images:
1. User clicks "Add Media" button
2. `RawMaterialMediaModal` opens with media library
3. User selects images (multi-select supported)
4. On "Save and Close", selected URLs are passed to `handleSaveMedia`
5. `useUpdateProduct` mutation is called with image URLs
6. MedusaJS API updates product with new images
7. Query cache is invalidated and UI refreshes

### Removing Images:
1. User clicks X button on an image thumbnail
2. `handleRemoveImage` filters out the removed image
3. Remaining images are sent to `useUpdateProduct`
4. MedusaJS API updates product
5. UI refreshes to show updated images

## MedusaJS API Integration

The implementation follows the official MedusaJS Product API structure:

**Reference:** https://docs.medusajs.com/resources/references/product/interfaces/product.UpsertProductImageDTO

```typescript
interface UpsertProductImageDTO {
  id?: string          // Optional: If provided, updates existing image
  url?: string         // Optional: New URL (required for creation)
  metadata?: MetadataType  // Optional: Custom data
}
```

**Our Implementation:**
- For new images: Only `url` is provided
- For updates: All existing images are sent with their URLs
- The API handles creation/update based on presence of `id`

## Component Architecture

### ProductMediaModal (New Component)
Created a standalone modal for widget context:
- **Location:** `src/admin/components/media/product-media-modal.tsx`
- **Why:** Widgets don't have `StackedModalProvider` context
- **Uses:** Standard `FocusModal` from `@medusajs/ui`
- **Props:**
  - `onSave: (urls: string[]) => void` - Callback with selected URLs
  - `initialUrls?: string[]` - Pre-selected URLs for editing
  - `trigger?: React.ReactNode` - Optional custom trigger button

### RawMaterialMediaModal vs ProductMediaModal
- **RawMaterialMediaModal:** Uses `StackedFocusModal` - requires `StackedModalProvider` (only available in `RouteFocusModal` context)
- **ProductMediaModal:** Uses standard `FocusModal` - works anywhere, including widgets

### MediaUpload
The underlying media grid component (shared):
- **Location:** `src/admin/components/forms/raw-material/media-upload.tsx`
- Uses `useEditorFiles` hook for fetching media
- Supports pagination and multi-select
- Reused by both modal variants

## UI/UX Features

### Visual Design:
- Grid layout (4-8 columns responsive)
- Thumbnail size: 80x80px
- Hover effects on remove button
- Badge showing image count
- Consistent with other widgets

### User Experience:
- Multi-select support in modal
- Visual feedback during loading
- Toast notifications for actions
- Empty state with guidance
- Disabled state during mutations

## Cache Management

The `useUpdateProduct` hook implements comprehensive cache invalidation:

```typescript
onSuccess: (data, { productId }) => {
  // Optimistic update: seed cache immediately
  if (data?.product) {
    queryClient.setQueryData(productsQueryKeys.detail(productId), { product: data.product })
    queryClient.setQueriesData({ queryKey: productsQueryKeys.details() }, (old: any) => {
      if (old?.product?.id === data.product.id) {
        return { ...old, product: data.product }
      }
      return old
    })
  }
  
  // Invalidate all product queries
  queryClient.invalidateQueries({ queryKey: productsQueryKeys.detail(productId) })
  queryClient.invalidateQueries({ queryKey: productsQueryKeys.details() })
  queryClient.invalidateQueries({ queryKey: productsQueryKeys.lists() })
}
```

This ensures:
- Immediate UI updates (optimistic)
- All cached variants are refreshed
- List views are updated
- No stale data

## Testing Checklist

- [ ] Add media to product with no existing images
- [ ] Add media to product with existing images
- [ ] Remove individual images
- [ ] Remove all images
- [ ] Cancel media selection
- [ ] Verify cache updates correctly
- [ ] Test with slow network (loading states)
- [ ] Test error scenarios
- [ ] Verify responsive layout
- [ ] Check toast notifications

## Future Enhancements

1. **Image Metadata:**
   - Add alt text support
   - Add image ordering/sorting
   - Add primary image designation

2. **Bulk Operations:**
   - Select multiple images to remove
   - Reorder images via drag-and-drop

3. **Image Preview:**
   - Lightbox for full-size viewing
   - Image details modal

4. **Upload:**
   - Direct upload from widget
   - Drag-and-drop support

## Troubleshooting

### Error: "useStackedModal must be used within a StackedModalProvider"

**Cause:** Using `RawMaterialMediaModal` (which uses `StackedFocusModal`) outside of a `RouteFocusModal` context.

**Solution:** Use `ProductMediaModal` instead, which uses standard `FocusModal`.

**Context Providers:**
```typescript
// RouteFocusModal provides StackedModalProvider
<RouteFocusModal>
  <StackedModalProvider>  {/* Automatically provided */}
    {/* RawMaterialMediaModal works here */}
  </StackedModalProvider>
</RouteFocusModal>

// Widgets don't have this provider
<Widget>
  {/* Use ProductMediaModal here */}
</Widget>
```

**Reference:** `src/admin/components/modal/route-focus-modal.tsx` (line 44)

## Related Files

- `/src/admin/hooks/api/products.ts` - Product API hooks
- `/src/admin/widgets/product-media.tsx` - Media widget
- `/src/admin/components/media/product-media-modal.tsx` - Standalone media modal (NEW)
- `/src/admin/widgets/product-designs.tsx` - Similar pattern reference
- `/src/admin/routes/inventory/[id]/raw-materials/create/media/page.tsx` - Stacked modal variant
- `/src/admin/components/forms/raw-material/media-upload.tsx` - Media grid component
- `/src/admin/components/modal/route-focus-modal.tsx` - StackedModalProvider source

## Pattern Consistency

This implementation follows established patterns:
- ✅ Widget structure matches `product-designs.tsx`
- ✅ Hook pattern matches other product hooks
- ✅ Cache invalidation matches `useLinkProductPerson`
- ✅ Component reuse from raw materials
- ✅ MedusaJS UI components throughout
- ✅ Consistent error handling and notifications

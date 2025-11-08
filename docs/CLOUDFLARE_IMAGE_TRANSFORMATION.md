# Cloudflare Image Transformation for Social Media

This document explains how we use Cloudflare Image Resizing to automatically transform images to meet social media platform requirements.

## Overview

When publishing images to Instagram or Facebook, different platforms have different requirements:

- **Instagram**: Strict aspect ratio requirements (4:5 to 1.91:1)
- **Facebook**: More flexible, but optimized sizes improve engagement

Instead of manually resizing images or storing multiple versions, we use **Cloudflare Image Resizing** to transform images on-the-fly via URL parameters.

## How It Works

### Cloudflare Image Resizing

Cloudflare provides URL-based image transformations that happen at the edge:

```
Original URL:
https://your-domain.com/image.jpg

Transformed URL (1080x1080 square):
https://your-domain.com/cdn-cgi/image/width=1080,height=1080,fit=cover/image.jpg
```

### Benefits

1. **No Storage Overhead**: Original images are stored once
2. **On-the-Fly Processing**: Transformations happen at request time
3. **Edge Caching**: Transformed images are cached globally
4. **Format Optimization**: Cloudflare can auto-convert to WebP/AVIF
5. **Quality Control**: Automatic quality optimization

## Implementation

### Image Transformer Module

Location: `src/modules/social-provider/image-transformer.ts`

```typescript
import { transformForInstagram, transformForFacebook } from './image-transformer'

// Transform for Instagram (1:1 square, 1080x1080)
const instagramUrl = transformForInstagram(originalUrl, "square")

// Transform for Facebook (optimized size)
const facebookUrl = transformForFacebook(originalUrl)
```

### Instagram Presets

We provide three Instagram-compatible presets:

```typescript
INSTAGRAM_PRESETS = {
  square: { width: 1080, height: 1080 },      // 1:1 - Most compatible
  portrait: { width: 1080, height: 1350 },    // 4:5
  landscape: { width: 1080, height: 566 },    // 1.91:1
}
```

**Default**: We use `square` (1:1) as it works for both Facebook and Instagram.

### Automatic Transformation

The `ContentPublishingService` automatically transforms images when publishing:

```typescript
// For Instagram
const transformedImageUrl = transformForInstagram(input.content.image_url, "square")
await instagramService.publishImage(igUserId, {
  image_url: transformedImageUrl,
  caption
}, token)
```

## Cloudflare Setup Requirements

### 1. Enable Image Resizing

In your Cloudflare dashboard:
1. Go to **Speed** → **Optimization** → **Image Resizing**
2. Enable Image Resizing (requires paid plan: Pro, Business, or Enterprise)

### 2. Configure Your Domain

The image transformer checks if URLs are from Cloudflare:

```typescript
function isCloudflareUrl(url: string): boolean {
  return (
    url.includes("cloudflare") ||
    url.includes("r2.dev") ||
    url.includes("/cdn-cgi/imagedelivery/")
  )
}
```

**Update this function** in `image-transformer.ts` to match your actual Cloudflare domain/R2 bucket.

### 3. URL Format

Cloudflare Image Resizing supports two URL formats:

#### Format 1: Path-based (Recommended)
```
https://your-domain.com/cdn-cgi/image/width=1080,height=1080,fit=cover/path/to/image.jpg
```

#### Format 2: Cloudflare Images (R2 + Images)
```
https://imagedelivery.net/<account-hash>/<image-id>/public
```

Our implementation uses **Format 1** (path-based).

## Transformation Parameters

### Available Options

```typescript
interface ImageTransformOptions {
  width?: number        // Target width in pixels
  height?: number       // Target height in pixels
  fit?: string         // How to fit: "scale-down" | "contain" | "cover" | "crop" | "pad"
  quality?: number     // 1-100, default: 85
  format?: string      // "auto" | "webp" | "avif" | "json"
}
```

### Fit Options

- **`cover`** (default): Resize to fill dimensions, crop if needed
- **`contain`**: Resize to fit within dimensions, no cropping
- **`scale-down`**: Like contain, but never upscale
- **`crop`**: Crop to exact dimensions
- **`pad`**: Resize and add padding to fill dimensions

## Instagram Aspect Ratio Requirements

Instagram enforces strict aspect ratio rules:

| Type | Aspect Ratio | Dimensions | Use Case |
|------|--------------|------------|----------|
| Square | 1:1 | 1080x1080 | ✅ **Recommended** - Works everywhere |
| Portrait | 4:5 | 1080x1350 | Feed posts, Stories |
| Landscape | 1.91:1 | 1080x566 | Wide photos |

**Our default**: 1:1 square (most compatible)

## Error Handling

If an image URL is **not** from Cloudflare storage:

```typescript
if (!isCloudflareUrl(imageUrl)) {
  console.warn("Image URL is not from Cloudflare storage, skipping transformation")
  return imageUrl  // Return original URL
}
```

This ensures the system works even with external image URLs.

## Testing

### Test Image Transformation

```bash
# Original image
https://your-domain.com/uploads/photo.jpg

# Transformed (1080x1080 square)
https://your-domain.com/cdn-cgi/image/width=1080,height=1080,fit=cover,quality=85,format=auto/uploads/photo.jpg
```

### Verify in Browser

1. Open the transformed URL in a browser
2. Check the image dimensions (should be 1080x1080)
3. Verify the file size is optimized

## Performance Considerations

### Caching

Cloudflare automatically caches transformed images at the edge:
- **First request**: Transformation happens (slower)
- **Subsequent requests**: Served from cache (fast)

### Bandwidth

Transformed images are typically smaller than originals:
- Original: 2-5 MB
- Transformed (1080x1080, quality=85): 200-500 KB

### Cost

Cloudflare Image Resizing pricing (as of 2024):
- **Pro Plan**: 5,000 transformations/month included
- **Business Plan**: 50,000 transformations/month included
- **Enterprise**: Custom pricing

## Troubleshooting

### Images Not Transforming

1. **Check Cloudflare Plan**: Image Resizing requires Pro or higher
2. **Verify Domain**: Update `isCloudflareUrl()` to match your domain
3. **Check URL Format**: Ensure `/cdn-cgi/image/` path is correct
4. **Review Logs**: Check console for transformation warnings

### Instagram Still Rejecting Images

1. **Verify Transformation**: Open transformed URL in browser
2. **Check Dimensions**: Should be exactly 1080x1080 for square
3. **Test with Different Preset**: Try `portrait` or `landscape`
4. **Check Original Image**: Some images may have issues regardless

### Performance Issues

1. **Enable Caching**: Ensure Cloudflare cache is working
2. **Reduce Quality**: Lower quality parameter (e.g., 75 instead of 85)
3. **Use Smaller Dimensions**: 720x720 instead of 1080x1080

## Future Enhancements

### 1. User-Selectable Presets

Allow users to choose aspect ratio in the UI:
```typescript
<Select>
  <option value="square">Square (1:1)</option>
  <option value="portrait">Portrait (4:5)</option>
  <option value="landscape">Landscape (1.91:1)</option>
</Select>
```

### 2. Smart Cropping

Use Cloudflare's gravity parameter for intelligent cropping:
```typescript
/cdn-cgi/image/width=1080,height=1080,fit=cover,gravity=auto/image.jpg
```

### 3. Video Transformation

Extend to support video resizing for Instagram Reels.

## References

- [Cloudflare Image Resizing Docs](https://developers.cloudflare.com/images/image-resizing/)
- [Instagram Image Requirements](https://developers.facebook.com/docs/instagram-api/reference/ig-user/media)
- [Facebook Image Best Practices](https://developers.facebook.com/docs/sharing/best-practices)

## Support

For issues or questions:
1. Check Cloudflare dashboard for transformation errors
2. Review console logs for warnings
3. Test transformed URLs directly in browser
4. Verify Cloudflare Image Resizing is enabled

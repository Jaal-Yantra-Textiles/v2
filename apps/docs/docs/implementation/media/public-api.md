---
title: "Public Media API Documentation"
sidebar_label: "Public API"
sidebar_position: 4
---

# Public Media API Documentation

## Overview

The public media API allows unauthenticated access to media files marked as `is_public: true`. This is useful for displaying media galleries on public-facing websites.

---

## Endpoint

```
GET /web/media
```

**Authentication**: None required (public endpoint)

---

## Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 20 | Maximum number of media items to return (max: 100) |
| `random` | boolean | true | Randomize the order of returned media |
| `type` | string | - | Filter by media type (e.g., 'image', 'video') |

---

## Response Format

```json
{
  "medias": [
    {
      "id": "media_123",
      "filename": "photo.jpg",
      "filename_disk": "uuid-filename.jpg",
      "type": "image/jpeg",
      "filesize": 1024000,
      "width": 1920,
      "height": 1080,
      "title": "Beautiful Photo",
      "description": "A description of the photo"
    }
  ],
  "count": 20,
  "total": 150
}
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `medias` | array | Array of media objects |
| `count` | number | Number of items returned in this response |
| `total` | number | Total number of public media items available |

### Media Object Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique media identifier |
| `filename` | string | Original filename |
| `filename_disk` | string | Stored filename (use for URL construction) |
| `type` | string | MIME type (e.g., 'image/jpeg') |
| `filesize` | number | File size in bytes |
| `width` | number | Image width in pixels (if applicable) |
| `height` | number | Image height in pixels (if applicable) |
| `title` | string | Media title |
| `description` | string | Media description |

---

## Usage Examples

### Basic Request

```bash
curl http://localhost:9000/web/media
```

### With Limit

```bash
curl http://localhost:9000/web/media?limit=50
```

### Without Randomization

```bash
curl http://localhost:9000/web/media?random=false
```

### Filter by Type

```bash
curl http://localhost:9000/web/media?type=image
```

### Combined Parameters

```bash
curl http://localhost:9000/web/media?limit=30&random=true&type=image
```

---

## Frontend Integration

### React/Next.js Example

```typescript
import { getPublicMedias } from '@redux/services/apiClient';

// Fetch 20 random public media items
const medias = await getPublicMedias(20);

// Construct image URLs
const imageUrl = `${process.env.NEXT_PUBLIC_AWS_S3}/${media.filename_disk}`;
```

### Direct Fetch Example

```typescript
const response = await fetch(
  'http://localhost:9000/web/media?limit=20&random=true'
);
const data = await response.json();

// Use the media
data.medias.forEach(media => {
  const url = `https://your-cdn.com/${media.filename_disk}`;
  console.log(url);
});
```

---

## Security & Privacy

### What's Exposed

- ✅ Only media marked with `is_public: true`
- ✅ Sanitized metadata (title, description, dimensions)
- ✅ File information (filename, type, size)

### What's Protected

- ❌ Private media (`is_public: false`)
- ❌ Folder structures
- ❌ Album information
- ❌ User information
- ❌ Internal metadata

---

## Performance Considerations

### Randomization

When `random=true`, the endpoint:
1. Fetches `limit * 3` items from database
2. Randomizes the order
3. Returns only `limit` items

This ensures good randomization while maintaining performance.

### Caching Recommendations

For production, consider:
- CDN caching for media URLs
- Client-side caching of media list
- Cache-Control headers (to be implemented)

---

## Making Media Public

### Via Admin Panel

1. Go to Media section
2. Select media file
3. Set `is_public: true`
4. Save

### Via API

```bash
curl -X PATCH http://localhost:9000/admin/medias/{media_id} \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"is_public": true}'
```

---

## Error Handling

### Common Errors

| Status | Error | Cause |
|--------|-------|-------|
| 500 | Failed to fetch public media | Database or workflow error |
| 400 | Invalid parameters | Malformed query parameters |

### Error Response Format

```json
{
  "message": "Failed to fetch public media",
  "type": "unexpected_state"
}
```

---

## Testing

### Test with cURL

```bash
# Test basic endpoint
curl http://localhost:9000/web/media

# Test with parameters
curl "http://localhost:9000/web/media?limit=10&random=false"

# Pretty print JSON
curl http://localhost:9000/web/media | jq
```

### Test in Browser

```
http://localhost:9000/web/media?limit=5
```

---

## Integration with Frontend

### MediaGallery Component

The `MediaGallery` component in cici.label automatically uses this endpoint:

```typescript
// src/components/media/MediaGallery.tsx
const medias = await getPublicMedias(20);

// Renders random tiles
medias.map(media => (
  <img 
    src={`${AWS_S3_URL}/${media.filename_disk}`}
    alt={media.title}
  />
))
```

---

## Future Enhancements

Potential improvements:
- [ ] Add pagination (offset/cursor-based)
- [ ] Add sorting options (date, size, name)
- [ ] Add search/filter by title/description
- [ ] Add cache headers
- [ ] Add rate limiting
- [ ] Add image transformation parameters
- [ ] Add CORS configuration

---

## Related Documentation

- Media Module Documentation
- Admin Media API
- [Frontend Integration Guide](#)

---

## Support

For issues or questions:
1. Check the error logs
2. Verify media has `is_public: true`
3. Check network requests in browser DevTools
4. Review this documentation

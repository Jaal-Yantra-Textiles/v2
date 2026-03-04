---
title: "Virtual Try-On"
sidebar_label: "Virtual Try-On"
sidebar_position: 2
---

# Virtual Try-On

Customers can upload a face photo and see themselves wearing any design they've created in the Design Editor. The feature uses the `/store/ai/tryon` backend endpoint.

## Architecture

```
Design Editor (Konva stage)
    ↓ toDataURL()                    ← garment image (base64)
TryOnModal
    ↓ FileReader.readAsDataURL()     ← face photo (base64)
generateTryOn() server action
    ↓ POST /store/ai/tryon
Backend → AI Provider → result_url
    ↓
<img> + Download link
```

## Backend

**Route:** `POST /store/ai/tryon`

**Request body:**
```json
{
  "garment_image_base64": "data:image/png;base64,...",
  "face_image_base64": "data:image/jpeg;base64,...",
  "cloth_type": "upper_body" | "lower_body" | "dress",
  "gender": "female" | "male"
}
```

**Response:**
```json
{
  "result": {
    "result_url": "https://...",
    "media_id": "optional-saved-media-id"
  }
}
```

Requires auth (`Authorization: Bearer <token>`). Returns `401` if unauthenticated.

## Frontend Files

| File | Role |
|------|------|
| `src/lib/data/ai-tryon.ts` | Next.js server action — POSTs to `/store/ai/tryon` |
| `src/modules/products/components/design-editor/components/try-on-modal.tsx` | The modal UI |
| `src/modules/products/components/design-editor/hooks/use-design-editor.ts` | `showTryOnModal` state |
| `src/modules/products/components/design-editor/components/top-bar.tsx` | Desktop "Try On" button |
| `src/modules/products/components/design-editor/components/editor-sidebar.tsx` | Mobile "Try On" button |
| `src/modules/products/components/design-editor/index.tsx` | Wires everything together |

## Server Action

`generateTryOn()` in `src/lib/data/ai-tryon.ts` returns errors **in the response object** (never throws). This is intentional — Next.js Server Actions suppress thrown errors in production for security reasons, which would hide `AUTH_REQUIRED` errors from the client.

```ts
// Good ✓
return { error: { code: "AUTH_REQUIRED", message: "..." } }

// Bad ✗ — message stripped in production
throw new Error("AUTH_REQUIRED")
```

## State Management

`showTryOnModal` / `setShowTryOnModal` live in `useDesignEditor()`, consistent with the checkout modal pattern:

```ts
const [showTryOnModal, setShowTryOnModal] = useState(false)
```

Returned from the hook, consumed by `index.tsx`.

## Cloth Type Options

| Value | Label |
|-------|-------|
| `upper_body` | Upper Body |
| `lower_body` | Lower Body |
| `dress` | Full Dress |

Default: `upper_body`

## Unauthenticated State

If `customer` prop is null/undefined, the modal shows a sign-in prompt instead of the upload controls. No API call is made.

## Generation Time

The backend AI model typically takes **~20 seconds**. A hint is shown during loading:
> *"This takes ~20 seconds…"*

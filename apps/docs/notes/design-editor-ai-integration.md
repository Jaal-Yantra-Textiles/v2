# Design Editor AI Image Generation Integration

_Last updated: 2026-01-07_

This document describes the AI image generation feature integration in the Design Editor storefront component.

---

## Overview

The AI image generation feature allows customers to generate unique design base images using AI. The feature:
- Requires customer authentication
- Uses badge preferences (style, color, body type, etc.) to guide generation
- Supports preview and commit modes
- Integrates seamlessly with the existing design editor workflow

---

## Architecture

### Backend (jyt)

```
┌─────────────────────────────────────────────────────────────────┐
│                    API Layer                                     │
│  src/api/store/ai/imagegen/route.ts                             │
│  - POST /store/ai/imagegen                                      │
│  - Requires customer authentication                             │
│  - Validates badges, reference images, mode                     │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│               Medusa Application Workflow                        │
│  src/workflows/ai/generate-design-image.ts                      │
│  - generateDesignAiImageWorkflow                                │
│  - Steps: invokeMastra → uploadImage → updateDesign            │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Mastra AI Workflow                              │
│  src/mastra/workflows/imagegen/index.ts                         │
│  - imageGenerationWorkflow                                       │
│  - Steps: buildPrompt → checkQuota → generateImage              │
│  - Uses @ai-sdk/mistral (Pixtral model)                         │
└─────────────────────────────────────────────────────────────────┘
```

### Storefront (jyt-storefront)

```
┌─────────────────────────────────────────────────────────────────┐
│                    Data Layer                                    │
│  src/lib/data/ai-imagegen.ts                                    │
│  - generateAiImage() server action                              │
│  - convertBadgesToApiFormat() utility                           │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Hook Module                                    │
│  .../hooks/modules/use-ai-generation.ts                         │
│  - useAiGeneration() hook                                       │
│  - Manages: loading, error, auth prompt, quota                  │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                Main Design Editor Hook                           │
│  .../hooks/use-design-editor.ts                                 │
│  - Integrates useAiGeneration module                            │
│  - Exposes AI state and methods                                 │
└──────────────────────────┬──────────────────────────────────────┘
                           │
            ┌──────────────┼──────────────┐
            ▼              ▼              ▼
┌───────────────┐ ┌───────────────┐ ┌───────────────┐
│ EditorSidebar │ │ EditorCanvas  │ │ AiLoginPrompt │
│ - AI section  │ │ - AI overlay  │ │ - Auth modal  │
└───────────────┘ └───────────────┘ └───────────────┘
```

---

## Files Reference

### Backend Files

| File | Purpose |
|------|---------|
| `src/api/store/ai/imagegen/route.ts` | POST endpoint for AI generation |
| `src/api/store/ai/imagegen/validators.ts` | Zod validation schemas |
| `src/api/middlewares.ts` | Auth middleware registration |
| `src/workflows/ai/generate-design-image.ts` | Medusa orchestration workflow |
| `src/mastra/workflows/imagegen/index.ts` | Mastra AI workflow (3 steps) |
| `src/mastra/index.ts` | Workflow registration |

### Storefront Files

| File | Purpose |
|------|---------|
| `src/lib/data/ai-imagegen.ts` | Server action for API calls |
| `.../hooks/modules/use-ai-generation.ts` | AI generation hook module |
| `.../hooks/use-design-editor.ts` | Main hook integration |
| `.../components/ai-login-prompt.tsx` | Login prompt modal |
| `.../components/editor-sidebar.tsx` | AI section in sidebar |
| `.../components/editor-canvas.tsx` | AI generation overlay |
| `.../index.tsx` | Main editor component |

---

## Authentication Flow

```
User clicks "Generate with AI"
         │
         ▼
    ┌─────────────────┐
    │ Check customer  │
    │ prop from SSR   │
    └────────┬────────┘
             │
     ┌───────┴───────┐
     │               │
     ▼               ▼
customer=null   customer exists
     │               │
     ▼               ▼
Show Login      Call API
  Modal              │
     │               ▼
     ▼          Show Loading
Click Login     Overlay
     │               │
     ▼               ▼
Save draft      On Success:
to localStorage  Update canvas
     │               │
     ▼               ▼
Redirect to     Set generated
/account        base URL
     │
     ▼
(User logs in)
     │
     ▼
Return to editor
     │
     ▼
Draft restored
automatically
```

---

## Component Integration

### EditorSidebar Props

```typescript
// AI Generation props (optional, for backwards compatibility)
isGeneratingAi?: boolean
aiGenerationError?: string | null
quotaRemaining?: number | null
onGenerateAi?: () => void
onClearAiError?: () => void
```

### EditorCanvas Props

```typescript
// AI Generation
isGeneratingAi?: boolean
```

### useAiGeneration Hook

```typescript
type UseAiGenerationArgs = {
  customer: CustomerInfo | null
  countryCode?: string
  badgePreferences: BadgePreferences
  design: DesignState
  setDesign: React.Dispatch<React.SetStateAction<DesignState>>
  persistDraftSnapshot: () => void
  onBaseImageGenerated?: (url: string) => void
}

type UseAiGenerationResult = {
  // State
  isGeneratingAi: boolean
  aiGenerationError: string | null
  showLoginPrompt: boolean
  lastAiGeneration: AiGenerationMetadata | null
  quotaRemaining: number | null

  // Methods
  generateAiBase: (mode?: "preview" | "commit") => Promise<void>
  dismissLoginPrompt: () => void
  handleLoginRedirect: () => void
  clearAiError: () => void
}
```

---

## API Request/Response

### Request

```typescript
POST /store/ai/imagegen
Content-Type: application/json
Authorization: Bearer <jwt_token>

{
  "mode": "preview" | "commit",
  "badges": {
    "style": "minimal",
    "color_family": "Earth, Pastels",
    "body_type": "athletic",
    "embellishment_level": "balanced",
    "occasion": "Daily, Workwear"
  },
  "materials_prompt": "Silk with subtle texture",
  "canvas_snapshot": {
    "width": 1024,
    "height": 1024,
    "layers": [...]
  }
}
```

### Response

```typescript
{
  "generation": {
    "mode": "preview",
    "preview_url": "https://...",
    "media_id": "media_123",  // only in commit mode
    "prompt_used": "A minimalist fashion design...",
    "badges": {...},
    "materials_prompt": "...",
    "generated_at": "2026-01-07T...",
    "quota_remaining": 45
  }
}
```

---

## Error Handling

| Error | Code | User Message |
|-------|------|--------------|
| Not authenticated | `AUTH_REQUIRED` | Shows login prompt modal |
| Quota exceeded | `QUOTA_EXCEEDED` | "You've reached your daily AI generation limit" |
| Generation failed | Generic | "Failed to generate AI image. Please try again." |

---

## UI Components

### AI Generation Button (Sidebar)

- Location: After "Canvas Tools" section
- Styling: Purple/blue gradient
- States: Default, Loading (spinner), Disabled
- Shows quota remaining when available

### AI Loading Overlay (Canvas)

- Full canvas overlay with blur
- Animated sparkle icon with orbiting dots
- Gradient purple/blue theme
- Message: "Generating with AI" / "Creating your unique design base..."

### Login Prompt Modal

- Shows benefits of signing in
- "Sign in to continue" primary button
- "Maybe later" secondary button
- Note: "Your design will be saved and restored after signing in"

---

## Mobile Support

- AI tab in bottom toolbar (Sparkles icon)
- Swipe-up sheet with generate button
- Same functionality as desktop

---

## Future Enhancements

1. **Actual Image Generation Service**: Replace placeholder in `generateImageStep` with real service (Replicate SDXL/Flux, DALL-E, or FAL.ai)

2. **Reference Image Support**: Allow users to upload reference images for style guidance

3. **Preview Comparison**: Side-by-side comparison of existing vs AI-generated base

4. **Regenerate with Variations**: Generate multiple variations to choose from

5. **Quota Management**: Implement actual Redis/DB-based quota tracking per customer

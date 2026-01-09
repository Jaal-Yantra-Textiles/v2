# AI Image Generation Integration Testing

This document describes the integration test setup for the AI image generation feature in the Design Editor.

## Overview

The AI image generation flow allows customers to generate fashion design images using various AI providers (Mistral, Gemini Flash, Google Imagen, Fireworks). The integration tests verify the complete end-to-end flow without consuming AI credits.

## Test Environment Detection

When running integration tests (with `TEST_TYPE` environment variable set), the Mastra workflow automatically returns mock data:

1. **Prompt Enhancement Step**: Returns a mock enhanced prompt instead of calling Mistral
2. **Image Generation Step**: Returns a sample base64 PNG image instead of calling AI providers

This ensures tests run fast and don't consume AI credits.

## Test Files

### Helper: `integration-tests/helpers/create-customer.ts`

Creates test customers with proper authentication for store API routes.

```typescript
import { createTestCustomer, getCustomerAuthHeaders, resetTestCustomerCredentials } from "../helpers/create-customer";

// Create a customer
const container = getContainer();
const { customer, authIdentity, email, apiKey } = await createTestCustomer(container);

// Get auth headers (includes JWT token + publishable API key)
const headers = await getCustomerAuthHeaders();

// Use in requests
await api.post("/store/ai/imagegen", payload, headers);
```

**Features:**
- Creates customer with email/password authentication
- Creates auth identity with proper `customer_id` in app_metadata
- Creates publishable API key using `createApiKeysWorkflow` (required for store routes)
- Generates JWT token directly (bypasses auth API for testing)
- Stores credentials for reuse across tests

### Test Suite: `integration-tests/http/ai-imagegen-e2e.spec.ts`

End-to-end integration tests for the AI image generation flow.

**Test Coverage:**

| Test | Description | Requires AI Key |
|------|-------------|-----------------|
| Generate AI image and create design | Full flow: generation → upload → design creation → customer linking | No (mocked) |
| Generate preview image | Preview mode with design history | No (mocked) |
| Require customer authentication | Verifies auth middleware | No |
| Handle missing materials_prompt | Graceful handling of optional field | No (mocked) |
| Filter designs by origin_source | Query designs with `origin_source=ai-mistral` | No (mocked) |
| Return empty array for new customer | New customer has no designs | No |
| Validate mode parameter | Rejects invalid mode values | No |
| Validate materials_prompt length | Enforces minimum length | No |
| Accept valid reference images | Validates reference image schema | No (mocked) |

## Running Tests

```bash
# Run all AI image generation tests
yarn test:integration:http integration-tests/http/ai-imagegen-e2e.spec.ts

# Run specific test
yarn test:integration:http integration-tests/http/ai-imagegen-e2e.spec.ts --testNamePattern="should validate mode"

# Run validation tests only
yarn test:integration:http integration-tests/http/ai-imagegen-e2e.spec.ts --testNamePattern="validation"
```

## Store API Authentication

Store routes require two headers:

1. **Authorization**: Bearer JWT token for customer authentication
2. **x-publishable-api-key**: Publishable API key for store access

The `getCustomerAuthHeaders()` function provides both:

```typescript
{
  headers: {
    Authorization: "Bearer eyJhbGciOiJIUzI1NiIs...",
    "x-publishable-api-key": "pk_1234567890..."
  }
}
```

## Workflow Mock Behavior

In test environment (`TEST_TYPE` is set), the Mastra workflow:

### buildPromptStep
```typescript
// Returns mock prompt instead of calling Mistral
return {
  enhanced_prompt: `Test fashion design: ${styleContext}. ${materials_prompt || ""}`,
  style_context: styleContext,
  technical_details: "Test mode - no AI enhancement",
  mode,
  customer_id,
};
```

### generateImageStep
```typescript
// Returns sample 1x1 transparent PNG instead of calling AI
return {
  image_url: "data:image/png;base64,iVBORw0KGgo...",
  enhanced_prompt,
  style_context,
  quota_remaining,
  provider_used: "test-mock",
  error: undefined,
};
```

## API Endpoints Tested

### POST `/store/ai/imagegen`

Generate an AI fashion design image.

**Request:**
```json
{
  "mode": "preview" | "commit",
  "badges": {
    "style": "Bohemian",
    "color_family": "Earth Tones",
    "body_type": "Hourglass",
    "occasion": "Casual"
  },
  "materials_prompt": "A flowy maxi dress with floral embroidery",
  "reference_images": [
    { "url": "https://example.com/ref.jpg", "weight": 0.7 }
  ]
}
```

**Response:**
```json
{
  "generation": {
    "mode": "commit",
    "preview_url": "https://storage.example.com/ai-design.png",
    "media_id": "media_123",
    "design_id": "design_456",
    "prompt_used": "Enhanced prompt...",
    "badges": { ... },
    "materials_prompt": "...",
    "generated_at": "2024-01-09T12:00:00Z",
    "quota_remaining": 45
  }
}
```

### GET `/store/custom/designs`

Retrieve customer designs with optional AI filter.

**Query Parameters:**
- `include_ai=true` - Only return AI-generated designs
- `origin_source=ai-mistral` - Filter by specific origin source
- `limit` - Number of results (default: 20)
- `offset` - Pagination offset (default: 0)

**Response:**
```json
{
  "designs": [
    {
      "id": "design_456",
      "name": "AI Design - Jan 9, 12:00 PM",
      "description": "Enhanced prompt...",
      "origin_source": "ai-mistral",
      "thumbnail_url": "https://storage.example.com/ai-design.png",
      "media_files": [{ "id": "media_123", "url": "...", "isThumbnail": true }],
      "metadata": { "ai_generation": { ... } }
    }
  ],
  "count": 1,
  "offset": 0,
  "limit": 20
}
```

## Troubleshooting

### "Publishable API key required" error

Ensure the test is using `getCustomerAuthHeaders()` which includes the publishable API key:

```typescript
const headers = await getCustomerAuthHeaders();
await api.post("/store/ai/imagegen", payload, headers);
```

### "Column origin_source does not exist" error

The test database needs migrations. The `origin_source` column was added to the design model. Run migrations on the test database.

### Tests consuming AI credits

Ensure `TEST_TYPE` environment variable is set. The test scripts set this automatically:

```bash
TEST_TYPE=integration:http yarn jest ...
```

## Design-Customer Linking

Generated designs are automatically linked to the authenticated customer using:

1. `createDesignWorkflow` with `customer_id_for_link` parameter
2. The workflow's `linkDesignToCustomerStep` creates the link using `remoteLink.create()`
3. Designs are retrievable via `/store/custom/designs` filtered by the authenticated customer

## Files Modified for Test Support

- `src/mastra/workflows/imagegen/index.ts` - Added `isTestEnvironment()` check
- `integration-tests/helpers/create-customer.ts` - New customer auth helper
- `integration-tests/http/ai-imagegen-e2e.spec.ts` - New test file

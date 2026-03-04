---
title: "AI Extract Operation"
sidebar_label: "ai_extract"
sidebar_position: 2
---

# AI Extract Operation

## What It Does

The `ai_extract` operation calls an LLM via [OpenRouter](https://openrouter.ai) and returns structured JSON extracted from unstructured text. The result is stored in the DataChain under the operation's key as:

```json
{
  "object": { /* extracted fields */ },
  "usage": {
    "promptTokens": 120,
    "completionTokens": 45,
    "totalTokens": 165
  }
}
```

**Source:** `src/modules/visual_flows/operations/ai-extract.ts`

---

## Options Schema

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `model` | `string` | No | `google/gemini-2.0-flash-exp:free` | OpenRouter model ID |
| `input` | `string` | Yes | — | Text to extract from. Supports `{{ variable }}` interpolation |
| `system_prompt` | `string` | No | — | Instructions to the LLM for how to extract |
| `schema_fields` | `SchemaField[]` | Yes | — | Fields to extract (see below) |
| `fallback_on_error` | `boolean` | No | `false` | Return `{}` instead of failing the flow on LLM error |

### SchemaField

```typescript
interface SchemaField {
  name: string;
  type: "string" | "number" | "boolean" | "enum" | "array" | "object";
  description?: string;
  enumValues?: string[];   // Required when type = "enum"
  required?: boolean;
}
```

---

## Implementation Notes

- Uses `generateText()` (not `generateObject()`) for maximum compatibility across all OpenRouter models.
- Schema fields are appended as a JSON shape hint at the end of the system prompt, instructing the LLM to return valid JSON.
- The response is parsed by extracting the first JSON block found in the LLM output.
- If `fallback_on_error` is `true`, any parsing or API error returns `{ object: {}, usage: {} }` and continues the flow.

---

## Example Configuration

Extract structured order information from a vendor email:

```json
{
  "model": "google/gemini-2.0-flash-exp:free",
  "input": "Subject: {{ $trigger.subject }}\n\n{{ $trigger.html_body }}",
  "system_prompt": "Extract order info from this vendor email. Be precise.",
  "schema_fields": [
    {
      "name": "email_type",
      "type": "enum",
      "enumValues": ["order_received", "confirmation", "shipped", "delivered", "other"],
      "required": true
    },
    { "name": "order_number", "type": "string" },
    { "name": "vendor", "type": "string" },
    { "name": "items", "type": "array" },
    { "name": "total", "type": "number" }
  ],
  "fallback_on_error": true
}
```

With this operation saved under the key `extracted`, downstream operations can reference:

| Variable | Value |
|----------|-------|
| `{{ extracted.object.email_type }}` | `"order_received"` |
| `{{ extracted.object.order_number }}` | `"PO-2024-001"` |
| `{{ extracted.object.vendor }}` | `"Acme Textiles"` |
| `{{ extracted.object.items }}` | Array of line items |
| `{{ extracted.object.total }}` | `1250.00` |
| `{{ extracted.usage.totalTokens }}` | `165` |

---

## DataChain Output Shape

```typescript
// dataChain["extracted"]
{
  object: {
    email_type: "order_received",
    order_number: "PO-2024-001",
    vendor: "Acme Textiles",
    items: [...],
    total: 1250.00,
  },
  usage: {
    promptTokens: 120,
    completionTokens: 45,
    totalTokens: 165,
  }
}
```

---

## Error Handling

| Scenario | With `fallback_on_error: false` | With `fallback_on_error: true` |
|----------|--------------------------------|-------------------------------|
| LLM API error | Flow fails, logs error | Flow continues, `object: {}` |
| Invalid JSON response | Flow fails, logs error | Flow continues, `object: {}` |
| Model not available | Flow fails, logs error | Flow continues, `object: {}` |

---
title: "AI Extract Platform Operation"
sidebar_label: "AI Extract (Platform)"
sidebar_position: 13
---

# AI Extract Platform Operation

`ai_extract_platform` is a visual-flow operation that extracts structured JSON from a text input using an admin-configured AI provider. Unlike the original [`ai_extract`](./ai-extract-operation) operation, which hardcodes the model id in the flow definition, this operation reads the provider, API key, base URL, and default model from the External Platforms registry at runtime.

**Source:** `apps/backend/src/modules/visual_flows/operations/ai-extract-platform.ts`
**Helpers:** `apps/backend/src/mastra/services/ai-platforms.ts` (`getAiPlatformForRole`, `buildChatModel`)

---

## Why this exists

The first prod test of the WhatsApp product-create flow blew up with:

```
google/gemini-2.5-flash-preview is not a valid model ID
```

That model id had been hardcoded as the default in both `ai_extract.ts` and every flow seed that used it. OpenRouter retired the preview; the seed had no way to know. More fundamentally, every flow that called an LLM had to:

- Know its provider's name ahead of time
- Bake the model id into the flow definition
- Require a backend redeploy to rotate API keys or switch providers

Rotating any of that should be a UI action. `ai_extract_platform` makes it one.

---

## How it resolves the provider

At execution time:

1. Read the `role` option (defaults to `ai_search_chat`)
2. Call `getAiPlatformForRole(container, role)` — the helper queries the SocialPlatform module for the row with `category = "ai"`, `status = "active"`, `metadata.role = <role>`, and `metadata.is_default = true`
3. Decrypt the API key from `api_config.api_key_encrypted` via the encryption module
4. Resolve `base_url`: `api_config.base_url` → platform column → provider-specific default
5. Resolve the model: `model_override` (call-site) → `api_config.default_model` → provider-specific hint
6. Call `buildChatModel(config, modelOverride)` to get an AI SDK chat model bound to the right provider
7. Run `generateText({ model, system, messages })`, then `JSON.parse` the response

If no platform is configured for the requested role, the operation returns a clean error (or empty object if `fallback_on_error: true`) — no Meta-style 500 leaking through.

### Currently configured AI platforms (prod, 2026-06-01)

| Platform | Role | Provider | Default model | is_default |
|---|---|---|---|---|
| DashScope chat | `ai_search_chat` | dashscope | `qwen-plus` | ✅ |
| Cloudflare AI chat | `ai_search_chat` | cloudflare | `@cf/meta/llama-3.1-8b-instruct` | — |
| OpenRouter | `ai_search_chat` | openrouter | `meta-llama/llama-3.3-70b-instruct:free` | — |
| DashScope embed | `ai_search_embed` | dashscope | `text-embedding-v3` | ✅ |
| Cloudflare AI embed | `ai_search_embed` | cloudflare | `@cf/baai/bge-base-en-v1.5` | — |
| FAL image gen | `ai_image_gen` | fal | — | ✅ |

W4's `extract_attrs` step uses `role: "ai_search_chat"` → currently DashScope's `qwen-plus`. Switching extraction to OpenRouter is "toggle `is_default` on the OpenRouter row in admin" — no flow edit, no redeploy.

---

## Options

| Option | Required | Default | Notes |
|---|---|---|---|
| `role` | ✅ | `ai_search_chat` | AI role to resolve. Matches `metadata.role` on the External Platform row. |
| `input` | ✅ | — | Text sent to the model. Supports `{{ }}` interpolation. |
| `system_prompt` | — | — | Instructions appended to the auto-generated schema hint. |
| `schema_fields` | — | `[]` | Array of `{ name, type, description?, enumValues?, required? }`. Renders as a JSON shape hint at the end of the system prompt. |
| `model_override` | — | platform default | One-off model id at the call site. Useful for A/B-ing without admin changes. |
| `fallback_on_error` | — | `false` | When `true`, return `{}` on any failure instead of branching to `failure`. |
| `mock_response` | — | — | If set, short-circuits the AI call and returns this object. Used in tests. |

### Schema field example

```ts
schema_fields: [
  { name: "title",           type: "string", description: "Clean product title (proper case, no price)", required: true },
  { name: "suggested_price", type: "number", description: "Numeric price in partner's currency (strip ₹/Rs/$)" },
  { name: "fabric_type",     type: "string", description: "Fabric (silk, cotton, linen, khadi, wool, …) — omit if not mentioned" },
  { name: "colors",          type: "array",  description: "Array of color names the partner wrote. Empty if none." },
]
```

These get appended to the system prompt as:

```
Return ONLY a valid JSON object — no markdown, no explanation, no code fences:
{
  "title": string [required] // Clean product title (proper case, no price),
  "suggested_price": number [optional] // Numeric price in partner's currency (strip ₹/Rs/$),
  "fabric_type": string [optional] // Fabric (silk, cotton, linen, khadi, wool, …) — omit if not mentioned,
  "colors": array [optional] // Array of color names the partner wrote. Empty if none.
}
```

---

## When to pick `ai_extract` vs `ai_extract_platform`

| | `ai_extract` (legacy) | `ai_extract_platform` |
|---|---|---|
| Model selection | Hardcoded in flow JSON | Admin UI |
| Provider rotation | Flow edit + redeploy | Toggle `is_default` |
| Multimodal support | Text-only | Text-only today; multimodal planned for this op |
| Mastra eval workflow | ✅ via `use_mastra_eval` | Not yet — drop in if needed |
| Backwards compat | Existing flows | New flows |

**Use `ai_extract_platform` for all new flows.** The legacy `ai_extract` is kept to avoid breaking flows that still hardcode a model — it's not deprecated, just shadowed.

---

## DB enum + migration discipline

`visual_flow_operation.operation_type` is a Postgres `CHECK` constraint, not a plain `text` column. Adding a new operation requires:

1. Add the new value to the `model.enum([...])` in `apps/backend/src/modules/visual_flows/models/visual-flow-operation.ts`
2. Write a migration that drops + recreates the `CHECK` with the new value **alongside every value the previous migrations added**. Missing a value (e.g. `generate_partner_deeplink` added in `Migration20260420090000`) makes the migration fail validation against existing rows.

The migration for `ai_extract_platform` is `Migration20260531000000.ts` — copy that as a template for the next op.

> **Open follow-up:** the recurring enum+migration friction is what motivated the visual-flow generalisation discussion (Tier A / Tier B in the platform notes). When that lands we can drop the CHECK and skip migrations entirely for new ops.

---

## Test plan

Until a dedicated integration spec lands:

- W4's flow execution log is the easiest end-to-end check: send a WhatsApp photo+caption, open `/app/visual-flows/<id>/executions/<exec_id>`, inspect the `extract_attrs` step's output for the extracted JSON shape
- For provider rotation: toggle a different `ai_search_chat` platform to `is_default: true` in admin → External Platforms, re-fire the flow, confirm the execution log's `platform_id` matches the new platform

---

## Related

- [AI Extract Operation](./ai-extract-operation) — the legacy hardcoded-model variant
- [WhatsApp Product Create — Draft Workflow](./whatsapp-create-draft-product) — current consumer of this operation
- `apps/backend/src/mastra/services/ai-platforms.ts` — provider resolution + AI SDK adapter

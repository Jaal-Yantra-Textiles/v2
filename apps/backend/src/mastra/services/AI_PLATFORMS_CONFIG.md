# AI platforms — admin configuration

This is the JSON shape an admin enters in `Settings → External Platforms →
Create` to register an AI provider that the storefront search (and any
future AI-using workflow) will pick up at runtime.

Until a tailored "Create AI provider" form lands (follow-up), use the
generic create flow with these fields:

| Field | Value |
|---|---|
| `name` | Human-readable label (e.g. "OpenRouter free models") |
| `category` | `ai` |
| `auth_type` | `bearer` (or `api_key`) |
| `status` | `active` |
| `base_url` | Provider base URL — optional, defaults are computed per `provider_type` |
| `api_config` (JSON) | See per-provider examples below |
| `metadata` (JSON) | `{ "provider_type": "...", "role": "...", "is_default": true }` |

## Roles supported in v1

| `metadata.role` | Used by |
|---|---|
| `ai_search_chat` | `/store/ai/search` LLM extraction of structured filters |
| `ai_search_embed` | `/store/ai/search` vector embedding for product search |
| `ai_product_description` | `workflows/ai/describe-product-image` (existing) |

Exactly one platform per role should have `metadata.is_default = true`.
A platform can serve multiple roles by creating multiple platform rows
(one per role) sharing the same underlying credentials.

## Provider types

### `openrouter`

```json
api_config: {
  "api_key_encrypted": "<encrypted via the Access tab>",
  "default_model": "meta-llama/llama-3.3-70b-instruct:free"
}
metadata: { "provider_type": "openrouter", "role": "ai_search_chat", "is_default": true }
```

`base_url` defaults to `https://openrouter.ai/api/v1`. Use `:free` model
suffixes to constrain to the free tier.

### `dashscope`

```json
api_config: {
  "api_key_encrypted": "<encrypted>",
  "default_model": "qwen-turbo"
}
metadata: { "provider_type": "dashscope", "role": "ai_search_chat", "is_default": true }
```

`base_url` defaults to
`https://dashscope-intl.aliyuncs.com/compatible-mode/v1`. For embeddings,
use `default_model: "text-embedding-v3"` (1024 dims).

### `cloudflare`

```json
api_config: {
  "api_key_encrypted": "<encrypted CF API token>",
  "account_id": "<your CF account id>",
  "default_model": "@cf/meta/llama-3.1-8b-instruct"
}
metadata: { "provider_type": "cloudflare", "role": "ai_search_chat", "is_default": true }
```

`base_url` is derived from `account_id` —
`https://api.cloudflare.com/client/v4/accounts/<account_id>/ai/v1`.
For embeddings, use `default_model: "@cf/baai/bge-base-en-v1.5"` (768 dims).

### `vercel_ai_gateway`

```json
api_config: {
  "api_key_encrypted": "<encrypted>",
  "default_model": "openai/gpt-4o-mini",
  "base_url": "https://gateway.example.com/v1"
}
metadata: { "provider_type": "vercel_ai_gateway", "role": "ai_search_chat", "is_default": true }
```

`base_url` is required — the gateway URL is account-specific.

### `custom`

Any OpenAI-compatible endpoint not covered above.

```json
api_config: {
  "api_key_encrypted": "<encrypted>",
  "base_url": "https://my-llm-proxy.example.com/v1",
  "default_model": "my-model"
}
metadata: { "provider_type": "custom", "role": "ai_search_chat", "is_default": true }
```

## Embedding provider dimension lock-in

Switching the platform used for `ai_search_embed` changes the vector
dimension of new embeddings, which is incompatible with the existing
PgVector index. When switching:

1. Drop the index: `psql $DATABASE_URL -c "DROP TABLE IF EXISTS product_search_v1 CASCADE;"`
2. Re-run the backfill: `pnpm --filter @jyt/backend exec medusa exec ./src/scripts/backfill-product-search.ts`

Dimensions per provider:

| Provider | Dims |
|---|---|
| HF local Xenova/all-MiniLM-L6-v2 | 384 |
| Google text-embedding-004 | 768 |
| Cloudflare @cf/baai/bge-base-en-v1.5 | 768 |
| DashScope text-embedding-v3 | 1024 |

## Fallback behaviour

When no platform is configured for a role, the system falls back to env
vars — every existing deployment continues to work unchanged:

| Role | Env fallback |
|---|---|
| `ai_search_chat` | OpenRouter free → DashScope (`DASHSCOPE_API_KEY`) → Cloudflare (`CLOUDFLARE_AI_*`) |
| `ai_search_embed` | `PRODUCT_SEARCH_EMBED_PROVIDER` (default `hf_local`) |
| `ai_product_description` | Existing `metadata.role = ai_product_description` lookup (predates this PR) |

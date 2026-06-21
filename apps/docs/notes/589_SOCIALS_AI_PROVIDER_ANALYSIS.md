# 589 — Social-Platforms AI Provider Analysis

## Purpose

The system uses the `SocialPlatform` model (`apps/backend/src/modules/socials/models/SocialPlatform.ts`) as a unified store for **every** external-platform integration — social-media posting, email, SMS, payment, shipping, storage, CRM, auth, Google services, **and AI/LLM providers**. AI providers are stored with `category: "ai"` and a `metadata.role` tag (e.g. `ai_search_chat`, `ai_search_embed`). The existing `ai-platforms.ts` resolver (`apps/backend/src/mastra/services/ai-platforms.ts:getAiPlatformForRole`) already resolves an AI provider from DB for a given role. The digest AI summary (#589 item 4) should reuse this same resolution path instead of hardcoding `process.env.OPENROUTER_API_KEY`.

---

## Provider registry & services

The `social-provider` module (`apps/backend/src/modules/social-provider/index.ts:SOCIAL_PROVIDER_MODULE`) exposes a `SocialProviderService` (`apps/backend/src/modules/social-provider/service.ts`) with a `getProvider(name)` method.

| Key(s) | Service file | Interface / capabilities |
|--------|-------------|------------------------|
| `"twitter"` / `"x"` | `apps/backend/src/modules/social-provider/twitter-service.ts` | `TwitterService` — OAuth1/OAuth2, tweet create, media upload, tweet metrics, PKCE flow. Reads client id/secret from `process.env.X_CLIENT_ID` / `X_CLIENT_SECRET` / `TWITTER_*` fallbacks |
| `"instagram"` | `apps/backend/src/modules/social-provider/instagram-service.ts` | `InstagramService` — Graph API via Facebook Login (no own OAuth), container creation, carousel, polling, publish. Reads no env vars |
| `"facebook"` | `apps/backend/src/modules/social-provider/facebook-service.ts` | `FacebookService` — OAuth, page token, feed/photo/video/album posting. Reads `FACEBOOK_CLIENT_ID` / `FACEBOOK_CLIENT_SECRET` |
| `"linkedin"` | `apps/backend/src/modules/social-provider/linkedin-service.ts` | `LinkedInService` — only `getAuthUrl()`. Reads `LINKEDIN_CLIENT_ID` |
| `"content-publishing"` | `apps/backend/src/modules/social-provider/content-publishing-service.ts` | `ContentPublishingService` — orchestrates Facebook + Instagram cross-publish, image transforms |
| `"whatsapp"` | `apps/backend/src/modules/social-provider/whatsapp-service.ts` | `WhatsAppService` — text/image/doc/video/interactive/template sends, media download, multi-number via `withSender()`, decrypts creds from `SocialPlatform.api_config` |
| — (Google) | `apps/backend/src/modules/social-provider/google-connection-service.ts` | `GoogleConnectionService` — stateless OAuth wrapper (auth URL, code exchange, refresh, userinfo). Not a provider in the registry; instantiated per-call with row-level `clientId`/`clientSecret` |

**Important**: the provider registry handles **social-posting and OAuth services only**. AI/LLM providers are *not* registered here — they are stored as `SocialPlatform` rows with `category: "ai"` and resolved via the separate `ai-platforms.ts` resolver.

The `providerTokenMap` (`apps/backend/src/modules/social-provider/social-provider-registry.ts`) maps `twitter`/`x`/`instagram`/`facebook`/`linkedin` → `SOCIAL_PROVIDER_MODULE` for Medusa's container DI. It does not include any AI providers.

---

## api_config shape (per provider / category)

The `SocialPlatform.api_config` column (`apps/backend/src/modules/socials/models/SocialPlatform.ts:34`) is a `model.json().nullable()` blob. Its shape is determined by the value of `api_config.provider` (for the admin forms, sourced from `data.provider_type`). Single source of truth for the per-category field map: `apps/backend/src/admin/components/social-platforms/api-config.ts:buildApiConfig()`.

### Categories relevant to this analysis

**`category: "communication"` (WhatsApp)** — `apps/backend/src/admin/components/social-platforms/api-config.ts:70-89`
```
{ provider, phone_number_id, waba_id, access_token, app_secret,
  webhook_verify_token, label, country_codes, is_default }
```
Secrets (`access_token`, `app_secret`, `webhook_verify_token`) are encrypted to `*_encrypted` blobs by the credentials subscriber. The typed interface is `WhatsAppPlatformApiConfig` (`apps/backend/src/modules/socials/types/whatsapp-platform.ts`).

**`category: "ai"`** — built by the backfill script, not by `buildApiConfig()` (no `case "ai"` in that switch). The shape is defined in `apps/backend/src/scripts/backfill-ai-platforms-from-env.ts:227-232`:
```
{ api_key, default_model?, account_id?, base_url? }
```
With `metadata` containing `{ provider_type, role, is_default, source }`. Credentials are encrypted via the same subscriber mechanism (`encryptSocialPlatformCredentials`).

The `api_config` key naming: the admin form uses `provider_type` (translated from `api_config.provider`), while `api_config` itself stores `provider`. Secrets are stored as both plaintext and `*_encrypted`. See `apps/backend/src/api/admin/social-platforms/secrets.ts` for the redaction/restore contract.

---

## Which providers are AI/LLM-capable

**None of the social-provider registry services are AI/LLM-capable.** They handle social posting, OAuth, and messaging only.

AI/LLM capability lives entirely in a separate resolution path:

1. **`getAiPlatformForRole(container, role)`** (`apps/backend/src/mastra/services/ai-platforms.ts:134-231`) — reads `SocialPlatform` rows where `category: "ai"`, `status: "active"`, `metadata.role === role`, picks the default one (or most-recently-updated), decrypts `api_key`, normalises `baseUrl`, returns `AiPlatformConfig`.

2. **`buildChatModel(config, modelOverride?)`** (`apps/backend/src/mastra/services/ai-platforms.ts:246-265`) — builds an AI SDK model from the config. For `providerType === "openrouter"` it calls `createOpenRouter({ apiKey })`; for all other types (`dashscope`, `cloudflare`, `vercel_ai_gateway`, `custom`) it calls `createOpenAI({ baseURL, apiKey })`.

3. **Supported `provider_type` values** (`apps/backend/src/mastra/services/ai-platforms.ts:41-47`): `openrouter`, `dashscope`, `cloudflare`, `vercel_ai_gateway`, `fal`, `custom`.

4. **`AiRole` values** (`apps/backend/src/mastra/services/ai-platforms.ts:49-56`): `ai_search_chat`, `ai_search_embed`, `ai_product_description`, `ai_image_gen` (plus string escape hatch). The digest summary role would be a new value like `ai_digest_summary`.

5. **The `ai_extract_platform` visual-flow operation** (`apps/backend/src/modules/visual_flows/operations/ai-extract-platform.ts:63-192`) already demonstrates the exact pattern: it calls `getAiPlatformForRole(ctx.container, role)`, then `buildChatModel(config, modelOverride)`, then `generateText({ model })`. This is the reference implementation for #589 item 4.

---

## How the digest AI gen wires OpenRouter today

In `apps/backend/src/modules/visual_flows/operations/partner-analytics-digest.ts:277-289`, when `generate_ai_summary: true`:

```ts
const aiGenerate: DigestAiGenerate | null = parsed.generate_ai_summary
  ? async ({ system, prompt, model }) => {
      const openrouter = createOpenRouter({
        apiKey: process.env.OPENROUTER_API_KEY,
      })
      const result = await generateText({
        model: openrouter(model) as any,
        system,
        messages: [{ role: "user", content: prompt }],
      })
      return result.text ?? ""
    }
  : null
```

This is a **hardcoded** `createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY })` call. It cannot be changed via admin UI — only by redeploying with a different env var. The default model is `google/gemini-2.5-flash-preview` from `DIGEST_AI_DEFAULT_MODEL` (`apps/backend/src/workflows/analytics/partner-digest-ai-lib.ts:28`).

---

## Proposed resolution contract inputs

A `resolveDigestAiProvider(container)` helper that replaces the hardcoded `createOpenRouter` call should:

1. **Call** `getAiPlatformForRole(container, "ai_digest_summary")` — reads the admin-configured default AI platform for the digest-summary role.
   - If `null` (nothing configured): resolve to a fallback (same as today's `env.OPENROUTER_API_KEY`), or throw a human-readable error telling the admin to configure it (per the `ai_extract_platform` pattern at `apps/backend/src/modules/visual_flows/operations/ai-extract-platform.ts:136-142`).
2. **Call** `buildChatModel(config, modelOverride)` — returns an AI SDK model instance regardless of provider type.
   - The `modelOverride` arg maps from `parsed.ai_summary_model` (the digest operation already has this field at `apps/backend/src/modules/visual_flows/operations/partner-analytics-digest.ts:75`).
3. **Return** an async `DigestAiGenerate` function — same seam type as `apps/backend/src/workflows/analytics/partner-digest-ai-lib.ts:35-39` — that calls `generateText({ model, system, messages })`.

**Inputs the helper would read:**
| Input | Source | Purpose |
|-------|--------|---------|
| `container` | workflow context | Resolve `SOCIALS_MODULE` for DB lookup |
| `role` | constant `"ai_digest_summary"` | Match `metadata.role` on the platform row |
| `modelOverride` | `opts?.ai_summary_model` (from operation options) | Override the platform's `default_model` at call site |

**Output**: `DigestAiGenerate` — `(args: { system, prompt, model }) => Promise<string>`.

---

## Cloudflare: Workers AI (free) vs AI Gateway (paid / BYOK) — #613

The `cloudflare` provider derives base URL `https://api.cloudflare.com/client/v4/accounts/<account_id>/ai/v1` (`apps/backend/src/mastra/services/ai-platforms.ts` ~L207), which is the **Workers AI** OpenAI-compatible endpoint. Whether a call is free depends entirely on the **model id**:

- **Free — Workers AI native models** (`@cf/…`, e.g. `@cf/meta/llama-3.1-8b-instruct`, `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, `@cf/baai/bge-base-en-v1.5` for embeddings). These run on a **free daily Neuron allocation** — no gateway balance, no BYOK. `PROVIDER_DEFAULTS.cloudflare.defaultModelHint` is already `@cf/meta/llama-3.1-8b-instruct`.
- **Paid — any non-`@cf/…` model id** (e.g. `minimax/m3`, `openai/gpt-4o`). These route through the **paid AI Gateway / BYOK** path and fail with `Insufficient balance; add money to your gateway or use BYOK` (code 2021) unless a balance / BYOK key is configured. This was the live failure that surfaced #613 (the `ai_digest_summary` CF platform's `default_model` was `minimax/m3`).

**Admin guard (#613):** the External Platforms admin warns when a `cloudflare` AI platform's `default_model` is set to a non-`@cf/…` id — both live in the Create AI provider form (under the Default model field) and on the platform detail page. The check is the pure helper `getCloudflareModelWarning(providerType, defaultModel)` in `apps/backend/src/admin/components/social-platforms/cloudflare-model-warning.ts` (empty model → no warning, provider default `@cf/…` is used). **Setting the prod `ai_digest_summary` platform's `default_model` to a `@cf/…` model is an operator action** (admin-API authored, not seeded).

## Gotchas

1. **No `case "ai"` in `buildApiConfig`**: The admin form's `api-config.ts:buildApiConfig()` has no `case "ai"` branch. AI platforms are created by the backfill script (`apps/backend/src/scripts/backfill-ai-platforms-from-env.ts`) or manually via the admin External Platforms UI, which stores `api_config` as a raw JSON blob. Adding a new role via the UI requires the admin to set `metadata.role` and `metadata.provider_type` manually. There is no admin UI dropdown for the digest-summary role yet.

2. **`ai_digest_summary` role does not exist**: The `AiRole` union in `apps/backend/src/mastra/services/ai-platforms.ts:49-56` does not include `ai_digest_summary`. The string escape hatch `(string & {})` at line 56 means it will work at runtime, but there's no enum entry and no doc hint.

3. **Default model mismatch**: The digest currently defaults to `google/gemini-2.5-flash-preview` (`apps/backend/src/workflows/analytics/partner-digest-ai-lib.ts:28`), while `ai-platforms.ts:$PROVIDER_DEFAULTS.openrouter.defaultModelHint` is `meta-llama/llama-3.3-70b-instruct:free` (`apps/backend/src/mastra/services/ai-platforms.ts:76`). If the admin-configured platform has no `default_model`, the resolved model will differ from today's hardcoded one.

4. **The `providerTokenMap` does not include AI**: `apps/backend/src/modules/social-provider/social-provider-registry.ts` only maps social platforms. The digest should NOT use `SocialProviderService.getProvider()` — it should use `getAiPlatformForRole()` from `ai-platforms.ts` instead.

5. **Encryption path**: The `ai-platforms.ts` resolver decrypts `api_key` via `decryptApiKey` (`apps/backend/src/mastra/services/ai-platforms.ts:187`), which handles both plaintext and encrypted blobs. The digest's current env-var path reads plaintext only. Switching to the DB resolver means the `api_key` may arrive decrypted from an `api_key_encrypted` blob — the `buildChatModel` path handles this transparently.

6. **`digestHasData` guard**: The `composeDigestAiSummary` function (`apps/backend/src/workflows/analytics/partner-digest-ai-lib.ts:119-134`) skips the AI call entirely when `!digestHasData(digest)`. This guard runs before any `generate` call, so a missing AI provider config only manifests for digests that actually have data.

7. **Existing `generate_ai_summary` defaults to `false`**: The digest operation (`apps/backend/src/modules/visual_flows/operations/partner-analytics-digest.ts:73`) requires explicit opt-in. Replacing the provider resolution doesn't change the UX — flows that don't set the flag still never touch the model.

8. **The `ai_extract_platform` operation is the precedent**: `apps/backend/src/modules/visual_flows/operations/ai-extract-platform.ts` already does exactly what #589 item 4 needs — resolves an AI provider from DB for a visual-flow context. The digest should follow the same pattern.

---

## Open questions / (unverified)

- What backfill/migration creates the `ai_digest_summary` role rows for existing deployments? The backfill script only handles `ai_search_chat`, `ai_search_embed`, `ai_product_description`, `ai_image_gen` — it does not seed a digest role. Admin must create it manually, or the backfill script needs an update.
- Should `resolveDigestAiProvider` return `null` (caller falls back to env var) or throw (admin must configure) when no platform is found? The `ai_extract_platform` op throws with a clear message (`ai-extract-platform.ts:142`); the digest operation has `continue_on_error` semantics. The resolution should probably return `null` and let the caller's existing best-effort path (return null, leave `ai_summary` unset) handle it.
- The `DIGEST_AI_DEFAULT_MODEL` constant (`partner-digest-ai-lib.ts:28`) is referenced as a fallback — after the switch, should it be removed entirely (the platform's `default_model` replaces it) or kept as a secondary fallback when no platform default is set either?

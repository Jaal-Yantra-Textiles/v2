# Env vars → External Platforms migration audit

Generated 2026-05-21. Source of truth for prod env vars is
`deploy/aws/copilot/medusa-server/manifest.yml` (60 SSM-backed secrets
under `/jyt/prod/`). Source of truth for code usage is
`grep -rE "process\.env\.[A-Z_]+" apps/backend/src --include="*.ts"`
(184 unique vars).

The goal is to move provider credentials and admin-tunable configs out
of env vars and into the `SocialPlatform` table behind the
`/admin/settings/external-platforms` UI, so an operator can rotate keys
or switch providers without a deploy.

## Categorisation

### A. MUST stay env (bootstrap / framework / can't safely DB-look-up)

These run **before** the DB can be queried (encryption keys, the DB
connection itself, framework config). Leave them as-is.

| Env | Used by | Reason |
|---|---|---|
| `DATABASE_URL`, `POSTGRES_CONNECTION_STRING`, `MASTRA_DATABASE_URL` | Medusa core + Mastra | DB connection itself — chicken-and-egg |
| `REDIS_URL` | Medusa cache, Bull queues | Same as above |
| `COOKIE_SECRET`, `JWT_SECRET` | Medusa auth | Bootstraps session signing |
| `ENCRYPTION_KEY`, `ENCRYPTION_KEY_V1`, `ENCRYPTION_KEY_VERSION` | encryption module | Decrypts everything else, including the SocialPlatform api_configs |
| `NODE_ENV`, `CI`, `TEST_TYPE`, `DEBUG` | tooling / build | Process-level |
| `MEDUSA_FF_*` (CACHING, INDEX_ENGINE, VIEW_CONFIGURATIONS, TRANSLATION) | medusa-config | Feature flags read at startup |
| `MEDUSA_BACKEND_URL`, `FRONTEND_URL`, `STORE_URL`, `BACKEND_URL`, `API_BASE_URL`, `APP_URL`, `URL`, `ROOT_DOMAIN`, `PARTNER_UI_URL` | URL composition | Cross-service routing — typically config-as-code |
| `*_CORS` (ADMIN, STORE, AUTH, PARTNER, WEB) | Medusa CORS | Read at startup, no admin churn |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_S3_BUCKET`, `AWS_S3_ENDPOINT` | medusa-config file module | Read at module init — could go to platform if we wrap medusa's `file` module but high risk |
| `S3_*` (file storage) | Medusa file module + R2 uploads | Same as above |

### B. ALREADY supported via SocialPlatform (env is the fallback)

These have a `category` + the `SocialPlatform` row exists in the UI;
some callsites still read env, some read the DB.

| Env | Category | Status |
|---|---|---|
| `OPENROUTER_API_KEY`, `DASHSCOPE_API_KEY`, `CLOUDFLARE_AI_*`, `MISTRAL_API_KEY` | `ai` | **DB lookup wired** (#242), env fallback. Backfill script available. |
| `STRIPE_API_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_KEY` | `payment` | UI category exists; partner subscription route still reads env directly |
| `PAYU_MERCHANT_KEY`, `PAYU_MERCHANT_SALT`, `PAYU_MODE` | `payment` | Per-partner via `assign-payu-to-partner` script; needs SocialPlatform binding to fully migrate |
| `FACEBOOK_CLIENT_ID`, `FACEBOOK_CLIENT_SECRET`, `FACEBOOK_REDIRECT_URI`, `FACEBOOK_WEBHOOK_VERIFY_TOKEN` | `social` | OAuth flow already uses SocialPlatform for tokens; OAuth app credentials are still env |
| `GOOGLE_REDIRECT_URI` (+ Google client credentials in the social platform) | `google` | Similar to Facebook |
| `X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_REDIRECT_URI`, `X_SCOPE`, `X_API_KEY`, `X_API_SECRET` | `social` | OAuth app creds still env |
| `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_INITIATION_TEMPLATE*` | `communication` | UI form exists for WhatsApp; defaults still read from env when no platform configured |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | `email` | Module wraps Resend directly; SocialPlatform category=email exists but isn't consumed by the wrapper |
| `MAILJET_API_KEY`, `MAILJET_SECRET_KEY`, `MAILJET_FROM_*` | `email` | Same as Resend — module reads env |
| `MAILEROO_API_KEY`, `MAILEROO_FROM_*` | `email` | Same |
| `DELHIVERY_API_TOKEN`, `DELHIVERY_SANDBOX` | `shipping` | UI category exists; shipping module reads env |
| `FAL_KEY` | `ai` (new role: ai_image_gen) | Used in `workflows/media/create-products-from-media`; one more AI role |

### C. CI / external-system credentials (lower migration value)

These are used by automation scripts that an admin won't typically
touch through the UI. Migrating them is more complex (some are
process-spawn-time, some are needed by the deploy pipeline itself).

| Env | Used by | Notes |
|---|---|---|
| `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, `VERCEL_STOREFRONT_REPO`, `VERCEL_STOREFRONT_BRANCH`, `VERCEL_STOREFRONT_ROOT_DIR` | partner storefront provisioning | Could go to a "deployment" platform row but rarely changes |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID` | DNS automation (ACM cutover, etc.) | Single-value; minimal admin churn |
| `SENTRY_DSN` | observability | Read at boot; not admin-rotating |
| `ADMIN_OPENAPI_CATALOG_*` | admin RAG | Internal RAG plumbing |

### D. Tunables (worth UI exposure, not credentials)

Same shape as platform config but value type is "preference"
rather than secret.

| Env | Owner | Pattern |
|---|---|---|
| `PRODUCT_SEARCH_EMBED_PROVIDER`, `ADMIN_RAG_EMBED_PROVIDER` | AI search | Could be a "default role" pick in the UI rather than a separate env |
| `AI_LLM_RATE_LIMIT_DELAY_MS`, `AI_LLM_MIN_DELAY_MS`, `AI_V3_*`, `AI_SPEC_*` | Mastra internals | Operator-facing; small JSON of tunables on a singleton SocialPlatform row |

## Recommended migration order (highest value, lowest risk first)

1. **Email providers (Resend, Mailjet, Maileroo).** UI category exists,
   module-level wrappers are small (one file each), failure mode is
   benign (transactional email retry path). One PR per provider; pattern
   reusable across all three. ETA: ~1 day total.

2. **WhatsApp.** UI form already exists. Wrapper reads `WHATSAPP_*` env
   vars; route the lookup through SocialPlatform.

3. **FAL (AI image gen).** Tiny — one workflow callsite. Add as a new
   AI role `ai_image_gen` so it composes with the existing AI provider
   work.

4. **Delhivery (shipping).** Single-provider; UI category exists.

5. **Stripe + PayU (payment).** Trickier because credentials are
   per-store / per-partner. Defer until per-region or per-partner
   binding shape is clear.

6. **OAuth app credentials (Facebook, Google, X).** Highest complexity
   — redirect URIs are environment-aware. Tackle last.

## Out of scope

Anything in Category A. Migrating bootstrap secrets to DB just
adds a chicken-and-egg failure mode at startup with no operational
upside.

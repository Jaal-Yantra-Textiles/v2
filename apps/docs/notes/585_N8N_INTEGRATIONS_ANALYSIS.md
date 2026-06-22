# n8n Integration Parity — Grounded Analysis

## 1. Summary & Goal

n8n ships ~400 node types, each with a typed credential class (OAuth2, API Key, Basic Auth, etc.) and a declarative node description. Our visual-flows engine has ~30 `OperationDefinition` entries registered in a global `OperationRegistry` (`apps/backend/src/modules/visual_flows/operations/index.ts:37-110`). Today, any operation that calls an external API requires the user to paste raw tokens into its `optionsSchema` — there is no typed credential store, no credential-node binding, and no connector abstraction.

**Goal:** scope an abstraction that gives flow authors an n8n-style experience: pick a service (Shopify, Stripe, Slack, …), JYT resolves stored credentials from the DB, injects them into the HTTP call at execution time, and the flow definition never sees a raw secret.

## 2. What We Already Have

| n8n concept | JYT primitive | file & symbol |
|---|---|---|
| **Node / operation** | `OperationDefinition` (type, name, category, optionsSchema, execute) | `apps/backend/src/modules/visual_flows/operations/types.ts:49-83` (`OperationDefinition`) |
| **Node registry** | `OperationRegistry` (Map<string,OperationDefinition>, registered in `registerBuiltInOperations()`) | `apps/backend/src/modules/visual_flows/operations/types.ts:88-117` (`OperationRegistry`); `apps/backend/src/modules/visual_flows/operations/index.ts:69-110` (`registerBuiltInOperations`) |
| **Generic HTTP node** | `httpRequestOperation` (type `http_request`) — raw fetch, headers interpolated from `options.headers` | `apps/backend/src/modules/visual_flows/operations/http-request.ts:5-122` (`httpRequestOperation`) |
| **Bulk HTTP node** | `bulkHttpRequestOperation` (type `bulk_http_request`) — iterates array, same fetch pattern | `apps/backend/src/modules/visual_flows/operations/bulk-http-request.ts:16-179` (`bulkHttpRequestOperation`) |
| **Code node** | `executeCodeOperation` (type `execute_code`) — sandboxed JS via `new Function` or `isolated-vm` | `apps/backend/src/modules/visual_flows/operations/execute-code.ts:236-427` (`executeCodeOperation`); `apps/backend/src/modules/visual_flows/operations/isolated-runner.ts:224-316` (`runInIsolate`) |
| **Credentials store** | `SocialPlatform` model — generic external-API record (`category`, `auth_type`, `base_url`, encrypted `api_config`, `metadata`, `status`) | `apps/backend/src/modules/socials/models/SocialPlatform.ts:19-48` (`SocialPlatform`) |
| **At-rest encryption** | `EncryptionService` — AES-256-GCM `encrypt`/`decrypt`, key rotation via version tags | `apps/backend/src/modules/encryption/service.ts:27-200` (`EncryptionService`) |
| **Token decrypt helpers** | `decryptApiKey()`, `decryptAccessToken()` etc. — resolve `EncryptionService` from container, handle encrypted + plaintext fallback | `apps/backend/src/modules/socials/utils/token-helpers.ts:228-241` (`decryptApiKey`); `apps/backend/src/modules/socials/utils/token-helpers.ts:20-57` (`decryptAccessToken`) |
| **DB-backed credential resolution pattern** | `aiExtractPlatformOperation.execute()` calls `getAiPlatformForRole(container, role)` which lists `SocialPlatform` by `category:"ai"` + `metadata.role`, decrypts, returns `AiPlatformConfig` | `apps/backend/src/modules/visual_flows/operations/ai-extract-platform.ts:126-191` (`aiExtractPlatformOperation.execute`); `apps/backend/src/mastra/services/ai-platforms.ts:138-235` (`getAiPlatformForRole`) |
| **Admin CRUD** | `GET/POST /admin/social-platforms` + `GET/POST/DELETE /admin/social-platforms/:id` | `apps/backend/src/api/admin/social-platforms/route.ts:115-182` (GET/POST); `apps/backend/src/api/admin/social-platforms/[id]/route.ts:128-198` (GET/POST/DELETE) |
| **Secret redaction** | `redactApiConfig()` strips ciphertext + plaintext from API responses; MFA-gated reveal via `isSecretRevealAllowed()` | `apps/backend/src/api/admin/social-platforms/secrets.ts:70-110` (`redactApiConfig`); `apps/backend/src/api/admin/social-platforms/secrets.ts:125-145` (`isSecretRevealAllowed`) |
| **Interpolation** | `interpolateString()` / `interpolateVariables()` — `{{ var.path }}` against `DataChain` | `apps/backend/src/modules/visual_flows/operations/utils.ts:7-48` |

## 3. Gap Analysis

### 3a. No Typed Credential Store

`SocialPlatform` (`apps/backend/src/modules/socials/models/SocialPlatform.ts:19`) is a **single generic table** with fields `category` (free-text), `auth_type` (oauth2/oauth1/api_key/bearer/basic), and `api_config` (opaque JSON blob). It works for today's social/communication platforms (WhatsApp, Meta Ads) and the AI-platform abstraction (`apps/backend/src/mastra/services/ai-platforms.ts:78-101`), but it lacks:

- **Per-credential-type field schema** — there is no registry that says "a Stripe credential needs fields `api_key` (bearer token) and is validated as a valid Stripe key". The `category` + `auth_type` fields exist but there is no typed `CredentialTypeDefinition` analogue to `OperationDefinition`.
- **Per-type validation** — the admin API accepts any JSON in `api_config`; no schema-enforced shape per credential type.
- **Per-node auth injection** — no operation's `optionsSchema` has a `credential_id` field. The execute function has no "resolve credential by id, extract auth header, inject into request" step.

### 3b. No Connector Registry

n8n has a two-level registry: credential types (describing what auth fields a service needs) and node types (describing the operations a service exposes). We have the second level (`OperationRegistry` at `apps/backend/src/modules/visual_flows/operations/types.ts:88`) but no first level. Each integration is hand-coded:

- `httpRequestOperation` (`apps/backend/src/modules/visual_flows/operations/http-request.ts:5`) — a single generic HTTP call, no Shopify/Stripe/Slack flavour.
- `bulkHttpRequestOperation` (`apps/backend/src/modules/visual_flows/operations/bulk-http-request.ts:16`) — same, with item iteration.
- `executeCodeOperation` (`apps/backend/src/modules/visual_flows/operations/execute-code.ts:236`) — raw sandbox, user writes auth import logic.

### 3c. No Per-Node Auth Injection

`httpRequestOperation.execute()` at `apps/backend/src/modules/visual_flows/operations/http-request.ts:27-121` constructs headers as:

```ts
const headers = interpolateVariables(options.headers || {}, context.dataChain)
fetch(url, { headers: { "Content-Type": "application/json", ...headers }, ... })
```

There is **no `credential_id` option**, no lookup to `SocialPlatform`, no decryption, no injection. The user must paste `Authorization: Bearer <token>` into the `headers` field manually.

The same applies to `bulkHttpRequestOperation.execute()` at `apps/backend/src/modules/visual_flows/operations/bulk-http-request.ts:58-178` (base headers built at line 84-87, no credential injection), and `executeCodeOperation.execute()` at `apps/backend/src/modules/visual_flows/operations/execute-code.ts:264-426` (the sandbox has `fetch` but no pre-configured credential).

## 4. Proposed Abstraction

### 4a. Credential Concept

A **credential** is a `SocialPlatform` row (reuse existing table & encryption) with:
- `category` = an integration category (e.g. `"crm"`, `"payment"`, `"storage"`, `"analytics"`)
- `auth_type` = `"api_key"` | `"bearer"` | `"basic"` | `"oauth2"` | `"oauth1"`
- `api_config` = encrypted JSON following a type-specific schema (e.g. for `"bearer"` auth, the config has `api_key_encrypted`)
- `metadata.type` = a machine-readable credential-type identifier (e.g. `"stripe"`, `"shopify"`, `"slack"`, `"sendgrid"`)

This mirrors n8n's credential model: each credential has a `type` (determining which auth fields the UI renders) and `data` (the encrypted field values). The `type` is separate from `category` so a single service like Slack (category: `"communication"`) can have its own credential type.

### 4b. Credential-Type Registry

A new `CredentialTypeDefinition` interface, parallel to `OperationDefinition` (`apps/backend/src/modules/visual_flows/operations/types.ts:49-83`):

```ts
// conceptual
interface CredentialTypeDefinition {
  type: string           // "stripe" | "shopify" | "slack" | …
  name: string           // Display name
  authType: "api_key" | "bearer" | "basic" | "oauth2" | "oauth1"
  fields: Array<{ name: string; label: string; type: "string" | "secret" | "url"; required: boolean }>
  test?: (apiKey: string, baseUrl?: string) => Promise<boolean>  // optional connectivity test
}
```

Registered in a `CredentialTypeRegistry` singleton (same pattern as `OperationRegistry` in `apps/backend/src/modules/visual_flows/operations/types.ts:88-117`). The admin "add credential" form is rendered from the registry: pick a type → see the required fields → fill → saved to `SocialPlatform`.

### 4c. Credential Resolver Helper

A pure(ish) helper that resolves a credential by id and returns auth headers:

```ts
// conceptual
async function resolveCredentialHeaders(
  credentialId: string,
  container: MedusaContainer
): Promise<Record<string, string>>
```

Built on:
- `socials.listSocialPlatforms({ id: credentialId })` — pattern from `apps/backend/src/mastra/services/ai-platforms.ts:151-159`
- `decryptApiKey(apiConfig, container)` — from `apps/backend/src/modules/socials/utils/token-helpers.ts:228-241`
- Returns `{ "Authorization": "Bearer <decrypted>" }` or `{ "Authorization": "Basic <base64>" }` etc. depending on `auth_type`

### 4d. Credential Injection at execute() Time

Add an **optional** `credential_id` field to `optionsSchema` on `http_request`, `bulk_http_request`, and `execute_code`. In `execute()`:

1. If `credential_id` is set, resolve headers via the resolver helper.
2. Merge resolved headers into the request (resolved cred headers win over user-supplied duplicates, so `Authorization` can be injected without the user touching it).
3. The flow definition persists only the `credential_id` — never the raw token.

## 5. Reuse-vs-New Decision

**Recommendation: reuse SocialPlatform + add a thin credential-type registry.** Do NOT create a new `credentials` module. Rationale:

| Option | Tradeoffs |
|---|---|
| **New `connections`/`credentials` module** | Duplicates SocialPlatform's encryption, admin CRUD, and redaction logic. Adds migration + model definition + module registration + admin routes. Harder to justify unless SocialPlatform's schema diverges fundamentally. |
| **Reuse SocialPlatform + add credential-type registry** | Zero new tables. Reuses `EncryptionService` (`apps/backend/src/modules/encryption/service.ts`), `decryptApiKey` (`apps/backend/src/modules/socials/utils/token-helpers.ts:228`), admin CRUD routes (`apps/backend/src/api/admin/social-platforms/route.ts`), and secret redaction (`apps/backend/src/api/admin/social-platforms/secrets.ts:70`). Only new code is the in-memory registry + resolver helper. |

The `SocialPlatform` model already has `category`, `auth_type`, `base_url`, encrypted `api_config`, and `metadata` — everything a credential needs. The only missing piece is the **type registry** that tells the UI "for a Stripe credential, render fields: `api_key` (secret), `base_url` (url)".

**Downside of reuse:** SocialPlatform has existing relationships (`hasMany` to `SocialPost`, `AdAccount`, `Lead`, `SocialPlatformBinding`, `GoogleAdsCustomer` — `apps/backend/src/modules/socials/models/SocialPlatform.ts:43-47`). Adding a generic `credential_id` column to `VisualFlowOperation.options` is fine, but if credential-to-node binding becomes a many-to-many over time, a join table might be cleaner.

## 6. PR-by-PR Plan

### PR1: Credential Resolver Helper

- **What:** A pure helper `resolveCredentialHeaders(id, container) → Record<string,string>` in `apps/backend/src/modules/visual_flows/operations/` (or a new `credentials/` subfolder).
- **Logic:** Lists `SocialPlatform` by id via `listSocialPlatforms`, reads `auth_type` + `api_config`, calls `decryptApiKey()` — pattern from `apps/backend/src/mastra/services/ai-platforms.ts:138-235` (`getAiPlatformForRole`). Returns auth headers appropriate to `auth_type` (Bearer, Basic, etc.).
- **Test:** Pure unit test — mock `listSocialPlatforms` + `decryptApiKey`, assert returned header map.

### PR2: Add `credential_id` to `http_request`

- **What:** Add `credential_id: z.string().optional()` to `httpRequestOperation.optionsSchema` at `apps/backend/src/modules/visual_flows/operations/http-request.ts:12-18`.
- **What:** In `execute()`, before the `fetch` call (line 54), if `credential_id` is set, call resolver and merge into `headers`.
- **Test:** Integration test — create a `SocialPlatform` row with a known `api_key`, run a flow with `http_request` + `credential_id`, verify the request includes the resolved auth header.

### PR3: Add `credential_id` to `bulk_http_request`

- **What:** Same as PR2 for `bulkHttpRequestOperation.optionsSchema` at `apps/backend/src/modules/visual_flows/operations/bulk-http-request.ts:23-47`.
- **What:** Same injection in `execute()` at line 84 (base headers construction).
- **Test:** Same pattern as PR2, with iteration.

### PR4: Credential-Type Registry

- **What:** New file (e.g. `credential-types.ts`) defining `CredentialTypeDefinition` interface + `CredentialTypeRegistry` singleton (pattern from `apps/backend/src/modules/visual_flows/operations/types.ts:49-117`).
- **What:** Seed the registry with 3-5 common types (Stripe, Shopify, Slack, SendGrid, OpenAI API Key) — each declaring what `auth_type` and `api_config` fields it expects.
- **What:** Wire the registry into the admin credential form so the UI renders type-specific fields (future — this PR can just define the registry + expose a GET endpoint listing types).
- **Test:** Pure unit — register a type, assert `get("stripe").fields` returns expected shape.

### PR5 (optional): Admin Credential UI Surfacing

- **What:** Frontend component that queries the credential-type registry, renders type-specific fields on the credential create/edit form.
- **Test:** E2E / visual. Can be done separately.

### PR6 (stretch): Connector-Node Scaffolding

- **What:** An authoritative pattern for building high-level connector nodes (e.g. a `shopify_get_products` operation that wraps `http_request` + credential injection + Shopify-specific response parsing). This is a convention + one reference implementation, not a framework change.
- **Test:** Integration — create a Shopify credential row, run the connector node, verify correct API call.

## 7. Open Questions / Product Decisions

1. **Multi-tenant scoping:** Are credentials partner-scoped or platform-global? The current `SocialPlatform` table has no `partner_id` or `store_id` column — it is platform-wide. If credentials need to be per-store/per-partner, the resolver must filter by scope. The `aiExtractPlatformOperation` pattern (`apps/backend/src/mastra/services/ai-platforms.ts:138`) assumes one global config per role, so for now: **platform-global**. Add per-scope filtering as a later enhancement.

2. **OAuth refresh inside flows:** The `SocialPlatform` model already stores `refresh_token_encrypted` (`apps/backend/src/modules/socials/utils/token-helpers.ts:66-83`). The `ai-platforms.ts` pattern does NOT handle OAuth refresh — it reads a static `api_key`. For OAuth2 credentials, the resolver would need to check expiry and call a refresh endpoint during `execute()`. **Out of scope for initial PRs** — start with API-key/bearer credentials only.

3. **Secret redaction in flow logs:** `VisualFlowExecutionLog` at `apps/backend/src/modules/visual_flows/service.ts:347-362` (`addExecutionLog`) records `input_data` and `output_data`. If a resolved credential gets injected into headers, those headers will be logged. The resolver should return a **marked** header object that `addExecutionLog` redacts from the audit trail. This is a security requirement, not a nice-to-have.

4. **Credential rotation:** If a credential is rotated in the admin UI, in-flight flows continue with stale headers. This matches n8n's behaviour (credential is read at node-execution time, so next execution picks up the new value). No change needed — the resolver reads from DB each time.

5. **Data-chain exposure:** Should `credential_id` support `{{ }}` interpolation (dynamic credential selection from upstream data)? n8n does not — credentials are static per node. Recommend the same: `credential_id` is a static id in the flow definition, not interpolated.

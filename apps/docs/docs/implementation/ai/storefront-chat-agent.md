---
title: "Storefront Chat Agent"
sidebar_label: "Storefront Chat Agent"
sidebar_position: 11
---

# Storefront Chat Agent

Status: in progress (Phase 1)

## Goal

Make the home modal feel like a small concierge:

1. **Onboarding** — quick capture of preferences when a user first opens the chat (colors, styles, materials, price range, fit/size).
2. **Free chat** — open-ended Q&A about Cici Label (custom design at `/design`, sustainability, sizing) AND product search.
3. **Streaming** — tokens arrive as the model generates.

## Architecture

```
Browser
  │  EventSource / AI-SDK useChat
  ▼
Next.js API route (apps/storefront/src/app/api/ai-chat/route.ts)
  │  proxies request server-side using MEDUSA_BACKEND_URL
  ▼
POST /store/ai/chat                              ← SSE endpoint (Medusa backend)
  │  AI-SDK streamText(...) with tools
  ▼
storefrontChatAgent  (apps/backend/src/mastra/agents/storefront-chat.ts)
  - DB-configured LLM (DashScope qwen by default)
  - system prompt: brand voice + onboarding logic + corpus
  - tools:
      • search_products({query, color?, material?, max_price?, limit})
      • (later) save_preferences({colors?, styles?, materials?, price_range?, body?})
      • (later) get_brand_info({topic})
```

`/store/ai/search` (the GET non-streaming endpoint) stays as-is for the
`/store` inline grid. Two surfaces, two endpoints.

## Data shapes

**Preferences** (`apps/storefront/src/lib/util/ai-chat-preferences.ts` ←
versioned localStorage; mirrored on server later):

```ts
type UserPrefs = {
  colors?: string[]              // ["white", "indigo", "natural"]
  styles?: string[]              // ["minimal", "bohemian"]
  materials?: string[]           // ["cotton", "silk", "linen"]
  price_range?: { min?: number; max?: number }
  body?: { size?: string; fit?: "relaxed" | "fitted" }
  notes?: string
}
```

**Chat message** (extends the current `AiChatMessage`):

```ts
type AiChatMessage = {
  id, role, content, ts, products?, interpretation?,
  partial?: boolean      // true while streaming
  tool_calls?: Array<{ name; args; result_summary }>
}
```

**Request body** to `POST /store/ai/chat`:

```ts
{
  messages: AiChatMessage[]
  prefs?: UserPrefs
  visitor_id: string        // required — see "Visitor ID" below
}
```

## Visitor ID

`localStorage["jyt_visitor_id"]` already exists in the storefront —
cart.ts stamps it on cart metadata, analytics workflows consume it.
Reuse it.

- Chat request body includes `visitor_id`. Server action reads
  `localStorage["jyt_visitor_id"]` before calling the proxy route.
- Backend persists threads keyed by `visitor_id` (anonymous-friendly).
- On customer login, attach `customer_id` to existing threads matching
  `visitor_id` and `customer_id IS NULL` — same merge pattern as cart
  attribution.
- Same id ties to existing analytics events, so a single visitor's
  chat → product → purchase flow joins in the analytics store.

(Persistence module ships in Phase 2.)

## Custom design — the real flow

`/design` already exists with a full DesignEditorWrapper. The flow:

1. **`/design`** — canvas + layer tools.
2. Upload an idea (image / sketched in editor).
3. Pick **inventory (fabric)** from the catalogue.
4. Pick a **partner** (or auto-assign).
5. Production run starts after partner accepts.

Docs the brand-knowledge corpus references:

- [`media/design-to-product`](../../guides/media/design-to-product.md)
- [`designs/send-to-partner-migration`](../designs/send-to-partner-migration.md)
- [`designs/production-run-convergence-plan`](../designs/production-run-convergence-plan.md)
- [`protocol/design/cici-label`](../../protocol/design/cici-label.md)

Agent answer for "how do I do a custom design?":

> You can do it all online via [/design](/design). The editor lets you
> upload an idea or sketch, pick the fabric from our inventory, and
> either choose a partner you'd like to make it or let us assign one.
> A production run starts once a partner takes the design — track it
> from your account.

## Files

**Phase 1 — minimum viable streaming chat:**

Backend:
- `apps/backend/src/mastra/data/storefront-brand-knowledge.md`
- `apps/backend/src/mastra/agents/storefront-chat.ts`
- `apps/backend/src/mastra/agents/tools/storefront-search-products.ts`
- `apps/backend/src/api/store/ai/chat/route.ts`
- `apps/backend/src/api/store/ai/chat/validators.ts`
- `apps/backend/src/api/middlewares.ts` — wire SSE route

Storefront:
- `apps/storefront/src/lib/util/ai-chat-preferences.ts`
- `apps/storefront/src/lib/util/visitor-id.ts`
- `apps/storefront/src/app/api/ai-chat/route.ts` — proxy
- `apps/storefront/src/modules/home/components/ai-search-chat/onboarding.tsx`
- `apps/storefront/src/modules/home/components/ai-search-chat/index.tsx` — major rewrite

**Phase 2:**
- `save_preferences` and `get_brand_info` tools
- `chat_threads` module (visitor_id → messages persistence)
- `POST /store/ai/chat/thread` (sync on sign-in)

**Phase 3+ (carried over):**
- UI to set default chat platform in External Platforms
- Region-aware pricing in search results
- HeroSeenMarker cookie reliability

## Streaming implementation

- Backend: AI-SDK `streamText({ model, system, tools, messages })` and
  return `result.toDataStreamResponse()` — emits the AI-SDK data-stream
  format the `@ai-sdk/react` hooks understand.
- Storefront proxy: a Next.js API route that forwards body to backend
  and pipes the response back unmodified. Keeps `MEDUSA_BACKEND_URL`
  server-only.
- Client: AI-SDK `useChat` hook (or hand-rolled `fetch` + stream
  reader) consuming `/api/ai-chat`. Renders partial assistant
  bubbles + tool-call indicators ("🔎 looked up …").

## Open questions

1. **Body fit capture** — sizes (XS/S/M/L) + relaxed/fitted only.
   Skip body-shape (apple/pear) — subjective and not actionable.
2. **Price slider currency** — detect from `countryCode`, default INR.
3. **Save prefs server-side immediately if signed in?** Yes, same pattern
   as the desk workspace.
4. **Tool-call latency UI** — stream a "🔎 looking …" placeholder, then
   replace with the real bubble. Yes.
5. **OpenRouter free for tool use?** Most don't reliably handle tool
   calls. Default the chat role to a DashScope or Cloudflare model.
6. **Should the agent navigate the customer?** No — embed `<a href>` in
   the response text, let the user click. Safer.

## Phasing

- **Phase 1** (this PR): onboarding + streaming endpoint + `search_products` only. Brand knowledge ships as system-prompt injection. Visitor-id flows through but no DB persistence yet.
- **Phase 2:** `save_preferences`, `get_brand_info`, `chat_threads` module, sign-in attribution.
- **Phase 3:** UI control for default chat platform + region-aware pricing + HeroSeenMarker investigation.

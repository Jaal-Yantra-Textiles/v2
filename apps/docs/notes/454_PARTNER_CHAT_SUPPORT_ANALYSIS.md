# #454 — Partner Chat Support: Grounded Analysis

## 1. Summary & the real gap

The `messaging` module (`apps/backend/src/modules/messaging/`) is **already partner-scoped at the data layer**: the `Conversation` model has a `partner_id` field (`apps/backend/src/modules/messaging/models/conversation.ts:6`), inbound webhook resolution sets it (`apps/backend/src/workflows/whatsapp/whatsapp-message-handler.ts:188-216`, `persistInboundMessage` → conversation created with `partner_id`), and the admin list route filters by it (`apps/backend/src/api/admin/messaging/route.ts:16`). The gap is **not** a missing partner scope — it is:

1. **WhatsApp-transport-only**: the `Conversation.phone_number` field is NON-nullable (`apps/backend/src/modules/messaging/models/conversation.ts:7`), and the send path hard-depends on WhatsApp resolution + the 24-hour messaging window (`apps/backend/src/api/admin/messaging/[conversationId]/route.ts:156-172`). There is no "web" direction for messages sent from a browser.
2. **No partner API routes**: there is no `apps/backend/src/api/partners/messaging/` directory (verified by listing all partner routes — no messaging/ among them).
3. **No partner-ui surface**: `apps/partner-ui/src/routes/` has 43 route directories; none named `messaging` or `chat`.

**What the partner needs** is a way to view their conversation threads with JYT admin support and send/receive messages — either in-dashboard (web transport) or via WhatsApp with a read-only dashboard view + deep-link.

## 2. Current architecture

### 2.1 Data model

**`Conversation`** (`apps/backend/src/modules/messaging/models/conversation.ts`):
- `partner_id: text` — **already exists**, partner-scoped at table level
- `phone_number: text` — NON-nullable; WhatsApp-centric. Creating a conversation without a phone is impossible today.
- `title: text?`, `last_message_at: dateTime?`, `unread_count: number`, `status: enum(active|archived)`, `default_sender_platform_id: text?` (pins which WhatsApp number to reply from), `metadata: json?`
- `hasMany messages` with cascade delete

**`Message`** (`apps/backend/src/modules/messaging/models/message.ts`):
- `direction: enum(inbound|outbound)` — no concept of a "web" direction
- `message_type: enum(text|interactive|template|media|context_card)`, `status: enum(pending|sent|delivered|read|failed|queued)`
- `wa_message_id: text?` — nullable, so web messages can omit it, but `status` semantics are WhatsApp-oriented
- `context_type`/`context_id`/`context_snapshot`, `media_url`, `reply_to_id`/`reply_to_snapshot`
- `belongsTo Conversation`

**Service** (`apps/backend/src/modules/messaging/service.ts`): thin MedusaService wrapper exposing `MessagingConversation` and `MessagingMessage` auto-CRUD via `listAndCount*`, `retrieve*`, `create*`, `update*`, `delete*`.

**Module** (`apps/backend/src/modules/messaging/index.ts`): standard Medusa `Module(...)` registration, exported as `MESSAGING_MODULE = "messaging"`.

### 2.2 Admin inbox (API)

**Root — `GET /admin/messaging`** (`apps/backend/src/api/admin/messaging/route.ts`):
- Query params: `partner_id`, `status`, `limit`, `offset` (`apps/backend/src/api/admin/messaging/validators.ts:3-8`)
- Lists conversations ordered by `last_message_at DESC`, enriches `partner_name` via `query.graph({ entity: "partners" })` (`apps/backend/src/api/admin/messaging/route.ts:36-41`), attaches last message preview
- Only admin-facing — no equivalent partner route exists

**Create — `POST /admin/messaging`** (`apps/backend/src/api/admin/messaging/route.ts:86-138`):
- Body: `{ partner_id, phone_number, title? }` — phone_number is **required**
- Dedup by `partner_id + phone_number` combo; reactivates archived on match

**Detail — `GET /admin/messaging/:conversationId`** (`apps/backend/src/api/admin/messaging/[conversationId]/route.ts:14-87`):
- Returns conversation + paginated messages (sorted oldest-first)
- Resets `unread_count` to 0, fires WhatsApp read receipts for up to 10 unread inbound messages

**Send — `POST /admin/messaging/:conversationId`** (`apps/backend/src/api/admin/messaging/[conversationId]/route.ts:94-247`):
- Resolves WhatsApp sender via `resolveConversationSender` (`apps/backend/src/api/admin/messaging/[conversationId]/route.ts:253-284`)
- **Enforces WhatsApp 24-hour window**: checks if any inbound message exists within last 24h; if not, throws `MedusaError.Types.NOT_ALLOWED` (`apps/backend/src/api/admin/messaging/[conversationId]/route.ts:164-172`)
- Builds context snapshots via `buildContextSnapshot` (`apps/backend/src/api/admin/messaging/context-builder.ts`) for types: `production_run`, `design`, `inventory_item`
- Updates conversation metadata (`consent_given`, `onboarded`); stamps `default_sender_platform_id` if first send

**Sub-routes** on `:conversationId`: `archive/` (`apps/backend/src/api/admin/messaging/[conversationId]/archive/route.ts`), `delete/` (`apps/backend/src/api/admin/messaging/[conversationId]/delete/route.ts`), `title/` (`apps/backend/src/api/admin/messaging/[conversationId]/title/route.ts`), `sender/` (`apps/backend/src/api/admin/messaging/[conversationId]/sender/route.ts`).
**`GET /admin/messaging/whatsapp/senders`** (`apps/backend/src/api/admin/messaging/whatsapp/senders/route.ts`): lists available WhatsApp Business numbers.

### 2.3 WhatsApp send path & 24-hour window

The send path is WhatsApp-only by design:

1. Resolve sender via `resolveConversationSender` — tries `conversation.default_sender_platform_id`, then country-code match on `conversation.phone_number`, then default platform (`apps/backend/src/api/admin/messaging/[conversationId]/route.ts:253-284`)
2. Check 24-hour window: scan all messages for any `direction === "inbound"` within the last 24h (`apps/backend/src/api/admin/messaging/[conversationId]/route.ts:156-172`). **This is the blocker for web-transport outbound**: the check would always fail for a web-inbound message because web messages don't exist in WhatsApp's window model.
3. Send via WhatsApp API (text or media), persist message with status `sent`/`failed`

### 2.4 Inbound webhook

**`POST /webhooks/social/whatsapp`** (`apps/backend/src/api/webhooks/social/whatsapp/route.ts`):
- HMAC-SHA256 verification via `verifySignatureAgainstAllPlatforms` (`apps/backend/src/api/webhooks/social/whatsapp/route.ts:132-175`)
- Multi-number routing: resolves inbound `phone_number_id` to a specific SocialPlatform (`apps/backend/src/api/webhooks/social/whatsapp/route.ts:199-218`)
- Status updates: progress-forward `pending→sent→delivered→read` (`apps/backend/src/api/webhooks/social/whatsapp/route.ts:221-256`)
- Inbound messages: dedup by `wa_message_id`, parse via `parseWebhookMessage`, call `resolveAdminByPhone` or `resolvePartnerByPhone` + `handleIncomingMessage`/`handleAdminMessage` (`apps/backend/src/api/webhooks/social/whatsapp/route.ts:325-363`)
- Emits `whatsapp.message_received` event with `partner_id` in payload (`apps/backend/src/api/webhooks/social/whatsapp/route.ts:347`)

**`handleIncomingMessage` → `persistInboundMessage`** (`apps/backend/src/workflows/whatsapp/whatsapp-message-handler.ts:1574-1653`):
- Finds existing conversation by `partner_id` + phone match; or creates new with `partner_id`, `phone_number`, `senderPlatformId`
- Sets `partner_id` explicitly when the conversation is created (`apps/backend/src/workflows/whatsapp/whatsapp-message-handler.ts:216`)

### 2.5 Admin messaging UI

Admin messaging components live under `apps/backend/src/admin/routes/messaging/` with at least one unit-test precedent at `apps/backend/src/admin/routes/messaging/components/__tests__/extract-amount.unit.spec.ts`. The admin UI is already built — partner chat would mirror this but from the partner's perspective.

## 3. The key product decision — transport

Three options, ordered by implementation cost.

### Option A: Web-transport in-dashboard chat (highest fidelity)

The partner types directly in the dashboard; messages go into the same `messaging_conversation` / `messaging_message` tables but via HTTP, not WhatsApp.

**Changes required (non-trivial):**
1. **Schema migration**: make `Conversation.phone_number` nullable; add a `transport` or `channel` enum field (`"whatsapp" | "web"`) to both Conversation and Message to distinguish transport
2. **Loosen 24-hour window**: the NOT_ALLOWED check at `apps/backend/src/api/admin/messaging/[conversationId]/route.ts:156-172` must be waived for web-originated messages (or the whole send path re-architected)
3. **Message.direction semantics need a third value**: currently `inbound`/`outbound` map to WhatsApp phone↔platform. For web, the partner writing is... both inbound (from JYT's perspective) and outbound (from partner's). May need `direction: enum(inbound|outbound|web_inbound|web_outbound)` or a separate `channel` field
4. **Admin reply routing**: if the partner has a known WhatsApp phone, admin replies can go via WhatsApp (existing path). If not, admin replies must also stay web. This bifurcates the admin send path
5. **Real-time delivery**: web messages need live delivery — either polling (simple, cheap) or SSE/WebSocket (complex, expensive for a small team). No existing SSE infrastructure in this codebase
6. **Media**: Partner-uploaded media in dashboard needs its own upload endpoint (mimicking admin media upload patterns)

**Cost**: high (2-3 PRs + schema migration + UI). **Value**: highest — partner never leaves dashboard.

### Option B: WhatsApp-only — read-only dashboard + deep-link (cheapest)

The dashboard shows a read-only thread of the WhatsApp conversation (already in `messaging_message`). Partner cannot reply in-dashboard — they tap a "Message us on WhatsApp" button that opens `wa.me/<number>`.

**Changes required (minimal):**
1. **Partner API routes** (GET only): list and detail (scoped to authed partner), no POST for send
2. **partner-ui**: a chat panel that renders messages read-only, plus a deep-link button
3. **Polling for new messages**: GET partner list every N seconds to pick up new inbound/admin replies

**No schema changes needed. No transport decision. Reuses the entire existing WhatsApp send path as-is.**

**Cost**: low (1-2 PRs, pure API + UI). **Value**: moderate — partner can see thread but must context-switch to WhatsApp to reply.

### Option C: Hybrid — partner-ui writes web inbound messages into same conversation (recommended)

The partner reads in-dashboard (like B) AND can send messages from the dashboard. Their web-sent messages are stored as `direction: "outbound"`, `wa_message_id: null` with a new `channel: "web"` field. The admin sees both WhatsApp and web messages in the same admin inbox. Admin replies go out via WhatsApp if the partner has a verified phone, else stay web.

**Changes required:**
1. **Schema**: add `channel` to Message (`"whatsapp" | "web"` default "whatsapp"), make `phone_number` nullable on Conversation
2. **Loosen 24-hour window** for web-channel messages only
3. **Partner POST endpoint** to send
4. **Admin send bifurcation**: if partner has phone_number, route via WhatsApp; else route as web outbound (a new method path)
5. **Polling or SSE** for both sides

**Cost**: medium-high (same as A but less media complexity). **Value**: high — partner stays in dashboard, admin keeps WhatsApp for proactive outreach.

### Recommendation

**Ship B for MVP, then extend to C in a follow-up.** B is ~1 week of work, unblocks the partner visibility need, and carries zero schema risk. The API routes for B (GET list + detail) are a superset of what C needs. The partner-ui chat panel component can be built once and extended with an input bar later.

## 4. Reuse-vs-new module

**REUSE the existing `messaging` module**. Rationale:

- The `Conversation` model already has `partner_id` (`apps/backend/src/modules/messaging/models/conversation.ts:6`). A new module would duplicate this.
- The `MessagingService` (`apps/backend/src/modules/messaging/service.ts`) exposes standard CRUD — no custom logic to port.
- The admin inbox already lists/filters by `partner_id` (`apps/backend/src/api/admin/messaging/route.ts:16`).
- Admin GET detail already returns partner info (`apps/backend/src/api/admin/messaging/[conversationId]/route.ts:29-37`).

**What must be loosened if Option A or C is chosen:**
- `Conversation.phone_number` must become nullable (`apps/backend/src/modules/messaging/models/conversation.ts:7`)
- A `transport`/`channel` field is needed on Message to distinguish WhatsApp-vs-web origin without overloading `direction` or `wa_message_id`
- The send 24-hour window check at `apps/backend/src/api/admin/messaging/[conversationId]/route.ts:156-172` must be waived per-transport

If Option B (read-only) is chosen, **no module changes are needed at all**.

## 5. Proposed partner API routes

Following the partner API pattern established by every existing partner route (e.g. `apps/backend/src/api/partners/designs/route.ts`).

### `GET /partners/messaging` — list own conversations

```typescript
// apps/backend/src/api/partners/messaging/route.ts
import { getPartnerFromAuthContext } from "../helpers"
// filters.partner_id = partner.id (from auth, NOT a client param)
// Enrich partner_name not needed (it's the partner themselves)
// Returns enriched with last message preview (mirror admin version)
```

- Auth: `authenticate("partner", ["session", "bearer"])` — register in `apps/backend/src/api/middlewares.ts`
- The `partner_id` filter is **always** the authenticated partner's ID (from `req.auth_context.actor_id`), never from query params — prevents a partner listing another's conversations
- Response shape mirrors admin response minus `partner_name` (redundant)

### `GET /partners/messaging/:id` — read conversation + messages

```typescript
// apps/backend/src/api/partners/messaging/[id]/route.ts
// call assertPartnerOwnsConversation() before returning
```

- The `assertPartnerOwnsConversation` guard: `retrieveMessagingConversation(id)`, throw NOT_FOUND if `conversation.partner_id !== authedPartnerId`, never reveal existence of another partner's conversation
- Returns paginated messages, sorted oldest-first (mirrors admin)
- Does NOT reset `unread_count` (that's admin-only semantics) — or resets partner unread count differently
- Does NOT fire WhatsApp read receipts (partner view doesn't mean admin read)

### `POST /partners/messaging/` or `POST /partners/messaging/:id` — send/start

**Decision-gated by transport choice (B,C):**
- Option B: not needed — no partner send
- Option C: create message with `direction: "outbound"`, `channel: "web"`, `wa_message_id: null`, skip WhatsApp 24h check

**New conversation creation**: partner may not know their own `phone_number` in the system; a `POST /partners/messaging` could create a conversation without `phone_number` (if nullable) — but only after consent/onboarding flow. Simpler MVP: a conversation already exists (created by inbound WhatsApp or admin), partner just reads it.

### Registration in `apps/backend/src/api/middlewares.ts`

Each route needs a middleware entry following the established pattern (e.g. `apps/backend/src/api/middlewares.ts:691-696` for `/partners/details`):
```typescript
{
  matcher: "/partners/messaging",
  method: "GET",
  middlewares: [
    createCorsPartnerMiddleware(),
    authenticate("partner", ["session", "bearer"]),
  ],
},
// Same pattern for :id, etc.
```

### Validators

New file `apps/backend/src/api/partners/messaging/validators.ts`, mirroring `apps/backend/src/api/admin/messaging/validators.ts` but without admin-specific fields like `partner_id` (injected from auth).

## 6. partner-ui surfacing

A new route directory at `apps/partner-ui/src/routes/messaging/` (or nested under an existing layout).

- **Chat panel**: reuses visual patterns from the admin `apps/backend/src/admin/routes/messaging/` components (bubble layout, timestamp, direction styling)
- **Skeleton loaders**: during initial fetch and polling gaps
- **List page**: shows all conversations (title, last message preview, unread badge) — scoped to authed partner
- **Detail page**: full thread view with messages
- **Option B only**: a "Message us on WhatsApp" button → `https://wa.me/<business_number>?text=...`
- **Polling**: `setInterval` polling on `GET /partners/messaging` (or the detail endpoint) every 10-15s for new messages. No existing SSE/WS infrastructure is in the partner-ui.

The partner-ui app runs at `apps/partner-ui/` (dev `:5173`, confirmed by `apps/partner-ui/vite.config.mts`). UI component library conventions can be read from existing routes like `apps/partner-ui/src/routes/designs/`.

## 7. PR-by-PR plan

### PR1: Partner GET list (scoped) + `assertPartnerOwnsConversation` helper

**Files**: `apps/backend/src/api/partners/messaging/route.ts` (GET), `apps/backend/src/api/partners/messaging/helpers.ts` (or put in existing `apps/backend/src/api/partners/helpers.ts`), `apps/backend/src/api/middlewares.ts` (registration).

**Test strategy**:
- Unit: `assertPartnerOwnsConversation` — mock MessagingService, verify throw/no-throw for match/mismatch
- Integration: `GET /partners/messaging` with valid auth token → 200 with only authed partner's conversations; with another partner's token → different set; unauthenticated → 401

### PR2: Partner GET detail

**Files**: `apps/backend/src/api/partners/messaging/[id]/route.ts` (GET), validators.

**Test strategy**:
- Unit: verify guard fires for partner_id mismatch
- Integration: GET own conversation → 200 + messages; GET another partner's conversation → 404 (NOT 403 — do not leak existence); GET nonexistent → 404

### PR3: Partner send (Option C only — gated by transport decision)

**Files**: add POST to `apps/backend/src/api/partners/messaging/[id]/route.ts`, validators.

**Test strategy**:
- Unit: verify message created with correct direction + no wa_message_id + channel: "web"
- Integration: POST to existing conversation → 201 + message in response; GET conversation → new message appears in list; POST without auth → 401

### PR4: partner-ui chat panel

**Files**: `apps/partner-ui/src/routes/messaging/` (list + detail pages), a chat panel component.

**Test strategy**: Playwright or Vitest component tests — render skeleton, verify polling fires GET, verify deep-link button renders (Option B), verify send form works (Option C).

### PR0 (only if Option A or C): Migration — nullable phone_number + channel field

**Files**: migration in `apps/backend/src/modules/messaging/migrations/` (the migrations directory exists at `apps/backend/src/modules/messaging/migrations/`), model updates in `conversation.ts` and `message.ts`.

**Test strategy**: migration dry-run in test DB; verify existing WhatsApp conversations still work after migration (phone_number backfilled).

## 8. Open questions / product decisions

- **Transport: A, B, or C?** This is the #1 decision. The recommendation is B→C phased, but needs product sign-off.
- **Who is the partner chatting WITH?** JYT admin support, or their own downstream customers? The existing data model (admin inbox, messaging for partner support) suggests **JYT admin support**. If the partner needs to chat with their *own* customers, this is an entirely different problem (new model, new routing). For #454, assume JYT admin support.
- **Real-time mechanism**: polling (simple, 10-15s interval) or SSE (lower latency, more infra)? The partner-ui has no existing SSE infrastructure. Polling is the pragmatic MVP choice.
- **24-hour window for web messages**: should the WhatsApp 24h window be waived entirely for web-channel messages? If Option C: a partner's web message should always be deliverable and the admin should be able to reply (either via WhatsApp if phone known, or web if not).
- **Web-message media/attachments**: partner sending images from dashboard needs a media upload endpoint. Reuse admin patterns (`apps/backend/src/api/admin/messaging/[conversationId]/route.ts:176-183` for media send), but need a partner media upload route. Option B avoids this entirely.
- **Unread count semantics**: inbound WhatsApp messages increment `unread_count`. Should web-originated admin replies also increment a partner-side unread count? Currently `unread_count` is reset only on admin detail GET (`apps/backend/src/api/admin/messaging/[conversationId]/route.ts:49-53`). Needs a second counter for partner-side unread.

---

> **Note on citations:** `apps/backend/src/api/partners/messaging/{route,helpers,validators}.ts` referenced in §5/§7 are **proposed new files** (the PR plan's deliverables), not existing code. Every other `path:symbol` citation refers to existing code verified at authoring time.

# Storefront AI Chat — Code Map (per package)

> Findings as of 2026-06-29. Captures where the storefront AI chat lives, how it
> is wired, and how it works end-to-end — organised per package. Reference doc
> for the "move chat to its own route + smart re-entry" work.
>
> For the broader storefront architecture (routing, modules, data layer, state),
> see the companion **`STOREFRONT_CODE_MAP.md`**.

---

## Package: `apps/storefront` (Next.js App Router, AI SDK v6 `useChat`)

### Code organisation

```
src/
├── app/
│   ├── layout.tsx                              # Root: <SmoothScroll> (Lenis) + analytics
│   ├── [countryCode]/(main)/
│   │   ├── layout.tsx                          # Nav (NavScrollHeader), banners, Footer
│   │   ├── page.tsx                            # Home → <Hero> → ScrollStage (pinned)
│   │   └── store/page.tsx                      # /store → StoreTemplate
│   ├── [countryCode]/(checkout)/layout.tsx     # Simpler header, NO nav-scroll, NO chat
│   └── api/ai-chat/route.ts                    # Proxy → backend POST /store/ai/chat
├── modules/
│   ├── home/components/
│   │   ├── hero/
│   │   │   ├── index.tsx                       # async; fetches gallery painting
│   │   │   └── hero-visual.tsx                 # search-bar trigger + <AiSearchChat> (L180)
│   │   └── ai-search-chat/
│   │       ├── index.tsx                       # MAIN chat modal (FocusModal), 658 lines
│   │       ├── trigger.tsx                     # search-bar pill trigger
│   │       └── onboarding.tsx                  # one-time taste form
│   └── store/components/ai-search/index.tsx    # /store inline single-shot search (not modal)
└── lib/util/
    ├── ai-chat-preferences.ts                  # localStorage: taste prefs (colors/materials/fit/size/price)
    ├── ai-chat-thread.ts                       # localStorage: thread history (max 40 msgs)
    └── visitor-id.ts                           # anon visitor_id across cart/chat/checkout
```

### How it works (current)

- **Two distinct experiences:**
  - **Home hero** — `AiSearchChat` (`modules/home/components/ai-search-chat/index.tsx`)
    is a Medusa-UI `FocusModal` (Radix Dialog) at `z-[100]`. Opened imperatively
    from the hero search bar via a `ref`: `chatRef.current?.open(initialQuery)`.
    Multi-turn, streaming, persisted thread + onboarding.
  - **/store** — `StoreAiSearch` (`modules/store/components/ai-search/index.tsx`)
    is an **inline single-shot** search bar (no modal, no history) rendered at
    `modules/store/templates/index.tsx:49`.

- **Mount point (the problem):** the chat modal is rendered **inside the hero**
  at `hero-visual.tsx:180` (`<AiSearchChat ref={chatRef} />`), so it lives inside
  the home page's pinned `ScrollStage`.

- **Chat framework:** `@ai-sdk/react` `useChat` + `DefaultChatTransport`, posting
  to the local route `/api/ai-chat`.

- **Open/close state** (`ai-search-chat/index.tsx`):
  - `open`, `showOnboarding`, `onboardingDirty`, `confirmingClose` (L100–109).
  - Imperative `open(initialQuery)` / `close()` via `useImperativeHandle` (L136–152);
    loads prefs, sets/sees `visitor_id`, shows onboarding if first time.
  - `requestClose()` (L159–165) guards an unsaved onboarding with a `Prompt`
    confirmation (L415–449); `onEscapeKeyDown` / `onPointerDownOutside` intercept
    dismiss while dirty (L246–262).
  - **When closed, only the hero search bar is visible** — there is no persistent
    launcher / re-entry affordance anywhere else.

- **State persistence (localStorage):** taste prefs, thread history (cap 40),
  and `visitor_id`. So a conversation *can* be resumed — but nothing surfaces it
  once the modal is closed.

### Scroll wiring (root cause of the header issue)

- Root layout wraps everything in **Lenis** smooth scroll
  (`<ReactLenis root options={{ lerp: 0.1, duration: 1.5 }}>`).
- `NavScrollHeader` is `sticky top-0 z-50`; a `scroll` listener reads
  `#hero-section.offsetHeight` and flips dark/light when `scrollY < 0.85 * heroH`
  (`nav-scroll-header.tsx:11–21`).
- The chat modal is mounted **inside** that pinned/`overflow-hidden` hero
  (`hero-visual.tsx:59`, `min-h-screen … overflow-hidden`). Modal body scrolls
  (`overflow-y-auto`, auto-scroll-to-latest L181–187) while the page's Lenis +
  scroll-driven header logic are still active underneath → the scrolling/header
  glitches reported on the home page.
- Z-index stack: modal `z-[100]` > `NavScrollHeader` `z-50` > content.

### Files to touch for "move to own route + smart re-entry"

- Remove modal from hero: `hero-visual.tsx` (drop `<AiSearchChat>` mount L180 +
  the `ref`-based `open()` calls L124–146; turn the search bar into a link/navigation).
- New route: `app/[countryCode]/(main)/chat/page.tsx` (or its own group) hosting
  `AiSearchChat` as a full page rather than a `FocusModal`.
- Persistent re-entry launcher mounted once in `(main)/layout.tsx` so it shows on
  every main route (not checkout) — pattern TBD (see decision below).

---

## Package: `apps/backend` (Medusa 2.x — the chat API)

### Code organisation

```
src/api/store/ai/
├── chat/
│   ├── route.ts                    # POST /store/ai/chat — streaming chat endpoint
│   ├── validators.ts               # zod request schema
│   ├── chat-usage-lib.ts           # [ai-usage] telemetry helper (PR #761)
│   ├── system-fold-lib.ts          # folds system prompt into 1st user msg (#752 fix)
│   └── __tests__/                  # unit specs for both libs
├── search/route.ts                 # POST /store/ai/search — single-shot (used by /store)
├── tryon/ · imagegen/ · accessfee/ # other store-AI endpoints (not chat)
```

### How it works

- Storefront `app/api/ai-chat/route.ts` is a **thin proxy** → backend
  `POST /store/ai/chat`.
- `system-fold-lib.ts` folds the system prompt into the first user message for
  OpenAI-compatible providers (the #752 hotfix — DashScope rejected role
  `developer`).
- `chat-usage-lib.ts` emits structured `[ai-usage] … source=platform` telemetry
  (PR #761).
- Model resolution flows through the AI-platform-by-role unification: chat uses
  the `ai_search_chat` role via `resolveRoleTextModel` (platform → FREE fallback).
  See the AI-platform unification work (`#752/#753/#754/#757–#761`).

### Not affected by the route move

The backend chat contract is unchanged by relocating the UI. Moving the chat to
its own storefront route is a **frontend-only** change (mount point + re-entry).

---

## Decisions — "move chat to own route + smart re-entry" (2026-06-29)

- **Route form: full-page `/chat`.** New route
  `app/[countryCode]/(main)/chat/page.tsx` renders the assistant as a real page
  (nav + footer, shareable/bookmarkable URL). This fully removes the
  modal-over-pinned-hero scroll conflict. `AiSearchChat` is refactored from a
  `FocusModal` into a page-level layout (reuse the streaming/onboarding/thread
  logic; drop the Radix Dialog shell + dismiss guards).
- **Re-entry: floating launcher (FAB).** A persistent bubble bottom-right on all
  `(main)` routes (NOT checkout), mounted once in `(main)/layout.tsx`. Shows an
  active-thread dot when a saved thread exists in localStorage
  (`ai-chat-thread.ts`). Tap → navigate to `/chat`.
- **Hero search bar** stops opening a modal; it navigates to `/chat?q=<query>`
  (the chat page reads `q` and seeds the first message). Remove the
  `<AiSearchChat>` mount + `ref.open()` calls from `hero-visual.tsx`.

### Build outline

1. New `(main)/chat/page.tsx` + refactor `AiSearchChat` to a page variant
   (extract the inner conversation UI so both could share, or replace the modal
   wholesale). Read `?q=` to seed input.
2. New `ChatLauncher` client component (FAB) → mount in `(main)/layout.tsx`;
   read thread from localStorage for the dot; hide on `/chat` itself.
3. `hero-visual.tsx`: search bar → `router.push('/chat?q=…')`; delete modal mount.
4. Keep `/store` `StoreAiSearch` inline search as-is (separate single-shot UX).
```

---
title: "AI v2: Complex Prompts (Planner + Tools + Artifacts) — Feature Plan"
sidebar_label: "Complex Prompts"
sidebar_position: 2
---

# AI v2: Complex Prompts (Planner + Tools + Artifacts) — Feature Plan

## Goal
Enable the AI v2 chat to reliably execute **multi-step business prompts** that require:
- Reading real data from Medusa Admin APIs (products, partners, etc.)
- Performing multi-step reasoning (select, aggregate, summarize)
- Producing a structured output (report/blog/campaign/design spec)
- Optionally persisting the output as a first-class entity (drafts/artifacts)

Examples:
- Select the first 3 products → create a social campaign draft
- Summarize all products → produce a blog post and publish it
- Ideate a new design → generate a design spec and create a Design entity

This document is intentionally technical, describing:
- **What exists today** in this codebase
- **What we will implement later**
- Concrete prompt flows and proposed entities

---

## Current State (Implemented so far)

### 1) AI v2 Chat + Streaming
- Admin UI: `src/admin/components/ai/v2/ai-v2-chat.tsx`
- Hooks: `src/admin/hooks/api/ai-v2.ts`
- API routes:
  - Non-streaming: `src/api/admin/ai/v2/chat/route.ts`
  - Streaming (SSE): `src/api/admin/ai/v2/chat/stream/route.ts`
  - Resume (suspended workflow): `src/api/admin/ai/v2/runs/[runId]/resume/route.ts`

Key runtime behavior:
- Supports streaming tokens + step updates.
- Supports **suspend/resume** patterns (e.g., “select option”, “confirm write”).
- UI renders a steps timeline (`StepTimeline`) and can display structured tool output previews.

### 2) Tool call observation previews improved
- Workflow: `src/mastra/workflows/aiV2/index.ts`
  - Increased max preview chars (`MAX_TOOL_RESULT_CHARS`)
  - Added list summary previews (`buildListPreview`)
  - Added default `limit=50` on collection list calls (`withDefaultListLimit`)
- UI: `src/admin/components/ai/v2/components/step-timeline.tsx`
  - Improves display of JSON previews that are stored as stringified JSON.

### 3) Chat Threading (memory-based)
- AI v2 UI now supports thread selection/creation mirroring v1 UI patterns.
- Thread APIs are shared with general chat:
  - List/create threads: `src/api/admin/ai/chat/threads/route.ts`
  - Read/append messages: `src/api/admin/ai/chat/threads/[threadId]/route.ts`

### 4) Feedback linking to AI v2 runs
- Feedback endpoint: `src/api/admin/ai/v2/runs/[runId]/feedback/route.ts`
- Link definition: `src/links/ai-v2-feedback-link.ts`

### 5) Run persistence entity
- Module service: `src/modules/ai_v2/service.ts`
- Model: `src/modules/ai_v2/models/ai-v2-run.ts`
  - Fields include `run_id`, `thread_id`, `resource_id`, `status`, `message`, `reply`, `steps`, `metadata`.

> Note: Some routes still rely on `query.index({ entity: "ai_v2_run" })`. We plan to move fully to `AiV2Service` methods because custom entities may not be indexed.

---

## Core Approach for Complex Prompts (Future Implementation)

### Problem statement
Complex prompts often fail when:
- The model tries to answer without fetching real data.
- Data is large (pagination, token limits).
- The prompt contains multiple goals (select items → create content → publish/write).

### Proposed solution
Adopt a stable pattern:

1) **Planner pass** (LLM, no tools)
- Convert the user prompt into a small structured plan.
- Decide which data must be fetched.
- Decide whether the workflow must suspend for user selection/confirmation.

2) **Executor pass** (tools)
- Perform Medusa admin API calls (server-side).
- Normalize + filter + aggregate results.
- Create a compact “facts payload” for synthesis.

3) **Synthesis pass** (LLM)
- Generate a deterministic output using only the facts payload.
- Output a typed schema (blog draft, campaign draft, design spec).

4) **Persist (optional)**
- Create a durable entity (“artifact”) in DB so it can be edited/published later.

This aligns with existing AI v2 infrastructure:
- Step timeline already visualizes tool steps.
- Suspend/resume already supports user-driven branching.
- Threading already supports long-running context.

---

## Proposed “AI Artifacts” Entity Model (Future)

We will likely need first-class objects for generated outputs.

### Option A: Generic Artifact Entity
- **Entity**: `AiArtifact`
- **Fields**:
  - `id` (core)
  - `type`: `"campaign" | "blog" | "design" | ...`
  - `status`: `"draft" | "published" | "failed" | "archived"`
  - `title`: string
  - `content`: JSON (schema varies per type)
  - `source`: JSON (inputs, prompt, selected entity IDs)
  - `metadata`: JSON (threadId, runId, etc.)

Benefits:
- One system supports many AI outputs.

### Option B: Domain-specific Draft Entities
- `SocialCampaignDraft`
- `BlogDraft`
- `DesignDraft`

Benefits:
- More type safety and domain UX.

Recommendation:
- Start with **Option A** for velocity, then split into domain models if needed.

---

## Proposed Workflows (Future)

### 1) `aiV2PlannerWorkflow`
Inputs:
- `threadId`, `resourceId`, `message`
Output:
- `plan`: JSON

### 2) `aiV2ExecutePlanWorkflow`
Inputs:
- `plan`
- `toolContext` (admin auth, resource constraints)
Output:
- `factsPayload`

### 3) `aiV2SynthesizeArtifactWorkflow`
Inputs:
- `factsPayload`
- `targetSchema` (campaign/blog/design)
Output:
- `artifactDraft`

### 4) `persistArtifactWorkflow` (optional)
Inputs:
- `artifactDraft`
Output:
- persisted record id

---

## Suspended steps (Existing pattern, used more heavily)

Complex prompts often require explicit user decisions:
- Selecting products from a list
- Confirming writes/publishing
- Choosing tone/length/target audience

We will treat these as **suspended states**:
- Suspend with payload: `{"reason": "Select products", "options": [...]}`
- Resume with selection

This is already supported by AI v2:
- `SuspendedWorkflowSelector` UI
- `WriteConfirmCard` UI
- Resume endpoint: `/admin/ai/v2/runs/:runId/resume`

---

## Examples (End-to-end)

### Example 1: “Create a social campaign for my three first products, let me choose them from the list”

#### Desired UX
- AI fetches products list (first page, optionally top sellers).
- UI presents a selector for product IDs.
- User selects 3 products.
- AI generates campaign copy + creative guidance.
- AI saves as `AiArtifact(type="campaign")`.

#### Proposed workflow steps
1) **Tool**: `GET /admin/products?limit=50&fields=id,title,handle,thumbnail,variants,...`
2) **Suspend**: `select_products`
   - options: first N products (N=10/20) with titles + thumbnails
3) **Synthesis**: generate `campaignDraft`
4) **Persist**: create artifact draft

#### Proposed campaign schema (artifact.content)
```json
{
  "platform": "instagram",
  "objective": "product_launch",
  "products": [{"id":"prod_...","title":"..."}],
  "copy": {
    "caption": "...",
    "hashtags": ["..."],
    "cta": "Shop now"
  },
  "creative": {
    "visual_style": "...",
    "shots": ["..."],
    "do": ["..."],
    "dont": ["..."]
  },
  "variants": [
    {"tone":"minimal","caption":"..."},
    {"tone":"playful","caption":"..."}
  ]
}
```

#### Proposed API additions (future)
- `POST /admin/ai/artifacts` create draft
- `GET /admin/ai/artifacts?type=campaign&threadId=...`

---

### Example 2: “Write me a blog instantly from all the products and publish them”

#### Notes on constraints
- “All products” can be large. We must implement pagination and caps.
- Publishing is a write action → requires explicit confirmation.

#### Proposed workflow steps
1) **Tool**: paginate products
   - `GET /admin/products?limit=50&offset=0`
   - repeat until end or max cap (e.g., 500)
2) **Aggregate**:
   - group by collection/type/tags
   - derive highlights (newest, best-selling if metrics exist)
3) **Synthesis**: blog draft in markdown + metadata
4) **Suspend**: confirm publish
5) **Tool**: create/publish blog post

#### Proposed blog schema (artifact.content)
```json
{
  "title": "...",
  "slug": "...",
  "summary": "...",
  "markdown": "# ...\n...",
  "sections": [
    {"heading":"New arrivals","product_ids":["prod_..."]}
  ],
  "seo": {
    "meta_title": "...",
    "meta_description": "...",
    "keywords": ["..."]
  }
}
```

#### Proposed writes
- If you already have blog entities in DB:
  - `POST /admin/blogs` (draft)
  - `POST /admin/blogs/:id/publish`
- If not, we implement a `BlogDraft` module.

---

### Example 3: “Let’s ideate on a new design idea and then make a design out of it”

#### Desired UX
- First pass: ideation (questions + concept options)
- User selects one concept
- AI produces a structured design spec
- Optional: create `Design` entity and attach generated assets

#### Proposed workflow steps
1) **Planner**: ask clarifying questions (audience, product line, constraints)
2) **Suspend**: pick concept direction
3) **Synthesis**: generate `designSpec`
4) **Persist**: create design draft/entity

#### Proposed design schema (artifact.content)
```json
{
  "concept": "...",
  "target_product": "t-shirt",
  "style": {
    "mood": ["..."]
  },
  "palette": [{"name":"...","value":"#..."}],
  "typography": {"primary":"...","secondary":"..."},
  "layout": {
    "front": "...",
    "back": "..."
  },
  "production_notes": ["..."]
}
```

---

## UI implications (Future)

### 1) Artifact preview panel
- Display the generated artifact in a dedicated side panel.
- Allow “Save draft”, “Publish”, “Copy markdown”, “Create campaign”.

### 2) Selection UI
- For selection suspend steps, allow:
  - search + filter
  - multi-select
  - preview thumbnails

### 3) Write confirmation
- For publish/write actions, always show:
  - exactly what will be written
  - a diff-like preview
  - confirm/cancel

---

## Security & permissions
- All tool calls should execute server-side with admin auth.
- Write tools must be behind explicit confirmation.
- Enforce limits + denylist sensitive endpoints.

---

## Implementation checklist (Future)

- [ ] Introduce planner schema + validation (Zod)
- [ ] Add artifact persistence (generic or domain-specific)
- [ ] Add workflows: planner → execute → synthesize → persist
- [ ] Add suspended step types: select_products, confirm_publish
- [ ] Add UI: artifact panel + multi-select step renderer
- [ ] Add tests: end-to-end “select products → campaign draft”

---

## Status
- Implemented: AI v2 chat, streaming, steps timeline, tool previews, thread selection, feedback linking.
- Planned: complex prompt planning/execution, artifact persistence, publish/write confirmations for domain entities.

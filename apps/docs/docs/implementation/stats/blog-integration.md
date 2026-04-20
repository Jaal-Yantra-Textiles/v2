---
title: "Stats Panels in Blogs (Tiptap)"
sidebar_label: "Blog Integration"
sidebar_position: 10
---

# Stats Panels in Blogs

Embed any panel from the [Stats module](./module) into a blog post. Data resolves **server-side** in the web blog endpoint, so the storefront renders from pre-baked attrs — no public resolve endpoint, no client round-trip.

## End-to-end

```
┌──────────────────────────────────┐
│ Admin blog editor (Tiptap)       │
│   Toolbar → Panel button          │
│     → FocusModal picker          │
│       (dashboards → panels)      │
│   Insert statsPanel node         │
│   attrs: { panelId, title, type }│
└────────────────┬─────────────────┘
                 │ stored in block.content.text
                 ▼
┌──────────────────────────────────┐
│ DB: block.content.text           │
│   Tiptap JSON with statsPanel    │
│   nodes (attrs: panelId, title,  │
│   panelType only — no data)      │
└────────────────┬─────────────────┘
                 │
                 ▼
┌──────────────────────────────────┐
│ /web/website/:domain/blogs/:id   │
│   findWebsitePagePerDomain       │
│   → injectStatsPanelData         │
│       walks tiptap doc           │
│       resolvePanel() per id      │
│       mutates attrs w/ data+type │
└────────────────┬─────────────────┘
                 │ JSON with injected { data, display, panelType }
                 ▼
┌──────────────────────────────────┐
│ jyt-web: tiptap-renderer         │
│   StatsPanelExtension reads      │
│   attrs.data → lightweight SVG / │
│   CSS rendering (no chart deps)  │
└──────────────────────────────────┘
```

## Tiptap Node — Admin

`src/admin/components/common/tiptap-extensions/StatsPanelExtension.ts`

Attributes:

| Attr | Stored in HTML | Purpose |
|---|---|---|
| `panelId` | ✓ | Panel reference |
| `title` | ✓ | Header label shown in editor and storefront |
| `panelType` | ✓ | Snapshot of the panel's type at insert time (survives if panel type later changes) |
| `data` | ✗ (`rendered: false`) | In-memory result for live preview; never persisted to HTML |
| `display` | ✗ (`rendered: false`) | Same |

Why persist `panelType` as an attr instead of looking it up? Two reasons: (1) lets the storefront renderer know which view to build without another round-trip; (2) keeps the storefront rendering decoupled from upstream panel type edits — the blog post continues to render as the author intended at publish time.

### Node view

`src/admin/components/common/tiptap-extensions/StatsPanelNodeView.tsx`

Renders inside the editor by calling `usePanelData(panelId)` and feeding the result through the standard `PanelRenderer`. Shows a live preview while authoring.

### Picker

`src/admin/components/stats/stats-panel-picker.tsx`

`FocusModal` with a two-column layout: dashboards on the left, panels in the selected dashboard on the right (searchable). Clicking a panel inserts a `statsPanel` node at the cursor and closes the modal.

Registered in `src/admin/components/editor/editor.tsx`:

```tsx
extensions: [ /* ... */, StatsPanelExtension, /* ... */ ]
```

Toolbar button in `MainToolbarContent`:

```tsx
<ToolbarGroup>
  <StatsPanelPickerButton />
</ToolbarGroup>
```

The picker reads the Tiptap editor out of `EditorContext`, so no wiring needed beyond placing the button inside the toolbar that's already wrapped in `<EditorContext.Provider>`.

## Server-side Resolution

`src/modules/stats/inject-panel-data.ts`

```typescript
await injectStatsPanelData(container, tipTapDoc)
```

- Walks the Tiptap JSON recursively, collecting every `panelId` on `statsPanel` nodes.
- Resolves each via `resolvePanel()` (in parallel, de-duped by id).
- Mutates each node's attrs with `{ data, display, panelType, _resolvedAt }`.
- On individual panel failure, injects `{ data: null, error }` — one broken panel doesn't fail the blog response.

Called from `src/api/web/website/[domain]/blogs/[blogId]/route.ts`:

```typescript
await Promise.all(
  blocks.map((block: any) => {
    const tipTapContent = block?.content?.text
    if (tipTapContent) {
      return injectStatsPanelData(req.scope, tipTapContent)
    }
    return null
  })
)
```

### Caching

Each panel goes through the same `resolvePanel()` that admin uses, which honors the panel's `cache_ttl_seconds`. For an even bigger cache win, wrap the whole blog fetch in Next.js ISR (`fetch(..., { next: { revalidate: 300 } })`) — the first request populates, subsequent requests serve the cached JSON with panel data baked in.

## Storefront — jyt-web

`components/stats-panel.tsx`

Self-contained Tiptap node — no recharts or other chart dependency. Reads `node.attrs.data`, dispatches on `node.attrs.panelType`, and draws:

| Type | Implementation |
|---|---|
| `metric` | Big number + label |
| `label` | Heading + text block |
| `list` | `<ul>` with key / badge-value rows |
| `table` | Plain `<table>` |
| `bar` | CSS gradient bars sized against the max value |
| `line`, `area` | Hand-rolled inline `<svg>` with per-series path; supports multi-series pivots |

Registered in `components/tiptap-renderer.tsx`:

```tsx
const extensions = [ /* ... */, StatsPanelExtension ]
```

If `attrs.data` is missing (e.g. panel not pre-resolved, or panel deleted after publish), the node renders a "Panel data unavailable." placeholder so the post still renders.

## Why server-side pre-resolution (and not a public endpoint)

- **Security:** internal analytics aren't exposed as an anonymous API. No rate-limit story to maintain.
- **Cost:** one resolve per blog fetch instead of one per reader visit; ISR pushes it even lower.
- **Schema drift:** storefront needs no knowledge of operation options — it just reads pre-shaped result data.
- **Data freshness:** controllable per-panel via `cache_ttl_seconds` plus the outer ISR window. If a dashboard number changes, the panel picks it up on the next revalidation tick — usually what you want for a blog post.

## Known gaps

- **Storefront charts are intentionally tiny.** Fine for blog-scale data (tens of buckets). For heavy charts import recharts in `jyt-web` and replace the SVG renderer.
- **No per-panel preview caching in the node view.** Each blog edit session fires `/admin/stats/panels/:id/data` lookups via `usePanelData`. Cheap, but if the editor lag ever shows up, flip on the panel's `cache_ttl_seconds`.
- **Stripped attrs on legacy content.** Blog posts written before this change have no `statsPanel` nodes — no migration needed; they render as before.

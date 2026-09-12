# ANALYSIS: the admin graph / spine registry

Grounded behaviour document for the entity-graph "spine" mechanism in the admin
(as of this working tree). Every claim cites a full repo-relative path. A
senior verifier greps these paths; nothing here is inferred beyond what the
cited code says.

---

## 1. Purpose

The graph is an admin surface that draws one central record (the **spine**) and
its neighbours as nodes and edges, where an edge can be `present`, `derived`,
or `absent` — the absent edge being "a future edge that names the action that
would create it" (`apps/backend/src/lib/graph/types.ts:EdgeState`). The
**registry** is the mechanism that lets a new spine be added as "a single entry
here plus its resolver — no new route, no new admin hook"
(`apps/backend/src/lib/graph/registry.ts:SPINES`). The same resolvers feed the
admin canvas, the member drawer, and (per comments) an MCP
`get_entity_neighbours` tool — see §9 for the (unverified) status of the MCP
tool.

## 2. Entry points

### Server routes (the only HTTP surface)

- `GET /admin/graph/:spine/:id` — resolves one entity's neighbours for any
  registered spine; implemented by
  `apps/backend/src/api/admin/graph/[spine]/[id]/route.ts:GET`, which calls
  `apps/backend/src/lib/graph/registry.ts:resolveGraph`.
- `GET /admin/graph/:spine/:id/items/:node` — the members behind one aggregate
  node; implemented by
  `apps/backend/src/api/admin/graph/[spine]/[id]/items/[node]/route.ts:GET`,
  which calls `apps/backend/src/lib/graph/registry.ts:resolveGraphItems`.

### Admin client hooks

- `apps/backend/src/admin/hooks/api/graph.ts:useEntityGraph` — fetches
  `/admin/graph/${spine}/${id}`; one hook for every spine.
- `apps/backend/src/admin/hooks/api/graph.ts:useGraphNodeItems` — fetches the
  items route; `enabled` is the caller's because the drawer mounts for every
  node.
- `apps/backend/src/admin/hooks/api/graph.ts:useRemoveGraphNodeItem` — detaches
  a member through the server-named endpoint and invalidates both the item
  list and the graph query keys.

### Admin components (all spine-agnostic; take `spine` as a prop)

- `apps/backend/src/admin/components/graph/entity-graph.tsx:EntityGraph` — the
  in-page card (canvas + inspector column).
- `apps/backend/src/admin/components/graph/graph-workspace.tsx:GraphWorkspace` —
  the full-screen workspace (canvas + RouteDrawer + create/edit modals).
- `apps/backend/src/admin/components/graph/graph-canvas.tsx:GraphCanvas` — pure
  presentation; fetches nothing.
- `apps/backend/src/admin/components/graph/graph-viewport.tsx:GraphViewport` —
  pan/zoom wrapper.
- `apps/backend/src/admin/components/graph/node-inspector.tsx` —
  `NodeInspectorHeader` / `NodeInspectorBody` / `NodeInspectorActions`.
- `apps/backend/src/admin/components/graph/node-items.tsx` — `NodeItemList`
  (member rows + removal) and `NodeAddAnother`.
- `apps/backend/src/admin/components/graph/graph-create-modal.tsx` —
  `GraphCreateModal` / `GraphEditModal`.
- `apps/backend/src/admin/components/graph/node-forms.ts` — `nodeAffordance` /
  `actionRail` (pure functions, tested in
  `apps/backend/src/admin/components/graph/__tests__/node-forms.unit.spec.ts`).
- `apps/backend/src/admin/components/graph/graph-forms.tsx` — the client-side
  form registry (see §5).

### Admin pages that mount the graph

- Design page card: `apps/backend/src/admin/routes/designs/[id]/page.tsx`
  renders `apps/backend/src/admin/components/designs/design-graph-section.tsx:DesignGraphSection`
  with `spine="design"`.
- Design workspace: `apps/backend/src/admin/routes/designs/[id]/@graph/page.tsx`
  renders `GraphWorkspace spine="design"`.
- Partner page card: `apps/backend/src/admin/routes/partners/[id]/page.tsx`
  renders `EntityGraph spine="partner"`.
- Partner workspace: `apps/backend/src/admin/routes/partners/[id]/@graph/page.tsx`
  renders `GraphWorkspace spine="partner"`.
- Website page card: `apps/backend/src/admin/routes/websites/[id]/page.tsx`
  renders `EntityGraph spine="website"`.
- Website workspace: `apps/backend/src/admin/routes/websites/[id]/@graph/page.tsx`
  renders `GraphWorkspace spine="website"`.
- Queue boards: `apps/backend/src/admin/routes/queues/products-awaiting/page.tsx`
  and `apps/backend/src/admin/routes/queues/runs-rejected/page.tsx` render
  `GraphWorkspace spine="queue"` with the queue **name** as `id`.
- The `social_platform` spine has **no admin page consumer**: a grep for
  `spine="social` across `apps/backend/src/admin` finds no match (only the
  server-side resolver at
  `apps/backend/src/lib/graph/spines/social-platform/index.ts:socialPlatformSpine`
  registers it). It is reachable only via the raw API route.

## 3. The registries and the shape of an entry

There are three registries. The task's "node types are registered" is really
two server-side registries (spines, queues) plus one client-side registry
(forms).

### 3.1 The spine registry (server)

`apps/backend/src/lib/graph/registry.ts:SPINES` is a
`Record<string, SpineDescriptor>` with exactly five entries today:
`design`, `partner`, `website`, `social_platform`, `queue`
(`apps/backend/src/lib/graph/registry.ts:22-34`). `SPINE_KEYS` is
`Object.keys(SPINES)` (`apps/backend/src/lib/graph/registry.ts:36`).

The shape of a registry entry — `SpineDescriptor` at
`apps/backend/src/lib/graph/types.ts:133-151`:

- `key: string` — registry key and the value of `spine.key` in the response.
- `label: string` — human name, used in the not-found error.
- `resolve: (ctx: SpineContext) => Promise<Graph>` — builds the whole graph.
- `items?: (ctx, nodeKey) => Promise<NodeItem[]>` — optional member resolver.
- `itemNodes?: string[]` — node keys `items` can answer for, surfaced to the
  client as `Graph.itemNodes`.

`SpineContext` is `{ scope, id }` where `scope` is the request container
(`apps/backend/src/lib/graph/types.ts:128-131`).

### 3.2 The queue registry (server, nested inside the spine registry)

`apps/backend/src/lib/graph/queues/index.ts:QUEUES` maps queue names to
descriptors; today it holds exactly `"products-awaiting"` and `"runs-rejected"`
(`apps/backend/src/lib/graph/queues/index.ts:32-45`). The single
`queueSpine` (`apps/backend/src/lib/graph/queues/index.ts:queueSpine`, key
`"queue"`) dispatches on `ctx.id` (the queue name) through `queueOrThrow`,
which 404s on an unknown queue name (`apps/backend/src/lib/graph/queues/index.ts:49-58`).

### 3.3 The form registry (client)

`apps/backend/src/admin/components/graph/graph-forms.tsx:SPINE_FORMS` is a
`Record<string, SpineForms>` keyed by spine; today it contains exactly one
spine: `design` (`apps/backend/src/admin/components/graph/graph-forms.tsx:206-208`).
A `SpineForms` entry has three maps (`apps/backend/src/admin/components/graph/graph-forms.tsx:151-155`):

- `create: Record<string, CreateForm>` — `{ Form, label }` where `label` is
  the singular lower-case name of the thing created
  (`apps/backend/src/admin/components/graph/graph-forms.tsx:145-149`).
- `edit: Record<string, EditForm>` — `{ Form, label, title }`
  (`apps/backend/src/admin/components/graph/graph-forms.tsx:111-117`).
- `addAnother: Record<string, AddAnother>` — `{ label, href(id) }`
  (`apps/backend/src/admin/components/graph/graph-forms.tsx:132-135`).

`formsFor` returns an `EMPTY` registry for any spine not in `SPINE_FORMS`
(`apps/backend/src/admin/components/graph/graph-forms.tsx:210-212`), so the
partner, website, social_platform and queue spines have **no forms at all**.

### 3.4 How label / sublabel / count / href / forms are resolved

- **label, sublabel, count, href, props, action** are all constructed
  server-side, inline, by each spine's `resolve` function when it pushes a
  `GraphNode` (e.g. the design spine's `runs` node at
  `apps/backend/src/lib/graph/spines/design/index.ts:233-258`). The canvas
  renders `n.sublabel ?? ${n.count}` as the second line of a node box
  (`apps/backend/src/admin/components/graph/graph-canvas.tsx:269`).
- **count** for link-table nodes is the number of link ids that resolve to
  real records, via the second-pass
  `apps/backend/src/lib/graph/builder.ts:resolveExisting` (see §7).
- **create/edit forms** are resolved client-side: `registryFor(spine)` builds
  `Set`s of create/edit node keys (`apps/backend/src/admin/components/graph/graph-forms.tsx:registryFor`),
  `nodeAffordance` decides which to offer
  (`apps/backend/src/admin/components/graph/node-forms.ts:nodeAffordance`), and
  `createFormFor` / `editFormFor` return the component
  (`apps/backend/src/admin/components/graph/graph-forms.tsx:createFormFor`,
  `apps/backend/src/admin/components/graph/graph-forms.tsx:editFormFor`).
- **member rows** are resolved server-side by the spine's `items` resolver,
  dispatched from a per-spine `RESOLVERS` map keyed by node key (e.g.
  `apps/backend/src/lib/graph/spines/design/items.ts:RESOLVERS`).

## 4. What a "spine" is; how it differs from an ordinary node

A spine is the **centre record** of a graph. Mechanically:

- Each resolver constructs a `GraphBuilder` with the spine key — e.g.
  `new GraphBuilder("design")` (`apps/backend/src/lib/graph/spines/design/index.ts:217`),
  `"partner"` (`apps/backend/src/lib/graph/spines/partner/index.ts:195`),
  `"website"` (`apps/backend/src/lib/graph/spines/website/index.ts:86`),
  `"social_platform"` (`apps/backend/src/lib/graph/spines/social-platform/index.ts:72`),
  `"queue"` (`apps/backend/src/lib/graph/queues/products-awaiting.ts:219`,
  `apps/backend/src/lib/graph/queues/runs-rejected.ts:100`) — and every edge
  pushed through `GraphBuilder.push` gets `from: this.spineKey`
  (`apps/backend/src/lib/graph/builder.ts:20-23`). So **all edges originate at
  the spine**; there are never edges between neighbours.
- The resolver ends by calling `builder.build(spine)` with a `GraphNode` whose
  `key` equals the spine key (design:
  `apps/backend/src/lib/graph/spines/design/index.ts:851-882`; partner:
  `apps/backend/src/lib/graph/spines/partner/index.ts:564-587`; website:
  `apps/backend/src/lib/graph/spines/website/index.ts:300-321`; social:
  `apps/backend/src/lib/graph/spines/social-platform/index.ts:205-222`; queues:
  `apps/backend/src/lib/graph/queues/products-awaiting.ts:264-301`).
- **Visually**: the canvas renders the spine as a distinct box of width
  `SPINE_W = 168` (vs `NODE_W = 176` for neighbours), always styled
  `stateStyles("present", …)` with `bg-ui-bg-subtle`, placed at `spineX`
  (`apps/backend/src/admin/components/graph/graph-canvas.tsx:234-246`). In the
  "columns" layout the spine sits on the left with neighbours stacked right
  (`apps/backend/src/admin/components/graph/graph-canvas.tsx:place`); in the
  "balanced" layout (used by both `EntityGraph` and `GraphWorkspace`) the spine
  is centred with neighbours on both sides so no edge crosses a node box
  (`apps/backend/src/admin/components/graph/graph-canvas.tsx:placeBalanced`).
- **Behaviourally**: the spine node is always `state: "present"` in every
  resolver (e.g. `apps/backend/src/lib/graph/spines/design/index.ts:856`);
  clicking it selects it (`onSelect(spineKey)`,
  `apps/backend/src/admin/components/graph/graph-canvas.tsx:236`); and
  `GraphWorkspace` treats `selectedKey === spineKey` specially — it renders
  `graph.spine` and skips the edge lookup
  (`apps/backend/src/admin/components/graph/graph-workspace.tsx:114-131`).
  Ordinary nodes get state-dependent styling: `absent` = dashed red border +
  red text, `derived` = dashed strong border, `present` = solid border +
  card shadow (`apps/backend/src/admin/components/graph/graph-canvas.tsx:stateStyles`,
  lines 104-115), and absent edges are drawn dashed in `#9F1239`
  (`apps/backend/src/admin/components/graph/graph-canvas.tsx:203-215`).

## 5. The spines today and every node hung off each

There is no single "the spine" — five are registered. Design was the first
(#1847), partner the second (#1847), website and social_platform third/fourth
(#1855), queue fifth (#1856)
(`apps/backend/src/lib/graph/registry.ts:22-34`). Order is **not** a spine.

### 5.1 `design` spine — `apps/backend/src/lib/graph/spines/design/index.ts:designSpine`

Entity: `model.define("design", …)` in
`apps/backend/src/modules/designs/models/design.ts:7`. All node rows below are
constructed in `resolveDesignGraph`
(`apps/backend/src/lib/graph/spines/design/index.ts:resolveDesignGraph`):

| key | `type` | drawn when | states | edge label | href |
|---|---|---|---|---|---|
| `runs` | `production_run` | runList.length, or absent when committed & 0 runs | present / absent | `design_id` | `/designs/:id/production-runs` |
| `runs_rejected` | `production_run` | ≥1 rejected run | present | `approval_decision` | `/designs/:id/production-runs` |
| `product` | `product` | one of three states; NOT drawn when `productNodeState` returns `"none"` (no products, no outstanding runs, no linked products) | present / derived / absent | `approved_product_id` (present/absent), `product_design` (derived) | `/products/:productId` or null |
| `partners` | `partner` | partners linked, or absent when an outsourced run exists | present / absent | `partner` | `/designs/:id/partners` |
| `tasks` | `task` | tasks exist | present | `tasks` | `/designs/:id/tasks` |
| `inventory` | `inventory_item` | items linked, or absent when runs exist & none linked | present / absent | `inventory_item` | `/designs/:id` |
| `media` | `media` | files + folders + moodboard > 0 | present | `media_folder` | `/designs/:id/media` |
| `orders` | `order` | order link ids resolve | present | `order` | `/orders/:firstOrderId` |
| `customers` | `customer` | customers exist | present | `customer` | null |
| `specifications` | `specification` | specs exist, or absent when committed & none | present / absent | `specifications` | `/designs/:id` |
| `consumption` | `consumption_log` | logs resolve, or absent when a finished run has none | present / absent | `consumption_log` | `/designs/:id` |
| `materials` | `raw_material_group` | link rows resolve | present | `raw_material_group` | `/designs/:id` |
| `people` | `person` | link rows resolve | present | `person` | `/designs/:id` |
| `palette` | `palette` | colors or size_sets exist | present | `colors / size_sets` | `/designs/:id` |
| `components` | `design_component` | components or used_in exist | present | `components / used_in` | `/designs/:id` |
| `revision` | `design` | `design.revised_from_id` set | present | `revised_from_id` | `/designs/:revisedFromId` |

Line references for each block: runs 233-300, runs_rejected 321-357, product
367-457, partners 463-506, tasks 510-529, inventory 533-573, media 577-598,
orders 602-618, customers 620-639, specifications 643-683, consumption 687-730,
materials 734-755, people 759-778, palette 782-801, components 805-824,
revision 828-847 (all in
`apps/backend/src/lib/graph/spines/design/index.ts`).

Data sources per node: `partners`, `tasks`, `inventory_items`, `customers`,
`specifications`, `colors`, `size_sets`, `components`, `used_in` are read as
fields off the `designs` entity (`apps/backend/src/lib/graph/spines/design/index.ts:59-77`);
`runs` off `entity: "production_runs"` filtered by `design_id`
(`apps/backend/src/lib/graph/spines/design/index.ts:99-103`); orders, media
folders, products, consumption logs, people, material groups through their
link `entryPoint`s (`apps/backend/src/lib/graph/spines/design/index.ts:116-154`).

Its item resolvers (`apps/backend/src/lib/graph/spines/design/items.ts:RESOLVERS`)
cover exactly: `inventory`, `components`, `tasks`, `partners`, `runs`,
`consumption`, `materials`, `orders`, `people`, `specifications` — exported as
`DESIGN_ITEM_NODES` (`apps/backend/src/lib/graph/spines/design/items.ts:DESIGN_ITEM_NODES`).

### 5.2 `partner` spine — `apps/backend/src/lib/graph/spines/partner/index.ts:partnerSpine`

Entity: the partner module (link files import
`apps/backend/src/modules/partner`). All rows from `resolvePartnerGraph`
(`apps/backend/src/lib/graph/spines/partner/index.ts:resolvePartnerGraph`):

| key | `type` | drawn when | states | edge label |
|---|---|---|---|---|
| `admins` | `partner_admin` | admins exist, or absent always when 0 | present / absent | `partner_admin` |
| `payment_methods` | `internal_payment_details` | methods resolve, or absent when payable work & none | present / absent | `payment_methods` |
| `stores` | `store` | stores resolve, or absent when `workspace_type === "seller"` & none | present / absent | `stores` |
| `runs` | `production_run` | runs assigned to partner | present | `partner_id` |
| `designs` | `design` | design link ids resolve | present | `design_partner` |
| `tasks` | `task` | task link ids resolve | present | `partner_task` |
| `products` | `product` | product link ids resolve | present | `partner_product` |
| `orders` | `order` | order link ids resolve | present | `partner_order` |
| `inventory_orders` | `inventory_order` | link ids resolve | present | `partner_inventory_order` |
| `submissions` | `payment_submission` | link ids resolve | present | `payment_submission` |
| `people` | `person` | link ids resolve | present | `partner_person` |
| `subscriptions` | `partner_subscription` | link ids resolve | present | `partner_subscription` |
| `whatsapp` | `channel` | number set & unverified | derived | `whatsapp_number` |
| `domain` | `domain` | domain set & unverified | derived | `custom_domain` |

Line references: admins 200-240, payment_methods 246-287, stores 291-328, runs
332-356, designs 358-374, tasks 376-392, products 394-410, orders 412-428,
inventory_orders 430-446, submissions 448-464, people 466-482, subscriptions
484-500, whatsapp 512-536, domain 538-562 (all in
`apps/backend/src/lib/graph/spines/partner/index.ts`). Absence rules live in
`apps/backend/src/lib/graph/spines/partner/absence.ts` (`expectsAdmin`,
`expectsPaymentMethod`, `expectsStore`, `whatsappUnverified`, `domainUnverified`,
`deliveredRuns`).

Its item resolvers (`apps/backend/src/lib/graph/spines/partner/items.ts:RESOLVERS`)
cover exactly: `admins`, `designs`, `runs`, `submissions`, `payment_methods`,
`people` — exported as `PARTNER_ITEM_NODES`
(`apps/backend/src/lib/graph/spines/partner/items.ts:PARTNER_ITEM_NODES`).
Note `products`, `orders`, `inventory_orders`, `stores`, `subscriptions` have
**no** item resolver.

### 5.3 `website` spine — `apps/backend/src/lib/graph/spines/website/index.ts:websiteSpine`

All rows from `resolveWebsiteGraph`
(`apps/backend/src/lib/graph/spines/website/index.ts:resolveWebsiteGraph`):

| key | `type` | drawn when | states | edge label |
|---|---|---|---|---|
| `pages` | `page` | pages exist, or absent when live & none | present / absent | `website_id` |
| `published` | `page` | pages exist AND none published on a live site | absent | `status = Published` |
| `newsletters` | `page` | ≥1 published newsletter never sent | absent | `sent_to_subscribers` |
| `empty_pages` | `page` | ≥1 published page with no blocks and no content | absent | `blocks / content` |
| `blocks` | `block` | total blocks > 0 | present | `page_id` |
| `domains` | `website_domain` | domains exist | present | `website_id` |
| `sends` | `subscription_send_log` | send logs exist | present / derived | `subscription_send_log` |

Line references: pages 91-130, published 140-163, newsletters 167-193,
empty_pages 197-217, blocks 221-237, domains 241-261, sends 265-298 (all in
`apps/backend/src/lib/graph/spines/website/index.ts`). Absence rules in
`apps/backend/src/lib/graph/spines/website/absence.ts` (`isLive`,
`expectsPublishedPage`, `newslettersAwaitingSend`, `emptyPublishedPages`,
`failedSends`). All neighbours are intra-module relations read straight off the
`websites` entity — no link tables, hence no `resolveExisting`
(`apps/backend/src/lib/graph/spines/website/index.ts:25-30`).

Item resolvers cover all seven keys: `pages`, `published`, `newsletters`,
`empty_pages`, `blocks`, `domains`, `sends`
(`apps/backend/src/lib/graph/spines/website/items.ts:RESOLVERS`,
`apps/backend/src/lib/graph/spines/website/items.ts:WEBSITE_ITEM_NODES`).

### 5.4 `social_platform` spine — `apps/backend/src/lib/graph/spines/social-platform/index.ts:socialPlatformSpine`

All rows from `resolveSocialPlatformGraph`
(`apps/backend/src/lib/graph/spines/social-platform/index.ts:resolveSocialPlatformGraph`):

| key | `type` | drawn when | states | edge label |
|---|---|---|---|---|
| `bindings` | `social_platform_binding` | bindings exist | present / derived | `platform_id` |
| `posts` | `social_post` | posts exist | present | `platform_id` |
| `campaigns` | `publishing_campaign` | campaigns exist | present | `platform_id` |
| `ad_accounts` | `ad_account` | ad accounts exist | present | `platform_id` |
| `leads` | `lead` | leads exist | present | `platform_id` |

Line references: bindings 77-113, posts 117-141, campaigns 143-167, ad_accounts
169-185, leads 187-203 (all in
`apps/backend/src/lib/graph/spines/social-platform/index.ts`). It asserts
exactly one fault — the never-synced/errored binding rule in
`apps/backend/src/lib/graph/spines/social-platform/absence.ts:neverSynced` and
`apps/backend/src/lib/graph/spines/social-platform/absence.ts:erroredBindings`.
Item resolvers cover all five keys
(`apps/backend/src/lib/graph/spines/social-platform/items.ts:RESOLVERS`,
`apps/backend/src/lib/graph/spines/social-platform/items.ts:SOCIAL_PLATFORM_ITEM_NODES`).

### 5.5 `queue` spine — `apps/backend/src/lib/graph/queues/index.ts:queueSpine`

Centred on a **population**, not a record: `id` is the queue name
(`apps/backend/src/lib/graph/queues/index.ts:10-17`). Two queues exist:

- `"products-awaiting"` — nodes are one per design with finished/approved runs
  lacking `approved_product_id`, keyed `design:<id>`, `type
  "design_awaiting_product"`, state `absent` or `derived`
  (`apps/backend/src/lib/graph/queues/products-awaiting.ts:resolveProductsAwaiting`,
  node construction 221-262). Capped at 18 nodes, longest-waiting first
  (`apps/backend/src/lib/graph/queues/products-awaiting.ts:73`, 212-217).
- `"runs-rejected"` — nodes one per design with rejected runs, keyed
  `design:<id>`, `type "design_rejected_runs"`, always `present`
  (`apps/backend/src/lib/graph/queues/runs-rejected.ts:resolveRunsRejected`,
  node construction 102-133). Also capped at 18, most rejected output first
  (`apps/backend/src/lib/graph/queues/runs-rejected.ts:43`, 93-98).

Both queues share the design spine's predicates rather than restating them:
`runsAwaitingProduct` and `runsRejected` are imported from
`apps/backend/src/lib/graph/spines/design/absence.ts`
(`apps/backend/src/lib/graph/queues/products-awaiting.ts:2`,
`apps/backend/src/lib/graph/queues/runs-rejected.ts:2`).

## 6. How a node is keyed; the `type` discriminator

Nodes are keyed by the `key` string on `GraphNode`
(`apps/backend/src/lib/graph/types.ts:21-33`), **not** by `type`. The item
resolver map is explicitly "Keyed by KEY, like every other registry in this
feature. Two nodes on this spine are of type `design` and point at different
records; a map keyed by type would list the wrong one's members"
(`apps/backend/src/lib/graph/spines/design/items.ts:472-478`). The form
registry is likewise "keyed by SPINE, then by NODE KEY … By key rather than
type, because the design spine emits TWO nodes of type `design`"
(`apps/backend/src/admin/components/graph/graph-forms.tsx:26-35`).

Every value the `type` discriminator can take, per spine (from the resolvers
cited in §5):

- design spine: `production_run`, `product`, `partner`, `task`,
  `inventory_item`, `media`, `order`, `customer`, `specification`,
  `consumption_log`, `raw_material_group`, `person`, `palette`,
  `design_component`, `design` (spine + `revision`).
- partner spine: `partner_admin`, `internal_payment_details`, `store`,
  `production_run`, `design`, `task`, `product`, `order`, `inventory_order`,
  `payment_submission`, `person`, `partner_subscription`, `channel`, `domain`,
  `partner` (spine).
- website spine: `page`, `block`, `website_domain`,
  `subscription_send_log`, `website` (spine).
- social_platform spine: `social_platform_binding`, `social_post`,
  `publishing_campaign`, `ad_account`, `lead`, `social_platform` (spine).
- queue spine: `queue` (spine), `design_awaiting_product`,
  `design_rejected_runs`.

**Two nodes sharing one type** (the collision the key-based design exists to
survive):

- On the design spine, `runs` and `runs_rejected` both have type
  `production_run` (`apps/backend/src/lib/graph/spines/design/index.ts:237`
  and `:330`).
- On the design spine, the spine node and the `revision` node both have type
  `design` (`apps/backend/src/lib/graph/spines/design/index.ts:853` and
  `:832`) — the exact case called out in
  `apps/backend/src/admin/components/graph/node-forms.ts:31-40`.
- On the website spine, `pages`, `published`, `newsletters` and `empty_pages`
  all have type `page` (`apps/backend/src/lib/graph/spines/website/index.ts:95`,
  `:144`, `:171`, `:201`).
- Across spines, `product`, `person`, `task`, `order`, `production_run` and
  `design` each appear on both the design and partner spines; this is safe
  because every registry is scoped per-spine first.

## 7. Create forms: where registered, and which nodes have none

### 7.1 Registered forms (all of them)

The only registered forms live in `DESIGN_FORMS`
(`apps/backend/src/admin/components/graph/graph-forms.tsx:DESIGN_FORMS`):

- **create** (`apps/backend/src/admin/components/graph/graph-forms.tsx:158-163`):
  - `tasks` → `CreateDesignTaskComponent` (from
    `apps/backend/src/admin/components/creates/create-design-task`), label
    "task".
  - `partners` → `DesignPartnerCreateForm` wrapping
    `LinkDesignPartnerForm` (from
    `apps/backend/src/admin/components/forms/link-design-partner/link-design-partner-form`),
    label "partner".
  - `inventory` → `DesignInventoryCreateForm` wrapping `DesignInventoryTable`
    (from `apps/backend/src/admin/components/designs/design-inventory-table`),
    label "inventory item".
  - `components` → `DesignComponentCreateForm` wrapping `AddDesignComponentForm`
    (from `apps/backend/src/admin/components/creates/create-design-component`),
    label "bundled design".
- **edit** (`apps/backend/src/admin/components/graph/graph-forms.tsx:177-188`):
  - `design` → `EditDesignForm` (from
    `apps/backend/src/admin/components/edits/edit-design`) via `withDesign`,
    label "Edit design".
  - `palette` → `ColorPaletteEditor` (from
    `apps/backend/src/admin/components/edits/edit-color-palette`) via
    `withDesign`, label "Edit colours & sizes".
- **addAnother** (`apps/backend/src/admin/components/graph/graph-forms.tsx:164-176`):
  - `runs` → "Start another run", href `/designs/:id/production-run`.

### 7.2 Nodes with NO create form

On the design spine, every node key other than `tasks`, `partners`,
`inventory`, `components` has no create form. The file itself names the
deliberate omissions — `media`, `runs`, `product`, `specifications`,
`revision` — with reasons (`apps/backend/src/admin/components/graph/graph-forms.tsx:189-203`).
Additionally `orders`, `customers`, `consumption`, `materials`, `people`,
`palette`, `runs_rejected` have no create form and no `addAnother`.

**Capability-unreachable-when-empty**: the canvas only draws nodes it has data
for, and `GraphWorkspace`'s "Add" dropdown lists only `creatableFor(spine)` —
the create-registry keys — whether or not a node is drawn
(`apps/backend/src/admin/components/graph/graph-workspace.tsx:227-263`,
`apps/backend/src/admin/components/graph/graph-forms.tsx:creatableFor`).
Therefore, on the design spine, a node that is (a) present-only and (b) not in
the create registry has **no route from the graph when it has 0 rows**:
`materials`, `people`, `customers`, `orders`, `media` (media is only emitted
when present — `apps/backend/src/lib/graph/spines/design/index.ts:578`;
`materials` only when link rows resolve — `:734`; `people` — `:759`;
`customers` — `:620`; `orders` — `:602`). Their capability is reachable only
from the page sections outside the graph. By contrast, `specifications` and
`consumption` do get drawn as `absent` when their expectation rules fire
(`apps/backend/src/lib/graph/spines/design/absence.ts:expectsSpecification`,
`apps/backend/src/lib/graph/spines/design/absence.ts:expectsConsumptionLog`),
so they at least surface an action card.

For the partner, website, social_platform and queue spines there are **no
forms registered at all** (`SPINE_FORMS` contains only `design`,
`apps/backend/src/admin/components/graph/graph-forms.tsx:206-208`), so no
create/edit capability exists anywhere in the graph on those spines; absent
nodes there fall back to the action card
(`apps/backend/src/admin/components/graph/node-forms.ts:nodeAffordance` —
`action` is only a fallback when no create form exists).

### 7.3 Affordance rules

`nodeAffordance` (`apps/backend/src/admin/components/graph/node-forms.ts:nodeAffordance`)
offers: `create` whenever the key is in the spine's create registry;
`edit` only when `state !== "absent"` AND the key is in the edit registry
(derived nodes are editable); `action` only as a fallback (no create form,
absent, and the node carries an `action`). Tested in
`apps/backend/src/admin/components/graph/__tests__/node-forms.unit.spec.ts`.

## 8. Where `product` appears in the graph

- **There is no product spine.** `SPINES` has exactly `design`, `partner`,
  `website`, `social_platform`, `queue`
  (`apps/backend/src/lib/graph/registry.ts:22-34`).
- **Design spine `product` node** (key `"product"`, type `"product"`): drawn
  in one of three states decided by
  `apps/backend/src/lib/graph/spines/design/absence.ts:productNodeState` —
  `present` when runs wrote `approved_product_id`; `derived` when the design
  is joined to a product only through the `product_design` link; `absent` when
  any finished/approved run still owes a product (order matters: absent is
  tested first, `apps/backend/src/lib/graph/spines/design/absence.ts:123-141`).
  It draws label "Product", sublabel counts, href `/products/:id`, and in the
  absent branch an action "List this run as a product" →
  `/designs/:id/production-runs`
  (`apps/backend/src/lib/graph/spines/design/index.ts:359-457`). It offers **no
  create form** (deliberately unregistered,
  `apps/backend/src/admin/components/graph/graph-forms.tsx:198-201`) and **no
  member list** — `product` is absent from the design item `RESOLVERS`
  (`apps/backend/src/lib/graph/spines/design/items.ts:RESOLVERS`), the
  file's own comment naming `product` and `revision` as single records
  (`apps/backend/src/lib/graph/spines/design/items.ts:27-29`).
- **Partner spine `products` node** (key `"products"`, type `"product"`):
  present-only, via the partner↔product ownership link defined in
  `apps/backend/src/links/partner-product.ts` (which links
  `PartnerModule.linkable.partner` to `ProductModule.linkable.product` with
  provenance extra-columns). It has no item resolver — `products` is not in
  `PARTNER_ITEM_NODES` (`apps/backend/src/lib/graph/spines/partner/items.ts:RESOLVERS`).
- **Queue `products-awaiting`**: candidate products are listed per design node
  by `apps/backend/src/lib/graph/queues/products-awaiting.ts:productsAwaitingItems`,
  each row href `/products/:id`, with provenance sublabels ("linked to this
  design", "on a revision of this design", "approved from another run of this
  design").
- **Entity name in model.define terms**: `product` is a Medusa **core** entity,
  not a `model.define` in this repo's custom modules — the graph reaches it
  via `ProductModule.linkable.product` imported from `@medusajs/medusa/product`
  in `apps/backend/src/links/product-design-link.ts` and
  `apps/backend/src/links/partner-product.ts`, and via `query.graph` entity
  `"product"` in `apps/backend/src/lib/graph/builder.ts:resolveExisting` calls.

## 9. Gotchas / invariants

1. **Unknown spine vs unknown node are different errors.** An unknown spine
   key is a 404 `MedusaError` naming the valid keys; an unknown node key (or a
   spine without an `items` resolver) returns an empty list
   (`apps/backend/src/lib/graph/registry.ts:resolveGraph`,
   `apps/backend/src/lib/graph/registry.ts:resolveGraphItems`). Same for queue
   names (`apps/backend/src/lib/graph/queues/index.ts:queueOrThrow`).
2. **`itemNodes` precedence**: the registry returns
   `spine.itemNodes ?? graph.itemNodes ?? []` — the spine's declaration wins
   over what a resolver set, which is load-bearing for the queue spine (its
   node keys are `design:<id>` and unknown until resolution)
   (`apps/backend/src/lib/graph/registry.ts:76`).
3. **A node and its edge are pushed together** — `GraphBuilder.push` is the
   only way to add either, so a node can never render as an orphan and the
   summary (counted off edges) can't disagree with the canvas
   (`apps/backend/src/lib/graph/builder.ts:13-35`,
   `apps/backend/src/lib/graph/builder.ts:summarise`).
4. **A link row is not a record.** Every link-table node filters its ids
   through `resolveExisting` before counting, so nodes never claim `present`
   against deleted targets
   (`apps/backend/src/lib/graph/builder.ts:resolveExisting`; applied at
   `apps/backend/src/lib/graph/spines/design/index.ts:179-194` and
   `apps/backend/src/lib/graph/spines/partner/index.ts:171-193`).
5. **Module links must be read through `entryPoint`**, never as a field hop
   off the entity — a `query.graph` hop to a linked field can come back with no
   key at all rather than an error
   (`apps/backend/src/lib/graph/spines/design/index.ts:106-115`,
   `apps/backend/src/lib/graph/spines/partner/index.ts:34-39`). Intra-module
   `hasMany` relations are the exception and resolve straight off the entity
   (`apps/backend/src/lib/graph/spines/design/index.ts:68-76`).
6. **Forms are keyed spine → node key, never type** — see §6; keying by type
   would offer the design's edit form on the `revision` node and silently edit
   the wrong record (`apps/backend/src/admin/components/graph/node-forms.ts:31-40`).
7. **Selection lives in the URL** (`?node=`), so node keys are part of the
   public URL surface of the workspace; renaming a key silently breaks deep
   links (`apps/backend/src/admin/components/graph/graph-workspace.tsx:27-39`).
   `placeholderNode` rescues an unknown `?node=` value **only** if it is in the
   create registry (`apps/backend/src/admin/components/graph/graph-workspace.tsx:95-112`).
8. **The spine node's `key` must equal the `GraphBuilder` constructor
   argument** — every edge's `from` is the constructor's spine key
   (`apps/backend/src/lib/graph/builder.ts:22`), and the canvas finds a node's
   edge via `edges.find((e) => e.to === key)`
   (`apps/backend/src/admin/components/graph/graph-canvas.tsx:155`). Re-keying
   the spine node without re-keying the builder (or vice versa) orphans every
   edge label and breaks spine selection.
9. **Removing a node** from a resolver does not remove its form: the "Add"
   dropdown is driven by the form registry, not by drawn nodes
   (`apps/backend/src/admin/components/graph/graph-workspace.tsx:227-263`), and
   `creatableFor`/`registryFor` read `SPINE_FORMS` independently of the server
   (`apps/backend/src/admin/components/graph/graph-forms.tsx:creatableFor`).
   Conversely, removing a form while the node stays strands the placeholder
   path (a `?node=` for a non-drawn, non-creatable key renders no drawer
   content — `active` is undefined,
   `apps/backend/src/admin/components/graph/graph-workspace.tsx:114-118`).
10. **`itemNodes` must agree with `items()`** — the registry attaches the
    declaration precisely so a graph whose `itemNodes` disagreed with its
    items resolver cannot render drawers that fetch nothing
    (`apps/backend/src/lib/graph/registry.ts:59-76`). Renaming a node key in
    the resolver without renaming it in the spine's `itemNodes` array (and in
    the per-spine `RESOLVERS` map) breaks the drawer for that node.
11. **Removal paths are server-built and name existing endpoints** — the
    client never assembles them
    (`apps/backend/src/lib/graph/types.ts:NodeItemRemoval`,
    `apps/backend/src/admin/hooks/api/graph.ts:84-89`); e.g. inventory delink
    posts `/admin/designs/:id/inventory/delink` with `inventoryIds: [one id]`
    (`apps/backend/src/lib/graph/spines/design/items.ts:93-99`), and partner
    cancel posts `/admin/designs/:id/cancel-partner-assignment` with
    `unlink: true` (`apps/backend/src/lib/graph/spines/design/items.ts:231-239`).
12. **After any create/edit form layer closes, the graph is refetched** by
    invalidating the `["graph"]` key prefix
    (`apps/backend/src/admin/components/graph/graph-create-modal.tsx:23-31`);
    after a removal, both the item list and the graph are invalidated
    (`apps/backend/src/admin/hooks/api/graph.ts:161-187`).
13. **Queues cap at 18 nodes after sorting**, and say out loud when designs
    were skipped because a run's `design_id` outlived the design
    (`apps/backend/src/lib/graph/queues/products-awaiting.ts:73`,
    `:290-297`; `apps/backend/src/lib/graph/queues/runs-rejected.ts:43`,
    `:160-167`).
14. **Entity-name spelling is inconsistent across the graph code**: the design
    spine queries `entity: "designs"`
    (`apps/backend/src/lib/graph/spines/design/index.ts:60`) while the queue
    resolvers and the partner spine's `resolveExisting` call use
    `entity: "design"` (`apps/backend/src/lib/graph/queues/products-awaiting.ts:122`,
    `apps/backend/src/lib/graph/queues/runs-rejected.ts:81`,
    `apps/backend/src/lib/graph/spines/partner/index.ts:183`). Both spellings
    appear in shipped code; which one Medusa's `query.graph` canonicalises is
    not determinable from this repo alone (unverified — see §10).

## 10. Open questions / (unverified)

- **MCP `get_entity_neighbours`**: comments in
  `apps/backend/src/lib/graph/registry.ts:14`,
  `apps/backend/src/lib/graph/types.ts:7`,
  `apps/backend/src/lib/graph/spines/design/index.ts:28` and
  `apps/backend/src/api/admin/graph/[spine]/[id]/route.ts:12` claim an MCP tool
  consumes the same resolvers. No implementation of that tool was found in
  this repo by grep (`get_entity_neighbours` matches only those comments);
  it presumably lives outside `apps/backend/src` or in another service.
  (unverified)
- **Which of `entity: "design"` vs `entity: "designs"` is canonical** for
  `query.graph` — see §9 item 14. (unverified)
- **Whether the `social_platform` spine has any consumer at all** beyond the
  raw API route — no admin page passes `spine="social_platform"` (§2). Its
  registration may be ahead of its UI. (verified absence of a consumer in
  `apps/backend/src/admin`; intent unverified)
- Tests exist for the absence rules, design items, the rejected-runs queue and
  the affordance rules
  (`apps/backend/src/lib/graph/spines/design/__tests__/absence.unit.spec.ts`,
  `apps/backend/src/lib/graph/spines/design/__tests__/items.unit.spec.ts`,
  `apps/backend/src/lib/graph/spines/design/__tests__/runs-rejected.unit.spec.ts`,
  `apps/backend/src/lib/graph/spines/partner/__tests__/absence.unit.spec.ts`,
  `apps/backend/src/lib/graph/spines/website/__tests__/absence.unit.spec.ts`,
  `apps/backend/src/lib/graph/spines/social-platform/__tests__/absence.unit.spec.ts`,
  `apps/backend/src/admin/components/graph/__tests__/node-forms.unit.spec.ts`);
  git, installs and network are blocked in this analysis session, so none were
  run.

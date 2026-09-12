# Audit: MCP tool coverage vs. the admin API surface

**Date:** 2026-09-12 · **Branch:** `feat/mcp-tool-coverage`

The admin MCP registry (`apps/backend/src/api/admin/mcp/lib/registry.ts`) exposes a
subset of the admin HTTP API. This audit enumerates **every** admin route and HTTP
verb, cross-references it against `ADMIN_MCP_TOOLS`, rates the gaps, and records which
gaps are deliberately left as gaps. Phase 2 (the high-value tools actually added) is
documented at the bottom.

---

## 1. Method

### 1.1 Route enumeration

All files matching `src/api/admin/**/route.ts` were walked recursively (612 files).
Each was scanned for HTTP handlers in both of the export styles Medusa accepts:

- `export const GET = …`
- `export async function POST(…)` / `export function POST(…)`

Both styles are used in this repo (e.g. `designs/[id]/notify-customer` and
`orders/[id]/design-changes` use the `export async function` form). A handler that
exists in the other style would silently drop the route, so both regexes are used.

### 1.2 Route → path mapping and normalisation

Medusa derives the API path from the directory tree and uses `[param]` segments;
the registry uses `:param`. A naive string compare reports tools as missing that
exist, so paths are normalised **by shape**: every `:[A-Za-z0-9_]+` segment (and
every `[param]` directory segment) becomes the wildcard token `:P`. Two paths match
iff they have the same verb and the same sequence of literal / dynamic segments.
This tolerates the registry using a different param **name** than the directory
(`:product_id` in the registry vs `[id]` in the tree) — the dispatcher substitutes
positionally, so names need not agree.

### 1.3 Sanity checks (the matcher is correct)

| Tool | Method + path | Matched repo route? |
|---|---|---|
| `get_order` | `GET /admin/orders/:id` | ✅ `orders/[id]/route.ts` |
| `list_products` | `GET /admin/products` | ✅ **core route** — no repo `products/route.ts` exists; the tool wraps Medusa core's own route |
| `create_partner` | `POST /admin/partners` | ✅ `partners/route.ts` |

`list_products` is covered by a tool even though no *repo* route file matches: the
route lives in `@medusajs/medusa` (core), which is exactly why the
`route-validator-field-coverage` test treats `admin:create_product` etc. as core
routes. Roughly 60 of the 235 tools wrap core routes; they are covered by tools, so
they are not gaps. The audit's "covered" count therefore counts repo routes that
have a tool; tools over core routes are counted separately (see §2).

---

## 2. Counts

| Metric | Count |
|---|---|
| Admin route files (`**/route.ts`) | 612 |
| Route + verb pairs (all HTTP verbs exported) | **884** |
| Tools in `ADMIN_MCP_TOOLS` | **235** |
| Repo route+verb pairs with a tool | **174** |
| Tools wrapping core (Medusa) routes | ≈61 |
| **Repo route+verb pairs WITHOUT a tool** | **710** |
| — of which rated **meaningful** (worth an assistant tool) | 392 |
| — of which rated **deliberately not worth a tool** | 318 |

Coverage of the *repo-defined* surface: **174 / 884 = 19.7%** of route+verb pairs
have a tool. The large gap is partly structural — the admin API has whole
second-tier surfaces (website builder, visual flows, cap tables, ad planning, media
uploads) that no assistant ask should reach — but it also hides real holes in the
core commerce domains (orders, inventory, payments), which are the ones Phase 2
closes. The gaps that SHOULD stay gaps are a finding, not an omission — see §4.

---

## 3. The uncovered routes worth a tool (grouped by domain)

Each row: verb, path, what it does, value rating, reason. Ratings: **high** = an
assistant ask hits this and cannot proceed; **medium** = useful but reachable
another way, or niche; **low** = cosmetic/redundant. The 12 routes implemented in
Phase 2 are marked **✅ done**.

### 3.1 Orders

| Verb | Path | What it does | Value | Reason |
|---|---|---|---|---|
| GET | `/admin/orders/:id/balance` | What a customer order still owes; whether the balance can be raised; the buyer's link | **high ✅** | "Is this order fully paid? / can we collect the balance?" is an ordinary ask with no tool. |
| POST | `/admin/orders/:id/balance` | Raise the balance and mint the buyer's payment link (charges a buyer) | high | Writes money; only reached after the GET. Next batch. |
| POST | `/admin/orders/:id/design-changes` | Record a design change against the order | medium | Order-edit flow has its own tools. |
| POST | `/admin/orders/:id/external-awb` | Attach an externally-booked AWB | low | `attach_order_awb` covers the same need via shiprocket. |
| POST | `/admin/orders/:id/fulfillments/:fulfillmentId/cancel-shipment` | Cancel a carrier shipment | medium | `cancel_order_fulfillment` covers most of it. |
| DELETE | `/admin/orders/:id/fulfillments/:fulfillmentId/external-awb` | Detach an external AWB | low | Same as external-awb attach. |
| POST | `/admin/orders/:id/fulfillments/:fulfillmentId/external-pickup` | Book an external pickup | medium | Carrier ops; niche. |
| POST | `/admin/orders/:id/fulfillments/:fulfillmentId/fulfillment-shipment` | Create the fulfillment shipment | low | `create_order_shipment` is the tool form. |
| POST | `/admin/orders/:id/fulfillments/:fulfillmentId/pickup` | Mark picked up | low | Same family. |
| POST | `/admin/orders/:id/fulfillments/:fulfillmentId/shiprocket-shipment` | Shiprocket-specific shipment | low | Covered by `create_order_shipment`. |
| GET | `/admin/orders/:id/fulfillments/:fulfillmentId/tracking` | Live carrier tracking | medium | Nice read; relies on external carrier. Next batch candidate. |
| GET | `/admin/orders/:id/partner-fee` | The commission owed on this order | medium | `get_partner_fees` covers at partner level. |
| GET | `/admin/orders/:id/partner-payouts` | Payouts against this order | medium | Money read; `get_partner_ledger` covers at partner level. |
| POST | `/admin/orders/:id/shiprocket-label` | Buy a shiprocket label | low | `create_order_shipping_label` covers it. |
| GET | `/admin/orders/:id/shiprocket-rates` | Shiprocket rates for the order | low | `list_order_shipping_rates` covers it. |

### 3.2 Designs

| Verb | Path | What it does | Value | Reason |
|---|---|---|---|---|
| GET | `/admin/designs/:id/consumption-logs` | A design's material/energy/labour consumption | medium | Run-level logs are covered; design-level is the analogous read. Next batch. |
| POST | `/admin/designs/:id/consumption-logs` | Log consumption against a design | medium | Write; partner surface has the tool. |
| POST | `/admin/designs/:id/consumption-logs/commit` | Commit logged consumption to stock | medium | Deducts stock; write. |
| PATCH | `/admin/designs/:id/consumption-logs/:logId` | Edit a consumption log | low | Niche. |
| DELETE | `/admin/designs/:id/consumption-logs/:logId` | Delete a consumption log | low | Niche. |
| POST | `/admin/designs/:id/tasks` | Create a design task | medium | `create_partner_task` exists; design-scoped variant. |
| DELETE | `/admin/designs/:id/tasks/:taskId` | Delete a design task | low | Rare. |
| GET | `/admin/designs/:id/used-in` | Which orders/products use this design | **high** | "Where is this design used?" is an ordinary question; not answered anywhere else. Next batch. |
| GET | `/admin/designs/:id/components` | Design components list | medium | Tech-pack read. |
| POST | `/admin/designs/:id/components` | Add a component | medium | Tech-pack write. |
| PATCH/DELETE | `/admin/designs/:id/components/:componentId` | Edit/remove a component | medium | Same family. |
| PATCH/DELETE | `/admin/designs/:id/construction-details/:detailId` | Edit/remove a construction detail | medium | `add_design_construction_detail` covers add only. |
| PATCH | `/admin/designs/:id/inventory` | Edit a design's BOM link | medium | `link_design_inventory` / `update_production_run` cover most. |
| POST | `/admin/designs/:id/inventory/delink` | Delink inventory from a design | medium | Write. |
| PATCH | `/admin/designs/:id/inventory/:inventoryLinkId` | Edit one BOM link | low | Niche. |
| GET | `/admin/designs/:id/brief` | Read the design brief | low | `update_design_brief` exists; read is a minor gap. |
| POST | `/admin/designs/:id/brief` | Create a brief | low | Same. |
| POST | `/admin/designs/:id/approve` | Approve the design (design-level) | medium | Approval happens via run review; design-level approve is a state write. |
| POST | `/admin/designs/:id/notify-customer` | Email the customer about the design | medium | Reach a customer; low risk. Next batch candidate. |
| GET/POST | `/admin/designs/:id/material-groups/:groupId` | Manage pinned material groups | medium | `link_design_material_group` covers the link; delete is a gap. |
| POST | `/admin/designs/:id/link-media-folder` / `DELETE` | Link a media folder to the design | low | Media plumbing. |
| POST | `/admin/designs/:id/moodboard/generate` | AI-generate a moodboard | low | AI internal; one-shot. |
| POST | `/admin/designs/:id/moodboard/seed` / `GET/POST moodboard/blocks` | Seed/edit moodboard blocks | low | Presentation. |
| POST | `/admin/designs/:id/outline` | Generate a design outline | low | AI helper. |
| GET | `/admin/designs/:id/pattern-blocks` | Read pattern blocks | low | Niche. |
| POST | `/admin/designs/:id/product-type` | Set the design's product type | low | `update_design` handles it. |
| POST | `/admin/designs/:id/recalculate-cost` | Recompute design cost from BOM | medium | Cost engine; write. |
| POST | `/admin/designs/:id/redesign` | Create a redesign revision | medium | Revision lifecycle; niche. |
| POST | `/admin/designs/:id/revise` | Revise the design | medium | Same. |
| DELETE | `/admin/designs/:id` | Delete a design | low | Destructive; rarely a good assistant action. |
| POST | `/admin/designs/:id/segment` / `:id/segment/depth` | Segment inference | low | AI tooling. |
| GET | `/admin/designs/:id/designer-invites` / POST / DELETE | Invite designers | low | Niche workflow. |
| POST | `/admin/designs/:id/inquiries` / GET / `:id/inquiries/:inquiryId/close` / `preview` | Design inquiries lifecycle | low | Sales-inquiry UI. |
| POST | `/admin/designs/auto` | Auto-create a design from an image | low | AI; one-shot. |
| POST | `/admin/designs/draft-order` | Create a draft order for a design | medium | Commissioning; write. Next batch candidate. |
| POST | `/admin/designs/orders/:lineItemId/convert` | Convert a design order line | medium | Order pipeline. |
| GET | `/admin/designs/orders` / `orders/:lineItemId` | List/read design orders | medium | `list_order_designs` covers the order side. |
| GET | `/admin/designs/:id/:path` / POST | Dynamic design sub-resource | low | Generic passthrough. |

### 3.3 Partners

| Verb | Path | What it does | Value | Reason |
|---|---|---|---|---|
| GET | `/admin/partners/:id/orders` | A partner's orders as they see them (#843 inspection mirror) | **high ✅** | "What has this partner sold?" — the mirror of the partner route, non-redundant with `list_orders`. |
| GET | `/admin/partners/:id/inventory-orders` | A partner's inventory orders as they see them | **high ✅** | "What goods is this partner supplying?" |
| GET | `/admin/partners/:id/inventory-items` | A partner's inventory as they see it | **high ✅** | "What does this partner hold?" |
| GET | `/admin/partners/:id/production-runs` | A partner's production runs as they see them | **high ✅** | "What is this partner on the hook for?" |
| GET | `/admin/partners/:id/storefront` | Storefront hosting status | **high ✅** | "Is their store live / why is it down?" |
| GET | `/admin/partners/:id/designs` | A partner's designs | medium | `list_designs?partner_id` covers it. |
| POST | `/admin/partners/:id/credits` | Record a credit the partner already holds | **high** | Money the partner holds; `apply_partner_credit` needs it to exist. Next batch. |
| GET/POST/DELETE | `/admin/partners/:id/storefront/domain` (+verify) | Manage the storefront domain | medium | Hosting ops; `disable_partner` detaches domains. |
| POST | `/admin/partners/:id/storefront/provision` / `redeploy` | Provision/redeploy the storefront | medium | Hosting ops; heavy side effects. |
| GET | `/admin/partners/:id/storefront/pages` | Storefront pages | low | Website builder surface. |
| GET | `/admin/partners/:id/storefront/website` | Storefront website settings | low | Same. |
| DELETE | `/admin/partners/:id/subscription` | Cancel a subscription | medium | `create_partner_subscription` covers the write; cancel is a gap. Next batch candidate. |
| POST | `/admin/partners/notifications/broadcast` | Broadcast to partners | low | Bulk messaging; risky, better via campaigns. |

### 3.4 Production runs

| Verb | Path | What it does | Value | Reason |
|---|---|---|---|---|
| GET | `/admin/production-runs/:id/payments` | Whether the run is already billed and by which payout (#1622) | **high ✅** | The double-pay guard's read; call before creating a payout. |
| POST | `/admin/production-runs/:id/activities/note` | Append a note to the run's timeline (WhatsApp logging) | **high ✅** | Low-risk write that keeps the ops timeline honest. |
| POST | `/admin/production-runs/:id/accept` | Accept the run | medium | Partner-facing; admin can force via other lifecycle tools. |
| POST | `/admin/production-runs/:id/start` | Start the run | medium | Lifecycle; currently admin reaches it through dispatch tools. |
| POST | `/admin/production-runs/:id/complete` | Complete the run | medium | Same. |
| POST | `/admin/production-runs/:id/finish` | Finish (report output) | medium | `update_production_run` corrects output. |
| POST | `/admin/production-runs/:id/assign-partner` | (Re)assign a partner | medium | `approve_production_run` assigns at approval. |
| POST | `/admin/production-runs/:id/attach-media` | Attach media to the run | low | Media plumbing. |
| POST | `/admin/production-runs/:id/consumption-logs/commit` | Commit consumption to stock | medium | Write; `log_run_consumption` + commit flow exists at route level only. |
| POST | `/admin/production-runs/:id/short-close` / DELETE | Short-close a run | medium | Money-affecting; niche. |
| GET/POST/DELETE | `/admin/production-runs/:id/transfers` (+ `:transferId/cancel`) | Transfer a run between partners | medium | Reassignment; niche. |

### 3.5 Inventory

| Verb | Path | What it does | Value | Reason |
|---|---|---|---|---|
| GET | `/admin/inventory-orders/:id` | One inventory order, with lines and unified work-status | **high ✅** | `list_inventory_orders` had no singular — an order id could be found but never opened. |
| GET | `/admin/inventory-orders/:id/charges` | Non-goods amounts + payable ceiling (#1737) | **high ✅** | "Why is the payable different from total?" — money read. |
| GET | `/admin/inventory-orders/:id/activities` | The order's timeline | **high ✅** | "What happened to this order?" |
| POST | `/admin/inventory-orders/:id/cancel` | Cancel an inventory order | medium | Write; destructive-ish. Next batch candidate. |
| GET | `/admin/inventory-orders/:id/fulfillment-rates` | Courier rates for the order | medium | `list_order_shipping_rates` is order-side. |
| GET | `/admin/inventory-orders/:id/payments` | Payments against the order | medium | `get_partner_ledger` covers at partner level. |
| GET | `/admin/inventory-orders/:id/feedbacks` / POST | Feedback on the order | low | Niche. |
| GET/POST/DELETE | `/admin/inventory-orders/:id/tasks` (+ `:taskId`) | Tasks on the order | medium | Partner tasks exist; order-scoped variant. |
| PUT | `/admin/inventory-orders/:id` | Update the order | medium | `update_inventory_order_lines` covers lines; header update is a gap. |
| DELETE | `/admin/inventory-orders/:id` | Delete the order | low | Destructive. |
| POST | `/admin/inventory-orders/:id/shipment` | Create a shipment for the order | medium | Write; partner side covers it. |
| GET | `/admin/inventory-items/:id/labels` | Labels for an item | low | Print/barcode. |
| DELETE | `/admin/inventory-items/:id/rawmaterials/:rawMaterialId` | Remove raw-material data | low | `update_inventory_raw_material` covers edits. |
| POST | `/admin/inventory-items/bulk-import` | Bulk import items | medium | `extract_inventory_from_image` is the AI path. |
| GET | `/admin/inventory-items/catalog` | Inventory catalog read | medium | `list_inventory_items` covers it. |
| GET/POST | `/admin/location-ownership` | Read/set which locations are core | medium | Data-Plumbing read; useful before consumption logging. Next batch candidate. |

### 3.6 Payments / money

| Verb | Path | What it does | Value | Reason |
|---|---|---|---|---|
| GET | `/admin/payments/:id` | One payment record | **high ✅** | The singular of the money read family. |
| POST | `/admin/payments` | Record an incoming payment | **high** | Money landing with no home today; next batch. |
| POST | `/admin/payments/:id` | Update a payment | medium | Sensitive write. |
| DELETE | `/admin/payments/:id` | Delete a payment | low | Destructive. |
| POST | `/admin/payments/:id/records-against` / DELETE | Link a payment against a payout | medium | `link_payment_to_payout` / `unlink` cover the settle. |
| POST | `/admin/payments/link` | Link a payment to a payout | low | `link_payment_to_payout` covers it. |
| GET/POST | `/admin/payments/partners/:id` / `:id/methods` / `persons/:id` / `methods` | Partner/person payment methods | medium | Money administration. Next batch candidate. |
| POST | `/admin/payment-submissions/:id/review` | Review a payout | medium | Money flow; next batch candidate. |
| PATCH | `/admin/payment-submissions/:id` | Update a payout | medium | Same. |
| DELETE | `/admin/payment-submissions/:id` | Delete a payout | low | Destructive. |
| PATCH | `/admin/payment-submissions/:id/items/:itemId` | Edit a payout line | low | Niche. |
| GET/POST/DELETE | `/admin/payment-submissions/:id/documents` | Payout documents | low | Attachments. |
| GET | `/admin/payment_reports` / `:id` / `summary` / `by-partner` / `by-person` | Payment reports | medium | Reporting surface; next batch candidate (summary read). |
| GET/POST/PATCH | `/admin/payment_reports/reconciliation` (+ `:id/settle`) | Reconciliation | medium | `list_payments` + ledger cover most reconciliation asks. |

### 3.7 CRM

| Verb | Path | What it does | Value | Reason |
|---|---|---|---|---|
| GET | `/admin/crm/companies/:id` | One CRM company | medium | `list_crm_companies` has no singular. Next batch candidate. |
| GET | `/admin/crm/opportunities/:id` | One deal | medium | Same. |
| GET | `/admin/crm/tasks/:id` | One follow-up task | medium | Same. |
| DELETE | `/admin/crm/people/:id` | Delete a contact | low | Destructive; GDPR-style rare ask. |
| POST/DELETE | `/admin/crm/activities/:id`, `/admin/crm/notes/:id`, `/admin/crm/companies/:id`, `/admin/crm/tasks/:id` | Single-record edits/deletes | low | `log_*` tools cover the writes the assistant should do. |
| POST | `/admin/crm/leads/:id/import` | Import a lead as a contact | medium | `create_crm_contact` + `list_ad_leads` cover the flow. |

### 3.8 Catalog

| Verb | Path | What it does | Value | Reason |
|---|---|---|---|---|
| GET | `/admin/products/:id/hang-tag` | Read a product's hang tag | low | Print artefact. |
| GET/PUT | `/admin/hang-tag-settings` | Hang-tag settings | low | Niche. |
| POST | `/admin/products/:id/linkDesign` / `unlinkDesign` | Link/unlink a design | medium | `list_design_products` is the read; link is a write gap. |
| POST | `/admin/products/:id/linkPerson` / `unlinkPerson` | Link/unlink a maker | medium | `link_partner_people` covers people links. |
| POST | `/admin/products/:id/generateDescription` | AI description | low | AI helper. |
| POST | `/admin/products/etsy-sync` (+confirm) | Etsy sync | low | Channel integration. |
| GET | `/admin/shipping-carriers` | Registered carriers | low | `list_fulfillment_providers` covers it. |
| GET | `/admin/regions/:id/partner-coverage` | Which partners sell in the region | medium | Storefront config. |
| POST | `/admin/regions/:id/share-to-all` | Share a region to all partners | medium | Write; niche. |
| GET/POST | `/admin/raw-material-groups/:id` / `:id/colors` / `:id/orders` | Group colours + orders | medium | `create_raw_material_group` + `link_design_material_group` cover the core. |
| GET | `/admin/abandoned-carts` / `:id` | Abandoned carts | medium | Recovery read; niche for assistant. |
| GET | `/admin/audience/composition` | Audience composition | low | Analytics. |
| GET/POST | `/admin/editor-files` | Editor files | low | Media. |

### 3.9 Marketing

| Verb | Path | What it does | Value | Reason |
|---|---|---|---|---|
| POST | `/admin/publishing-campaigns` / `:id/*` (start, pause, cancel, reschedule, retry, skip, preview) | Campaign lifecycle | medium | `list_publishing_campaigns` is the only read; the lifecycle writes are a gap. Next batch candidate. |
| GET/PUT/DELETE | `/admin/publishing-campaigns/:id` | Edit/delete a campaign | medium | Same. |
| GET | `/admin/publishing-campaigns/content-rules` | Content rules | low | Config. |
| POST | `/admin/social-posts/:id` | Update a post | medium | `create_social_post`/`publish_social_post` exist; update is a gap. |
| DELETE | `/admin/social-posts/:id` | Delete a post | low | Destructive. |
| POST | `/admin/social-posts/:id/sync-insights` / `sync-all-insights` | Pull insights | low | Analytics sync. |
| GET | `/admin/notifications/custom` / POST `/admin/notifications/:id/retry` | Custom notifications / retry | medium | Marketing broadcast. |
| GET/POST/DELETE | `/admin/marketing/outreach` | Outreach log | medium | Niche CRM-ish. Next batch candidate. |
| GET | `/admin/marketing/headline` / `ideas-log` / `snapshots` | Marketing ideas/snapshots | low | Presentation. |
| POST | `/admin/marketing/newsletter/generate` | AI newsletter | low | AI helper. |
| GET | `/admin/email-suppressions` | Suppressed emails | low | Compliance read; niche. |
| GET/POST | `/admin/exchange-rate` / `exchange-rates` | FX rates | low | FX fanout is automatic. |
| GET | `/admin/agreements` / `:id` (+mark-signed) | Agreements | medium | Legal docs; niche. Next batch candidate. |

### 3.10 Stats / ops

| Verb | Path | What it does | Value | Reason |
|---|---|---|---|---|
| GET | `/admin/stats/dashboards` / `:id` / PUT / DELETE / `duplicate` | Dashboard CRUD | medium | `create_stats_dashboard`/`create_stats_panel` exist; the rest of the lifecycle is a gap. |
| GET | `/admin/stats/operations` | Registered operations | medium | Useful before `create_stats_panel`. Next batch candidate. |
| GET | `/admin/stats/panels/:id` / PUT / DELETE / `preview` / `:id/data` | Panel CRUD + data | medium | Same. |
| GET/POST | `/admin/ops/maintenance-jobs/batches` (+ `:id`, `runs/:id`) | Job batches | medium | `list_maintenance_jobs`/`run_maintenance_job` cover the primary flow. |
| GET | `/admin/task-templates/:id` / PUT / DELETE / `categories` | Template lifecycle | medium | `list_task_templates`/`create_task_template` exist; update/delete are gaps. Next batch candidate. |
| GET | `/admin/energy-rates/:id` / POST / DELETE | Energy/labour rate lifecycle | medium | `list_energy_rates` is the read; writes are a gap. Next batch candidate. |
| GET/POST | `/admin/stock-locations/:id/carrier-pickups` / `shiprocket-pickup` | Carrier pickup scheduling | medium | Ops; niche. |
| POST | `/admin/stores` | Create a store | medium | `list_stores` exists; create is a gap. Next batch candidate. |

### 3.11 People directory / users / misc

| Verb | Path | What it does | Value | Reason |
|---|---|---|---|---|
| GET | `/admin/persons` / `:id` | The weaver/artisan directory | **high** | The people directory has NO tool at all beyond ID-card creation (`create_person_from_id_card`). Next batch. |
| POST | `/admin/persons` / `:id` | Create/update a person | high | Same. |
| GET/POST | `/admin/persons/:id/contacts` / `tags` / `types` / `addresses` / `resources` / `agreements` | Person record administration | medium | Weave-roster data; big family, next batch. |
| POST | `/admin/persons/import` (+confirm) | Bulk import people | medium | CSV import. |
| GET | `/admin/persons/partner` | Person↔partner links | medium | `list_partner_people` covers. |
| GET/POST | `/admin/persontypes` / `:id` | Person types | medium | `list_partner_person_types` covers the partner view. |
| GET/POST | `/admin/person-properties` | Census-linked properties | medium | Census tooling. |
| POST | `/admin/users/:id/suspend` / `unsuspend` | Suspend a user | medium | Ops; sensitive. Next batch candidate. |
| GET/POST/DELETE | `/admin/users/:id/whatsapp-link` / `users/identities` | User WhatsApp/identity links | low | Auth plumbing. |
| GET/POST | `/admin/feedbacks` / `:id` | Platform feedback | low | `create_partner_feedback` covers partner feedback. |
| GET/POST | `/admin/messaging` / `:conversationId/*` | WhatsApp inbox | medium | A read of "what did the partner say" is valuable but is a separate messaging surface. Next batch candidate. |
| GET | `/admin/messaging/whatsapp/senders` | WhatsApp senders | low | Same. |
| GET | `/admin/customs/export-igst-status` | IGST export status | low | Customs reporting. |
| GET/POST | `/admin/platform-tax-identities` (+export-luts) | Tax identities + LUT exports | medium | Customs/tax ops; niche. Next batch candidate. |

---

## 4. Deliberately not worth a tool (318 route+verb pairs)

A gap that should stay a gap is a finding. These families are **internal or
operator-only machinery an assistant should never call** — the reason is the same
shape for each: an assistant calling them is either an infinite loop (it IS the
client of its own plumbing), an impossible browser flow, a binary/media transfer,
or a surface whose UI is the product.

| Family | Count | Why not a tool |
|---|---|---|
| `/admin/ai/*`, `/admin/assistant/*` | 13 + 7 | The assistant's own platform: chat loopback, RAG, codegen, conversation store. The assistant does not drive itself. |
| `/admin/mcp/*` (server, scopes, oauth-tokens) | 8 | MCP server config + **scoped-credential / OAuth-token administration** — the very keys that gate the assistant. Never the assistant. |
| `/admin/oauth/*` + all `*oauth-init`/`oauth-callback`/`refresh-token` | ~7 | Browser-redirect handshakes an assistant cannot complete, and must not be given. |
| `/admin/image-proxy`, `/admin/images/proxy` | 2 | Binary image proxies for `<img>` tags. Not a question. |
| `/admin/google-merchant/*` | 21 | Channel-integration plumbing (OAuth, sync jobs, developer registration). |
| `/admin/meta-ads/*` (accounts/ads/adsets/campaigns/insights/lead-forms/overview/remote) + `/admin/ads/*` | 32 + 6 | Paid-ads API plumbing. `list_ad_leads` (the CRM intake) is the one tool an assistant needs and it exists. |
| `/admin/ad-planning/*` | 46 | Predictive-analytics experiments (attribution, forecasts, journeys, NPS). Not commerce operations. |
| `/admin/websites/*` | 31 | The partner website builder (pages, blocks, domains, SEO, console). A separate product surface. |
| `/admin/visual-flows/*` | 12 | The visual workflow builder (nodes, executions, waits). Flows are built in the builder UI. |
| `/admin/cap-tables/*`, `/admin/convertibles/*`, `/admin/funding-rounds/*`, `/admin/stakes/*`, `/admin/companies/*`, `/admin/investors`, `/admin/company-expenses` | 43 | Equity / corporate administration. A different audience than commerce operations. |
| `/admin/forms/*` | 9 | Form builder + responses + tour-bookings import. |
| `/admin/medias/*` | 32 | Multipart uploads (presign, parts, folders, albums, feature extraction). Files arrive as files, not as assistant calls. |
| `/admin/inbound-emails/*`, `/admin/emailkit/*`, `/admin/email-providers` | 11 | Webhook-driven inbound email and SMTP config — email arrives via webhook, not via an ask. |
| `/admin/socials/*` | 9 | The **legacy** social publishing surface, superseded by the `social-posts`/`social-platforms` tools. |
| `/admin/census/*`, `/admin/categories/rawmaterials`, `/admin/textile-analyses/*`, `/admin/analytics-events/*`, `/admin/analytics/live` | 17 | Data-exploration / diagnostics plumbing. |
| `/admin/deployment-accounts/*`, `/admin/desk/*`, `/admin/graph/*`, `/admin/custom` | 13 | Infra accounts, workspace layout, raw graph explorer, generic helper route. |

Two families are deliberately **withheld despite being real capabilities**, not
forgotten: `image-proxy`/`medias` are binary transfers the dispatcher would mangle,
and the OAuth/MCP-credential routes are the authentication surface the assistant's
own scope tokens come from — exposing them would let a prompt-injected ask mint its
own credentials.

---

## 5. Phase 2 — the 12 tools added (all HIGH, cap respected)

Added to `ADMIN_MCP_TOOLS`, following the exact registry conventions. All but one
are reads (the brief's rule: a read that unblocks a question beats a write nobody
asked for). 11 are GETs; one is a low-risk write.

| Tool | Route | Why high |
|---|---|---|
| `get_inventory_order` | `GET /admin/inventory-orders/:id` | The missing singular for the whole inventory-order family — you could list orders but never open one. |
| `get_inventory_order_charges` | `GET /admin/inventory-orders/:id/charges` | "Why is the payable different from total_price?" — charges move the payable ceiling (#1737). |
| `list_inventory_order_activities` | `GET /admin/inventory-orders/:id/activities` | "What happened to this order, and when?" |
| `get_order_balance` | `GET /admin/orders/:id/balance` | "Is this order fully paid? Can we collect the balance?" — the whole payment-schedule state in one read. |
| `get_production_run_payments` | `GET /admin/production-runs/:id/payments` | The double-pay guard's read (#1622) — check a run is unbilled BEFORE creating a payout. |
| `get_payment` | `GET /admin/payments/:id` | The singular of the money-read family. |
| `list_partner_orders` | `GET /admin/partners/:id/orders` | #843 inspection mirror — "what has this partner sold / are on the hook for". |
| `list_partner_inventory_orders` | `GET /admin/partners/:id/inventory-orders` | "What goods is this partner supplying?" |
| `list_partner_inventory_items` | `GET /admin/partners/:id/inventory-items` | "What does this partner hold?" |
| `list_partner_production_runs` | `GET /admin/partners/:id/production-runs` | "What is this partner on the hook for right now?" |
| `get_partner_storefront` | `GET /admin/partners/:id/storefront` | "Is their store live, and why not?" — reports `stale_project` without writing. |
| `add_production_run_activity_note` | `POST /admin/production-runs/:id/activities/note` | The one write: appends a WhatsApp-sourced note to a run's timeline. No money, no carrier, no third-party message — `sensitive` for confirm, unbound (validates in the handler). |

Every new tool classifies under an existing tool-slice prefix (no new
`PREFIX_DOMAINS` row needed), and the write is the only one with `bodyParams`, so it
is the only one touching the route-validator contract (see §6).

## 6. Verification

- **Jest** `--testPathPattern="(api/admin/mcp/lib|lib/mcp-core)"`
  - Before: **27 suites, 432 tests — 1 failed / 431 passed** (the pre-existing
    `route-validator-field-coverage` failure).
  - After: **27 suites, 432 tests — 1 failed / 431 passed**. Identical. The failing
    test is the same one, on the same three unbound tools:
    `admin:create_region`, `admin:update_region`, `admin:rename_product_option`.
    The new write tool is bound to the unbound list (`admin:add_production_run_activity_note`)
    so it does not add to the failure — before/after failure lists are visibly the
    same three entries.
- **Typecheck** (`tsc --noEmit -p tsconfig.json`): 84 errors, **all pre-existing**
  in unrelated files (admin UI `desk/*`, `messaging/*`, marketing-metrics route,
  etc.). Zero errors touch `registry.ts` or the mcp-core tests.
- The dispatch/tool-slice/tool-tiers suites stay green, so tool-name uniqueness,
  domain classification of every tool, and the exact `tier: "write"` allow-list are
  all preserved.

## 7. Next batch (high-value gaps still open, beyond the 12-tool cap)

1. `POST /admin/partners/:id/credits` — record a credit; `apply_partner_credit` needs one to exist.
2. `POST /admin/payments` — record an incoming payment.
3. `GET /admin/designs/:id/used-in` — "where is this design used?".
4. `GET /admin/crm/companies/:id`, `GET /admin/crm/opportunities/:id`, `GET /admin/crm/tasks/:id` — singular CRM reads.
5. `GET /admin/persons` + `GET /admin/persons/:id` — the weaver directory has no tools.
6. `GET /admin/orders/:id/fulfillments/:fulfillmentId/tracking` — live tracking.
7. `POST /admin/inventory-orders/:id/cancel` — cancel an inventory order.
8. `GET /admin/payment_reports/summary` — money roll-up.
9. `POST /admin/notifications/:id/retry` — retry a failed notification.
10. `GET /admin/location-ownership` — which stock locations are core (pre-consumption read).
11. `GET /admin/stats/operations` — before creating a stats panel.
12. `GET/POST/DELETE /admin/partners/:id/storefront/domain` — storefront domain management.
13. `POST /admin/users/:id/suspend` / `unsuspend` — user moderation.
14. `GET /admin/messaging/:conversationId` — read a WhatsApp conversation.
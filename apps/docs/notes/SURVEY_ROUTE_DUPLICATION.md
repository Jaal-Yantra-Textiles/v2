# Survey: Route Duplication — design / product / order domain

> Grounded behaviour document. Every claim cites a full repo-relative `path:symbol` / `path:line`
> (or a route like `POST /admin/...`) that was actually read or grepped. Verbs were taken from the
> exported handlers in each `route.ts`; workflows from each file's imports.
> Scope: HTTP route directories under `apps/backend/src/api` concerning **designs, design-orders,
> quotes-for-designs, and design-derived products**, across the `admin/`, `partners/` and `store/`
> surfaces. UI-usage claims were verified by grepping the admin UI (`apps/backend/src/admin`),
> the partner UI (`apps/partner-ui/src`), and the MCP registries
> (`apps/backend/src/api/admin/mcp/lib/registry.ts` and
> `apps/backend/src/api/partners/mcp/lib/registry.ts`).

## 1. Purpose

The JYT backend (Medusa 2.x) exposes three HTTP surfaces — `admin/`, `partners/`, `store/` — over a
shared set of design/quote/production modules. Many capabilities (design CRUD, cost estimation,
quote minting, design→product conversion, production-run creation) are reachable from more than
one surface, sometimes through the *same* workflow and sometimes through parallel workflows that
converge on the same end state. This doc inventories the routes, names the duplicated
capabilities, and flags orphan routes no UI or MCP tool invokes.

## 2. Entry points (route inventory)

### 2.1 admin/ — designs

| Route dir (under `apps/backend/src/api/admin/designs/`) | Verbs | Workflow(s) invoked |
|---|---|---|
| `route.ts` | GET, POST | `listDesignsWorkflow`, `createDesignWorkflow` (`apps/backend/src/api/admin/designs/route.ts:150-151`) |
| `[id]/route.ts` | GET, PUT, DELETE | `updateDesignWorkflow`, `deleteDesignWorkflow` (`apps/backend/src/api/admin/designs/[id]/route.ts:119-120`) |
| `auto/route.ts` | POST | `createDesignFromLLMWorkflow` (`apps/backend/src/api/admin/designs/auto/route.ts:54`) |
| `[id]/revise/route.ts` | POST | `reviseDesignWorkflow` (`apps/backend/src/api/admin/designs/[id]/revise/route.ts:2`) |
| `[id]/redesign/route.ts` | POST | (not read — verb from grep `apps/backend/src/api/admin/designs/[id]/redesign/route.ts:26`) |
| `[id]/revisions/route.ts` | GET | (read-only; verb from grep `apps/backend/src/api/admin/designs/[id]/revisions/route.ts:5`) |
| `[id]/recalculate-cost/route.ts` | POST | `estimateDesignCostWorkflow` (`apps/backend/src/api/admin/designs/[id]/recalculate-cost/route.ts:2`) |
| `[id]/approve/route.ts` | POST | `updateDesignWorkflow` + `createProductFromDesignWorkflow` (`apps/backend/src/api/admin/designs/[id]/approve/route.ts:7-8`) |
| `[id]/product-type/route.ts` | POST | `inferDesignProductTypeWorkflow` (`apps/backend/src/api/admin/designs/[id]/product-type/route.ts:3`) |
| `[id]/products/route.ts` | GET | none (query read; verb `apps/backend/src/api/admin/designs/[id]/products/route.ts:25`) |
| `[id]/[path]/route.ts` | GET, POST | none — stub catch-all returning canned `notes`/`test` messages (`apps/backend/src/api/admin/designs/[id]/[path]/route.ts:95-147`) |
| `[id]/brief/route.ts` | GET, POST, PUT | `updateDesignWorkflow` (`apps/backend/src/api/admin/designs/[id]/brief/route.ts:14`) |
| `[id]/moodboard/generate/route.ts` | POST | `updateDesignWorkflow`, `buildMoodboardScene`, `seedDesignMoodboardIfEmpty`, `buildTechPackInputFromDesign` (`apps/backend/src/api/admin/designs/[id]/moodboard/generate/route.ts:3-12`) |
| `[id]/moodboard/seed/route.ts` | POST | `seedDesignMoodboardIfEmpty` (`apps/backend/src/api/admin/designs/[id]/moodboard/seed/route.ts:2`) |
| `[id]/moodboard/blocks/route.ts` | GET, POST | `buildMoodboardScene`, `loadDesignForMoodboard`, `buildTechPackInputFromDesign` (`apps/backend/src/api/admin/designs/[id]/moodboard/blocks/route.ts:6-8`) |
| `[id]/segment/route.ts` | POST | (workflow not read; verb `apps/backend/src/api/admin/designs/[id]/segment/route.ts:18`) |
| `[id]/segment/depth/route.ts` | POST | (workflow not read; verb `apps/backend/src/api/admin/designs/[id]/segment/depth/route.ts:20`) |
| `[id]/outline/route.ts` | POST | (workflow not read; verb `apps/backend/src/api/admin/designs/[id]/outline/route.ts:24`) |
| `[id]/pattern-blocks/route.ts` | GET | `draft-pattern-block` (`apps/backend/src/api/admin/designs/[id]/pattern-blocks/route.ts:8`) |
| `[id]/components/route.ts` | GET, POST | (verbs `apps/backend/src/api/admin/designs/[id]/components/route.ts:10,28`) |
| `[id]/components/[componentId]/route.ts` | PATCH, DELETE | (verbs `apps/backend/src/api/admin/designs/[id]/components/[componentId]/route.ts:10,40`) |
| `[id]/construction-techniques/route.ts` | GET | (verb `apps/backend/src/api/admin/designs/[id]/construction-techniques/route.ts:14`) |
| `[id]/construction-details/route.ts` | GET, POST | (verbs `apps/backend/src/api/admin/designs/[id]/construction-details/route.ts:37,53`) |
| `[id]/construction-details/[detailId]/route.ts` | PATCH, DELETE | (verbs `apps/backend/src/api/admin/designs/[id]/construction-details/[detailId]/route.ts:11,64`) |
| `[id]/material-groups/route.ts` | GET, POST | (verbs `apps/backend/src/api/admin/designs/[id]/material-groups/route.ts:19,46`) |
| `[id]/material-groups/[groupId]/route.ts` | POST, DELETE | (verbs `apps/backend/src/api/admin/designs/[id]/material-groups/[groupId]/route.ts:14,39`) |
| `[id]/inventory/route.ts` | GET, POST, PATCH | `linkDesignInventoryWorkflow`, `updateDesignInventoryLinkWorkflow`, `listDesignInventoryWorkflow` (`apps/backend/src/api/admin/designs/[id]/inventory/route.ts:168-170`) |
| `[id]/inventory/delink/route.ts` | POST | `delinkDesignInventoryWorkflow` (`apps/backend/src/api/admin/designs/[id]/inventory/delink/route.ts:47`) |
| `[id]/inventory/[inventoryLinkId]/route.ts` | PATCH | `updateDesignInventoryLinkWorkflow` (`apps/backend/src/api/admin/designs/[id]/inventory/[inventoryLinkId]/route.ts:103`) |
| `[id]/partner/route.ts` | POST, DELETE | `linkDesignPartnerWorkflow` (`apps/backend/src/api/admin/designs/[id]/partner/route.ts:30`) |
| `[id]/cancel-partner-assignment/route.ts` | POST | `cancelPartnerAssignmentWorkflow` (`apps/backend/src/api/admin/designs/[id]/cancel-partner-assignment/route.ts:3`) |
| `[id]/tasks/route.ts` | GET, POST | `createTasksFromTemplatesWorkflow`, `getDesignTasksWorkflow` (`apps/backend/src/api/admin/designs/[id]/tasks/route.ts:104-105`) |
| `[id]/tasks/[taskId]/route.ts` | GET, POST, DELETE | `getDesignTaskWorkflow`, `updateDesignTaskWorkflow`, `deleteDesignTaskWorkflow` (`apps/backend/src/api/admin/designs/[id]/tasks/[taskId]/route.ts:68-70`) |
| `[id]/tasks/[taskId]/assign/route.ts` | POST | `createTaskAssignmentWorkflow`, `runTaskAssignmentWorkflow`, `setStepSuccessWorkflow` (`apps/backend/src/api/admin/designs/[id]/tasks/[taskId]/assign/route.ts:55-58`) |
| `[id]/consumption-logs/route.ts` | POST, GET | `logConsumptionWorkflow`, `listConsumptionLogsWorkflow` (`apps/backend/src/api/admin/designs/[id]/consumption-logs/route.ts:4-5`) |
| `[id]/consumption-logs/commit/route.ts` | POST | `commitConsumptionWorkflow` (`apps/backend/src/api/admin/designs/[id]/consumption-logs/commit/route.ts:4`) |
| `[id]/consumption-logs/[logId]/route.ts` | PATCH, DELETE | (verbs `apps/backend/src/api/admin/designs/[id]/consumption-logs/[logId]/route.ts:106,145`) |
| `[id]/used-in/route.ts` | GET | (verb `apps/backend/src/api/admin/designs/[id]/used-in/route.ts:9`) |
| `[id]/designer-invites/route.ts` | POST, GET | `sendDesignerInviteEmailWorkflow`, `seedDesignMoodboardIfEmpty` (`apps/backend/src/api/admin/designs/[id]/designer-invites/route.ts:5-6`) |
| `[id]/designer-invites/[inviteId]/route.ts` | DELETE | (verb `apps/backend/src/api/admin/designs/[id]/designer-invites/[inviteId]/route.ts:11`) |
| `[id]/inquiries/route.ts` | POST, GET | `createDesignInquiryWorkflow` (`apps/backend/src/api/admin/designs/[id]/inquiries/route.ts:4`) |
| `[id]/inquiries/preview/route.ts` | POST | `generate-questions` (`apps/backend/src/api/admin/designs/[id]/inquiries/preview/route.ts:10`) |
| `[id]/inquiries/[inquiryId]/close/route.ts` | POST | `closeDesignInquiryWorkflow` (`apps/backend/src/api/admin/designs/[id]/inquiries/[inquiryId]/close/route.ts:3`) |
| `[id]/notify-customer/route.ts` | POST | `sendDesignAssignedEmailWorkflow` (`apps/backend/src/api/admin/designs/[id]/notify-customer/route.ts:3`) |
| `[id]/link-media-folder/route.ts` | POST, DELETE | (verbs `apps/backend/src/api/admin/designs/[id]/link-media-folder/route.ts:11,49`) |
| `[id]/production-runs/route.ts` | POST | `createProductionRunWorkflow`, `approveProductionRunWorkflow` (`apps/backend/src/api/admin/designs/[id]/production-runs/route.ts:107-108`) |

### 2.2 admin/ — design-orders, work-orders, produce

| Route dir | Verbs | Workflow(s) invoked |
|---|---|---|
| `apps/backend/src/api/admin/designs/orders/route.ts` | GET | none — `query.graph` over link tables (`apps/backend/src/api/admin/designs/orders/route.ts:31-60`) |
| `apps/backend/src/api/admin/designs/orders/[lineItemId]/route.ts` | GET | (verb `apps/backend/src/api/admin/designs/orders/[lineItemId]/route.ts:15`) |
| `apps/backend/src/api/admin/designs/orders/[lineItemId]/convert/route.ts` | POST | `convertDesignOrderToOrder` (`apps/backend/src/api/admin/designs/orders/[lineItemId]/convert/route.ts:6`) |
| `apps/backend/src/api/admin/designs/draft-order/route.ts` | POST | `createDesignDraftOrder` → `createDraftOrderFromDesignsWorkflow` (`apps/backend/src/api/admin/designs/draft-order/route.ts:22`, lib at `apps/backend/src/api/admin/designs/draft-order/lib.ts:67`) |
| `apps/backend/src/api/admin/designs/draft-order/preview/route.ts` | POST | re-exports the customer preview handler verbatim (`apps/backend/src/api/admin/designs/draft-order/preview/route.ts:9`) |
| `apps/backend/src/api/admin/customers/[id]/design-order/route.ts` | POST | `createDesignDraftOrder` (`apps/backend/src/api/admin/customers/[id]/design-order/route.ts:23`) |
| `apps/backend/src/api/admin/customers/[id]/design-order/preview/route.ts` | POST | (referenced by the re-export above; not read directly) |
| `apps/backend/src/api/admin/customers/[id]/designs/route.ts` | POST, DELETE | none — `remoteLink.create`/`dismiss` of design↔customer links (`apps/backend/src/api/admin/customers/[id]/designs/route.ts:23,42`) |
| `apps/backend/src/api/admin/customers/[id]/designs/ordered/route.ts` | GET | (verb `apps/backend/src/api/admin/customers/[id]/designs/ordered/route.ts:15`) |
| `apps/backend/src/api/admin/design-work-orders/route.ts` | GET | none — `query.graph` over the `PARTNER_WORK_ORDERS_CHANNEL` sales channel (`apps/backend/src/api/admin/design-work-orders/route.ts:50-80`) |
| `apps/backend/src/api/admin/orders/[id]/design/route.ts` | GET | none — `query.graph` over `designOrderLink` (`apps/backend/src/api/admin/orders/[id]/design/route.ts:15-33`) |
| `apps/backend/src/api/admin/orders/[id]/design/produce/route.ts` | POST | `createRunsForDesignOrder` (`apps/backend/src/api/admin/orders/[id]/design/produce/route.ts:6`) |
| `apps/backend/src/api/admin/designs/produce/route.ts` | POST | `produceDesignsAsWorkOrder` (`apps/backend/src/api/admin/designs/produce/route.ts:6`) |
| `apps/backend/src/api/admin/designs/recreate-production-run/route.ts` | POST | `recreateProductionRunWorkflow` (`apps/backend/src/api/admin/designs/recreate-production-run/route.ts:4`) |

### 2.3 admin/ — quotes-for-designs & design-derived products

| Route dir | Verbs | Workflow(s) invoked |
|---|---|---|
| `apps/backend/src/api/admin/quotes/route.ts` | GET, POST | GET: `listAndCountPartnerQuotes` via shared `buildQuoteListQuery`; POST: `mintQuoteWorkflow` (`apps/backend/src/api/admin/quotes/route.ts:50,172`) |
| `apps/backend/src/api/admin/quotes/[id]/route.ts` | GET | `withEffectiveStatus`, `loadScheduleForQuote` (`apps/backend/src/api/admin/quotes/[id]/route.ts:5-6`) |
| `apps/backend/src/api/admin/quotes/[id]/revoke/route.ts` | POST | `revokeQuote` (`apps/backend/src/api/admin/quotes/[id]/revoke/route.ts:5`) |
| `apps/backend/src/api/admin/quotes/[id]/adjust/route.ts` | POST | `adjustQuote` (`apps/backend/src/api/admin/quotes/[id]/adjust/route.ts:5`) |
| `apps/backend/src/api/admin/quotes/readiness/route.ts` | POST | `assessQuoteReadiness` + `resolveDesignLinesForReadiness` + `makeDesignVariantPort` (`apps/backend/src/api/admin/quotes/readiness/route.ts:5-9`) |
| `apps/backend/src/api/admin/quotes/drafts/route.ts` | POST | `service.createPartnerQuotes` (status `draft`, `token_hash: null`) (`apps/backend/src/api/admin/quotes/drafts/route.ts:52-74`) |
| `apps/backend/src/api/admin/quotes/drafts/[id]/route.ts` | GET, PATCH, DELETE | (verbs `apps/backend/src/api/admin/quotes/drafts/[id]/route.ts:147,161,222`) |
| `apps/backend/src/api/admin/quotes/drafts/[id]/mint/route.ts` | POST | delegates to the `POST` handler of `apps/backend/src/api/admin/quotes/route.ts` (`apps/backend/src/api/admin/quotes/drafts/[id]/mint/route.ts:5,139`) |
| `apps/backend/src/api/admin/quotes/designs/route.ts` | GET | `annotateQuotableDesigns` (`apps/backend/src/api/admin/quotes/designs/route.ts:4`) |
| `apps/backend/src/api/admin/quotes/designs/[designId]/variant/route.ts` | POST | `ensureDesignQuoteVariantWorkflow` (`apps/backend/src/api/admin/quotes/designs/[designId]/variant/route.ts:3`) |
| `apps/backend/src/api/admin/production-runs/approvals/route.ts` | POST | `applyRunApprovals` (`apps/backend/src/api/admin/production-runs/approvals/route.ts:6`) |

### 2.4 partners/ — designs & quotes

| Route dir (under `apps/backend/src/api/partners/`) | Verbs | Workflow(s) invoked |
|---|---|---|
| `designs/route.ts` | GET, POST | GET: `listPartnerDesignsWorkflow`; POST: `createDesignWorkflow` + `linkDesignPartnerWorkflow` (`apps/backend/src/api/partners/designs/route.ts:110-112`) |
| `designs/[designId]/route.ts` | GET, PUT, DELETE | `listSingleDesignsWorkflow`, `updateDesignWorkflow`, `deleteDesignWorkflow` (`apps/backend/src/api/partners/designs/[designId]/route.ts:124-127`) |
| `designs/[designId]/recalculate-cost/route.ts` | POST | `estimateDesignCostWorkflow` (`apps/backend/src/api/partners/designs/[designId]/recalculate-cost/route.ts:16`) |
| `designs/[designId]/cost/route.ts` | GET | (verb `apps/backend/src/api/partners/designs/[designId]/cost/route.ts:12`) |
| `designs/[designId]/revise/route.ts` | POST | `reviseDesignWorkflow` (`apps/backend/src/api/partners/designs/[designId]/revise/route.ts:21`) |
| `designs/[designId]/revisions/route.ts` | GET | (verb `apps/backend/src/api/partners/designs/[designId]/revisions/route.ts:37`) |
| `designs/[designId]/brief/route.ts` | GET, POST, PUT | `updateDesignWorkflow` (`apps/backend/src/api/partners/designs/[designId]/brief/route.ts:21`) |
| `designs/[designId]/moodboard/route.ts` | PUT | `updateDesignWorkflow` (`apps/backend/src/api/partners/designs/[designId]/moodboard/route.ts:17`) |
| `designs/[designId]/moodboard/seed/route.ts` | POST | `seedDesignMoodboardIfEmpty` (`apps/backend/src/api/partners/designs/[designId]/moodboard/seed/route.ts:2`) |
| `designs/[designId]/moodboard/generate/route.ts` | POST | `updateDesignWorkflow` + `seedDesignMoodboardIfEmpty` (`apps/backend/src/api/partners/designs/[designId]/moodboard/generate/route.ts:3,7`) |
| `designs/[designId]/moodboard/blocks/route.ts` | GET, POST | `buildMoodboardScene`, `loadDesignForMoodboard`, `buildTechPackInputFromDesign` (`apps/backend/src/api/partners/designs/[designId]/moodboard/blocks/route.ts:6-8`) |
| `designs/[designId]/media/route.ts` | POST | (verb `apps/backend/src/api/partners/designs/[designId]/media/route.ts:76`) |
| `designs/[designId]/media/attach/route.ts` | POST | `updateDesignWorkflow`, `listSingleDesignsWorkflow` (`apps/backend/src/api/partners/designs/[designId]/media/attach/route.ts:110-111`) |
| `designs/[designId]/inventory/route.ts` | GET, POST | `linkDesignInventoryWorkflow`, `listDesignInventoryWorkflow` (`apps/backend/src/api/partners/designs/[designId]/inventory/route.ts:17-18`) |
| `designs/[designId]/inventory/delink/route.ts` | DELETE | `delinkDesignInventoryWorkflow` (`apps/backend/src/api/partners/designs/[designId]/inventory/delink/route.ts:8`) |
| `designs/[designId]/inventory/[inventoryLinkId]/route.ts` | PATCH | `updateDesignInventoryLinkWorkflow` (`apps/backend/src/api/partners/designs/[designId]/inventory/[inventoryLinkId]/route.ts:10`) |
| `designs/[designId]/consumption-logs/route.ts` | POST, GET | `logConsumptionWorkflow`, `listConsumptionLogsWorkflow` (`apps/backend/src/api/partners/designs/[designId]/consumption-logs/route.ts:3-4`) |
| `designs/[designId]/construction-techniques/route.ts` | GET | (verb `apps/backend/src/api/partners/designs/[designId]/construction-techniques/route.ts:17`) |
| `designs/[designId]/construction-details/route.ts` | GET, POST | (verbs `apps/backend/src/api/partners/designs/[designId]/construction-details/route.ts:29,44`) |
| `designs/[designId]/construction-details/[detailId]/route.ts` | DELETE | (verb `apps/backend/src/api/partners/designs/[designId]/construction-details/[detailId]/route.ts:14`) |
| `designs/[designId]/components/route.ts` | GET | (verb `apps/backend/src/api/partners/designs/[designId]/components/route.ts:26`) |
| `designs/[designId]/used-in/route.ts` | GET | (verb `apps/backend/src/api/partners/designs/[designId]/used-in/route.ts:27`) |
| `designs/[designId]/tasks/route.ts` | GET, POST | `createTasksFromTemplatesWorkflow` (`apps/backend/src/api/partners/designs/[designId]/tasks/route.ts:24`) |
| `designs/[designId]/segment/route.ts` | POST | (verb `apps/backend/src/api/partners/designs/[designId]/segment/route.ts:36`) |
| `designs/[designId]/segment/depth/route.ts` | POST | (verb `apps/backend/src/api/partners/designs/[designId]/segment/depth/route.ts:37`) |
| `designs/[designId]/production-runs/route.ts` | POST | `createProductionRunWorkflow` + `linkDesignPartnerWorkflow` (`apps/backend/src/api/partners/designs/[designId]/production-runs/route.ts:20-21`) |
| `quotes/route.ts` | GET, POST | GET: `listAndCountPartnerQuotes` via `buildQuoteListQuery`; POST: `mintQuoteWorkflow` (`apps/backend/src/api/partners/quotes/route.ts:47,128`) |
| `quotes/[id]/route.ts` | GET | `withEffectiveStatus`, `loadScheduleForQuote` (`apps/backend/src/api/partners/quotes/[id]/route.ts:5-6`) |
| `quotes/[id]/revoke/route.ts` | POST | `revokeQuote` (`apps/backend/src/api/partners/quotes/[id]/revoke/route.ts:5`) |
| `quotes/[id]/adjust/route.ts` | POST | `adjustQuote` (`apps/backend/src/api/partners/quotes/[id]/adjust/route.ts:5`) |
| `quotes/readiness/route.ts` | POST | `assessQuoteReadiness` + `resolveDesignLinesForReadiness` + `makeDesignVariantPort` (`apps/backend/src/api/partners/quotes/readiness/route.ts:7-12`) |
| `quotes/designs/route.ts` | GET | `listPartnerDesignsWorkflow` + `annotateQuotableDesigns` (`apps/backend/src/api/partners/quotes/designs/route.ts:6-7`) |
| `quotes/designs/[designId]/variant/route.ts` | POST | `ensureDesignQuoteVariantWorkflow` (`apps/backend/src/api/partners/quotes/designs/[designId]/variant/route.ts:6`) |

### 2.5 store/ — customer designs, design assistant, buyer quotes

| Route dir | Verbs | Workflow(s) invoked |
|---|---|---|
| `apps/backend/src/api/store/custom/designs/route.ts` | GET, POST | POST: `createDesignWorkflow` + `linkDesignInventoryWorkflow` + `linkDesignPartnerWorkflow` (`apps/backend/src/api/store/custom/designs/route.ts:284-286`) |
| `apps/backend/src/api/store/custom/designs/[id]/route.ts` | GET, PUT | `updateDesignWorkflow` + `linkDesignInventoryWorkflow` + `linkDesignPartnerWorkflow` (`apps/backend/src/api/store/custom/designs/[id]/route.ts:6-8`) |
| `apps/backend/src/api/store/custom/designs/[id]/estimate/route.ts` | GET | `estimateDesignCostWorkflow` (`apps/backend/src/api/store/custom/designs/[id]/estimate/route.ts:6`) |
| `apps/backend/src/api/store/custom/designs/[id]/checkout/route.ts` | POST | `estimateDesignCostWorkflow` + `cartService.addLineItems` (`apps/backend/src/api/store/custom/designs/[id]/checkout/route.ts:6,124`) |
| `apps/backend/src/api/store/custom/designs/[id]/production-story/route.ts` | GET | (verb `apps/backend/src/api/store/custom/designs/[id]/production-story/route.ts:19`) |
| `apps/backend/src/api/store/custom/design-assistant/conversations/route.ts` | GET, POST | `STOREFRONT_DESIGN_ASSISTANT_MODULE` (`apps/backend/src/api/store/custom/design-assistant/conversations/route.ts:21`) |
| `apps/backend/src/api/store/custom/design-assistant/conversations/[id]/route.ts` | GET, PATCH, DELETE | `STOREFRONT_DESIGN_ASSISTANT_MODULE` (`apps/backend/src/api/store/custom/design-assistant/conversations/[id]/route.ts:16`) |
| `apps/backend/src/api/store/custom/design-assistant/pick/route.ts` | POST | (workflow not read; verb `apps/backend/src/api/store/custom/design-assistant/pick/route.ts:23`) |
| `apps/backend/src/api/store/custom/design-assistant/references/route.ts` | POST | `createDesignWorkflow` + `DESIGN_MODULE` + `canvas-scene` (`apps/backend/src/api/store/custom/design-assistant/references/route.ts:52-62`) |
| `apps/backend/src/api/store/custom/design-assistant/references/analyze/route.ts` | POST | (verb `apps/backend/src/api/store/custom/design-assistant/references/analyze/route.ts:30`) |
| `apps/backend/src/api/store/custom/design-assistant/designs/[id]/route.ts` | GET | `DESIGN_MODULE` (`apps/backend/src/api/store/custom/design-assistant/designs/[id]/route.ts:43`) |
| `apps/backend/src/api/store/b2b/quotes/[token]/route.ts` | GET | `buildQuoteView`, `composeQuoteAcceptance`, `effectiveQuoteLines`, `resolveQuoteParties`, `assertQuoteVisibleToCaller`, `hashQuoteToken` (`apps/backend/src/api/store/b2b/quotes/[token]/route.ts:4-10`) |
| `apps/backend/src/api/store/b2b/quotes/[token]/accept/route.ts` | POST | `acceptQuoteWorkflow` (`apps/backend/src/api/store/b2b/quotes/[token]/accept/route.ts:7`) |
| `apps/backend/src/api/store/custom/raw-materials/route.ts` | GET | none — browse materials for customization (`apps/backend/src/api/store/custom/raw-materials/route.ts:1-5`) |

## 3. Data models & links

Only the links observed in the read routes (this survey is route-focused; models were not opened):

- `designCustomerLink` — design↔customer pivot, queried directly by
  `apps/backend/src/api/admin/designs/route.ts:227`, `apps/backend/src/api/store/custom/designs/route.ts:515`,
  `apps/backend/src/api/admin/designs/orders/route.ts:52`.
- `designLineItemLink` — design↔cart line item pivot, queried by
  `apps/backend/src/api/admin/designs/orders/route.ts:31` and used for the duplicate-cart guard in
  `apps/backend/src/api/admin/designs/draft-order/lib.ts:47`.
- `designOrderLink` — design↔order pivot, queried by `apps/backend/src/api/admin/designs/orders/route.ts:57`
  and `apps/backend/src/api/admin/orders/[id]/design/route.ts:15`.
- `design_partners_link` — named in the docblock of `apps/backend/src/api/partners/designs/route.ts:157`
  (written by `linkDesignPartnerWorkflow`); file itself not read (unverified beyond the comment).
- Design↔line-item link written directly via `remoteLink.create` in
  `apps/backend/src/api/store/custom/designs/[id]/checkout/route.ts:151-155`.

## 4. Key behaviours — duplicate capability

### 4.1 Same workflow invoked from two or more routes

| # | Shared workflow / lib | Routes invoking it | More complete implementation |
|---|---|---|---|
| 1 | `createDesignWorkflow` (`apps/backend/src/workflows/designs/create-design`) | `POST /admin/designs` (`apps/backend/src/api/admin/designs/route.ts:168`); `POST /partners/designs` (`apps/backend/src/api/partners/designs/route.ts:181`); `POST /store/custom/designs` (`apps/backend/src/api/store/custom/designs/route.ts:394`); `POST /store/custom/design-assistant/references` (`apps/backend/src/api/store/custom/design-assistant/references/route.ts:62`) | `POST /store/custom/designs` — create + inventory link + partner link + customer link in one call (`apps/backend/src/api/store/custom/designs/route.ts:377-455`); the admin route is the plainest (create + refetch only, `apps/backend/src/api/admin/designs/route.ts:168-193`) |
| 2 | `estimateDesignCostWorkflow` (`apps/backend/src/workflows/designs/estimate-design-cost`) | `POST /admin/designs/:id/recalculate-cost` (`apps/backend/src/api/admin/designs/[id]/recalculate-cost/route.ts:2`); `POST /partners/designs/:designId/recalculate-cost` (`apps/backend/src/api/partners/designs/[designId]/recalculate-cost/route.ts:16`); `GET /store/custom/designs/:id/estimate` (`apps/backend/src/api/store/custom/designs/[id]/estimate/route.ts:60`); `POST /store/custom/designs/:id/checkout` (`apps/backend/src/api/store/custom/designs/[id]/checkout/route.ts:71`) | The two recalculate-cost routes persist the estimate; the store estimate route only reads it with currency conversion (`apps/backend/src/api/store/custom/designs/[id]/estimate/route.ts:85-93`). Checkout is the most complete consumer (estimate → currency convert → cart line, `apps/backend/src/api/store/custom/designs/[id]/checkout/route.ts:119-143`) |
| 3 | `mintQuoteWorkflow` (`apps/backend/src/workflows/partner-quote/mint-quote`) | `POST /admin/quotes` (`apps/backend/src/api/admin/quotes/route.ts:172`); `POST /partners/quotes` (`apps/backend/src/api/partners/quotes/route.ts:128`); `POST /admin/quotes/drafts/:id/mint` — which literally imports and calls the `POST` handler of `apps/backend/src/api/admin/quotes/route.ts` (`apps/backend/src/api/admin/quotes/drafts/[id]/mint/route.ts:5,139`) | `POST /admin/quotes` is the canonical handler; its own docblock forbids a second implementation (`apps/backend/src/api/admin/quotes/route.ts:25-29`). The partner route is the scoped twin; the drafts-mint route is a deliberate proxy ("One mint, reached two ways", `apps/backend/src/api/admin/quotes/drafts/[id]/mint/route.ts:22`) |
| 4 | `updateDesignWorkflow` | `PUT /admin/designs/:id` (`apps/backend/src/api/admin/designs/[id]/route.ts:119`); `PUT /partners/designs/:designId` (`apps/backend/src/api/partners/designs/[designId]/route.ts:126`); admin+partner `brief` PUT (`apps/backend/src/api/admin/designs/[id]/brief/route.ts:14`, `apps/backend/src/api/partners/designs/[designId]/brief/route.ts:21`); partner `moodboard` PUT and `media/attach` (`apps/backend/src/api/partners/designs/[designId]/moodboard/route.ts:17`, `apps/backend/src/api/partners/designs/[designId]/media/attach/route.ts:110`); `PUT /store/custom/designs/:id` (`apps/backend/src/api/store/custom/designs/[id]/route.ts:135`); admin `approve` (`apps/backend/src/api/admin/designs/[id]/approve/route.ts:62`) | `PUT /admin/designs/:id` is the general field update; each other route is a scoped facet (brief/moodboard/media/status) |
| 5 | `deleteDesignWorkflow` | `DELETE /admin/designs/:id` (`apps/backend/src/api/admin/designs/[id]/route.ts:120`); `DELETE /partners/designs/:designId` (`apps/backend/src/api/partners/designs/[designId]/route.ts:127`) | Parity — admin is unscoped, partner is ownership-scoped |
| 6 | `reviseDesignWorkflow` (`apps/backend/src/workflows/designs/revise-design`) | `POST /admin/designs/:id/revise` (`apps/backend/src/api/admin/designs/[id]/revise/route.ts:2`); `POST /partners/designs/:designId/revise` (`apps/backend/src/api/partners/designs/[designId]/revise/route.ts:21`) | Parity (admin unscoped / partner scoped) |
| 7 | `linkDesignInventoryWorkflow`, `updateDesignInventoryLinkWorkflow`, `delinkDesignInventoryWorkflow`, `listDesignInventoryWorkflow` (`apps/backend/src/workflows/designs/inventory/link-inventory`) | admin `inventory`, `inventory/delink`, `inventory/[inventoryLinkId]` (`apps/backend/src/api/admin/designs/[id]/inventory/route.ts:168-170`, `apps/backend/src/api/admin/designs/[id]/inventory/delink/route.ts:47`, `apps/backend/src/api/admin/designs/[id]/inventory/[inventoryLinkId]/route.ts:103`); the three partner twins (`apps/backend/src/api/partners/designs/[designId]/inventory/route.ts:17-18`, `.../delink/route.ts:8`, `.../[inventoryLinkId]/route.ts:10`); store create/update (`apps/backend/src/api/store/custom/designs/route.ts:285`, `apps/backend/src/api/store/custom/designs/[id]/route.ts:7`) | Admin surface is the most complete (link + update + delink + list); note the delink verb differs: POST on admin (`apps/backend/src/api/admin/designs/[id]/inventory/delink/route.ts:50`) vs DELETE on partner (`apps/backend/src/api/partners/designs/[designId]/inventory/delink/route.ts:13`) |
| 8 | `linkDesignPartnerWorkflow` | `POST /admin/designs/:id/partner` (`apps/backend/src/api/admin/designs/[id]/partner/route.ts:30`); `POST /partners/designs` (`apps/backend/src/api/partners/designs/route.ts:112`); `POST /partners/designs/:designId/production-runs` (`apps/backend/src/api/partners/designs/[designId]/production-runs/route.ts:21`); store create + update (`apps/backend/src/api/store/custom/designs/route.ts:286`, `apps/backend/src/api/store/custom/designs/[id]/route.ts:8`) | All are thin wrappers over the same idempotent link workflow |
| 9 | `logConsumptionWorkflow` + `listConsumptionLogsWorkflow` (`apps/backend/src/workflows/consumption-logs/`) | `POST/GET /admin/designs/:id/consumption-logs` (`apps/backend/src/api/admin/designs/[id]/consumption-logs/route.ts:4-5`); `POST/GET /partners/designs/:designId/consumption-logs` (`apps/backend/src/api/partners/designs/[designId]/consumption-logs/route.ts:3-4`) | Parity; the admin surface additionally exposes `[logId]` PATCH/DELETE and `commit` (`apps/backend/src/api/admin/designs/[id]/consumption-logs/commit/route.ts:4`) which the partner surface lacks |
| 10 | `seedDesignMoodboardIfEmpty`, `buildMoodboardScene`, `buildTechPackInputFromDesign` (`apps/backend/src/workflows/designs/moodboard/`) | admin `moodboard/seed`, `moodboard/blocks`, `moodboard/generate` (`apps/backend/src/api/admin/designs/[id]/moodboard/seed/route.ts:2`, `.../blocks/route.ts:6-8`, `.../generate/route.ts:3-12`); partner twins (`apps/backend/src/api/partners/designs/[designId]/moodboard/seed/route.ts:2`, `.../blocks/route.ts:6-8`, `.../generate/route.ts:3,7`) | Parity — the partner surface adds a `PUT moodboard` save route the admin surface lacks (`apps/backend/src/api/partners/designs/[designId]/moodboard/route.ts:28`) |
| 11 | `createProductionRunWorkflow` (`apps/backend/src/workflows/production-runs/create-production-run`) | `POST /admin/designs/:id/production-runs` (`apps/backend/src/api/admin/designs/[id]/production-runs/route.ts:107`); `POST /partners/designs/:designId/production-runs` (`apps/backend/src/api/partners/designs/[designId]/production-runs/route.ts:20`) | Admin route additionally runs `approveProductionRunWorkflow` (`apps/backend/src/api/admin/designs/[id]/production-runs/route.ts:108`); the partner route additionally links the partner (`...:21`) |
| 12 | `createTasksFromTemplatesWorkflow` | `POST /admin/designs/:id/tasks` (`apps/backend/src/api/admin/designs/[id]/tasks/route.ts:104`); `POST /partners/designs/:designId/tasks` (`apps/backend/src/api/partners/designs/[designId]/tasks/route.ts:24`) | Admin surface also has `[taskId]` GET/POST/DELETE and `assign` (`apps/backend/src/api/admin/designs/[id]/tasks/[taskId]/route.ts:68-70`, `.../assign/route.ts:55-58`) |
| 13 | `ensureDesignQuoteVariantWorkflow` (`apps/backend/src/workflows/partner-quote/ensure-design-quote-variant`) | `POST /admin/quotes/designs/:designId/variant` (`apps/backend/src/api/admin/quotes/designs/[designId]/variant/route.ts:29`); `POST /partners/quotes/designs/:designId/variant` (`apps/backend/src/api/partners/quotes/designs/[designId]/variant/route.ts:53`) | Parity — the only difference is `partner_id: null` vs `partner.id` scoping (`apps/backend/src/api/admin/quotes/designs/[designId]/variant/route.ts:34` vs `apps/backend/src/api/partners/quotes/designs/[designId]/variant/route.ts:59`) |
| 14 | `assessQuoteReadiness` + `resolveDesignLinesForReadiness` + `makeDesignVariantPort` (`apps/backend/src/modules/partner-quote/lib/quote-readiness`, `.../design-lines`) | `POST /admin/quotes/readiness` (`apps/backend/src/api/admin/quotes/readiness/route.ts:75-108`); `POST /partners/quotes/readiness` (`apps/backend/src/api/partners/quotes/readiness/route.ts:40-73`) | Parity — "Same assessor, one extra input" (`apps/backend/src/api/admin/quotes/readiness/route.ts:14-16`) |
| 15 | `adjustQuote` (`apps/backend/src/modules/partner-quote/lib/adjust-quote`) | `POST /admin/quotes/:id/adjust` (`apps/backend/src/api/admin/quotes/[id]/adjust/route.ts:30`); `POST /partners/quotes/:id/adjust` (`apps/backend/src/api/partners/quotes/[id]/adjust/route.ts:47`) | Parity — "the refusals themselves live in `adjustQuote` so the two cannot drift" (`apps/backend/src/api/admin/quotes/[id]/adjust/route.ts:13-14`) |
| 16 | `revokeQuote` (`apps/backend/src/modules/partner-quote/lib/revoke-quote`) | `POST /admin/quotes/:id/revoke` (`apps/backend/src/api/admin/quotes/[id]/revoke/route.ts:28`); `POST /partners/quotes/:id/revoke` (`apps/backend/src/api/partners/quotes/[id]/revoke/route.ts:74`) | Parity |
| 17 | `buildQuoteListQuery` + `listAndCountPartnerQuotes` + `withEffectiveStatus` | `GET /admin/quotes` (`apps/backend/src/api/admin/quotes/route.ts:48-60`); `GET /partners/quotes` (`apps/backend/src/api/partners/quotes/route.ts:41-57`) | Parity — "Paging, search and sort semantics are shared with `/partners/quotes` via `buildQuoteListQuery` so the two surfaces cannot drift" (`apps/backend/src/api/admin/quotes/route.ts:38-40`) |
| 18 | `annotateQuotableDesigns` (`apps/backend/src/modules/partner-quote/lib/quotable-designs`) | `GET /admin/quotes/designs` (`apps/backend/src/api/admin/quotes/designs/route.ts:38`); `GET /partners/quotes/designs` (`apps/backend/src/api/partners/quotes/designs/route.ts:54`) | Partner route reuses `listPartnerDesignsWorkflow` for scoping (`apps/backend/src/api/partners/quotes/designs/route.ts:44`); admin route queries `design` unscoped (`apps/backend/src/api/admin/quotes/designs/route.ts:31`) |
| 19 | `createDesignDraftOrder` (shared lib) → `createDraftOrderFromDesignsWorkflow` | `POST /admin/designs/draft-order` (`apps/backend/src/api/admin/designs/draft-order/route.ts:22`); `POST /admin/customers/:id/design-order` (`apps/backend/src/api/admin/customers/[id]/design-order/route.ts:23`); `POST /admin/designs/draft-order/preview` re-exports the customer preview handler (`apps/backend/src/api/admin/designs/draft-order/preview/route.ts:9`) | One function, two ways in — "both go through the same function so they cannot drift" (`apps/backend/src/api/admin/designs/draft-order/route.ts:12-13`) |
| 20 | `listPartnerDesignsWorkflow` | `GET /partners/designs` (`apps/backend/src/api/partners/designs/route.ts:134`); `GET /partners/quotes/designs` (`apps/backend/src/api/partners/quotes/designs/route.ts:44`) | The listing lives in a workflow so the admin inspection mirror `GET /admin/partners/:id/designs` "runs exactly this logic" (`apps/backend/src/api/partners/designs/route.ts:131-133`; the admin mirror route itself was not read — unverified) |

### 4.2 Different workflows, same end state

| # | End state | Route A → workflow | Route B → workflow | Notes / more complete |
|---|---|---|---|---|
| 1 | Catalogue product created from a design | `POST /admin/designs/:id/approve` → `createProductFromDesignWorkflow` (`apps/backend/src/api/admin/designs/[id]/approve/route.ts:80`) | `POST /admin/production-runs/approvals` → `applyRunApprovals` (`apps/backend/src/api/admin/production-runs/approvals/route.ts:30`) | Both create a product per design; the run-approvals path is the more complete one — it is batch, per-design idempotent, and REUSES the design's existing product rather than creating a second (`apps/backend/src/api/admin/production-runs/approvals/route.ts:14-18`). A third, narrower path mints a made-to-order *variant* for quoting: `ensureDesignQuoteVariantWorkflow` (`apps/backend/src/api/admin/quotes/designs/[designId]/variant/route.ts:29`) |
| 2 | Production runs collated into a `kind=design` work-order | `POST /admin/designs/produce` → `produceDesignsAsWorkOrder` (`apps/backend/src/api/admin/designs/produce/route.ts:72`) | `POST /admin/orders/:id/design/produce` → `createRunsForDesignOrder` (`apps/backend/src/api/admin/orders/[id]/design/produce/route.ts:33`) | Explicitly contrasted in the code: the designs-list path is the "no-customer analog" (`apps/backend/src/api/admin/designs/produce/route.ts:15-17`). `produce` is the more complete implementation (per-design `template_ids`, `dry_run`, collation policy — `apps/backend/src/api/admin/designs/produce/route.ts:31-59`). Two more run-creators converge on the same end state: `recreateProductionRunWorkflow` (`apps/backend/src/api/admin/designs/recreate-production-run/route.ts:27`, parent+children) and `createProductionRunWorkflow` (`apps/backend/src/api/admin/designs/[id]/production-runs/route.ts:107`, single run) |
| 3 | A design row created | `POST /admin/designs` → `createDesignWorkflow` (`apps/backend/src/api/admin/designs/route.ts:168`) | `POST /admin/designs/auto` → `createDesignFromLLMWorkflow` (`apps/backend/src/api/admin/designs/auto/route.ts:63`) | Same end state (a `design` row), different input modality (structured body vs LLM prompt). The manual route is the more complete/general one |
| 4 | A cart line priced from a design | `POST /store/custom/designs/:id/checkout` (estimate → cart line, `apps/backend/src/api/store/custom/designs/[id]/checkout/route.ts:124-143`) | `POST /admin/designs/draft-order` / `POST /admin/customers/:id/design-order` → `createDraftOrderFromDesignsWorkflow` (`apps/backend/src/api/admin/designs/draft-order/lib.ts:67`) | Both put a design-priced line into a cart; the admin path is the more complete one (multi-design collation, price overrides, duplicate-cart guard — `apps/backend/src/api/admin/designs/draft-order/lib.ts:44-77`) |

## 5. Gotchas / invariants

- **One mint, three doors.** `POST /admin/quotes/drafts/:id/mint` does not restate the mint logic; it
  imports the `POST` handler of `apps/backend/src/api/admin/quotes/route.ts` and calls it with a
  synthetic request (`apps/backend/src/api/admin/quotes/drafts/[id]/mint/route.ts:139-142`). The
  draft is deleted only AFTER the mint succeeds (`...:147-148`).
- **The raw quote token is returned exactly once, at mint** — only its sha256 is persisted; admin
  lists can never reconstruct a working link (`apps/backend/src/api/admin/quotes/route.ts:63-67`).
- **Admin mint has a guard the partner mint lacks**: `assertVariantsInStore`, because an admin
  picks partner and variants from two different dropdowns (`apps/backend/src/api/admin/quotes/route.ts:148-156`);
  the partner surface deliberately omits it (`apps/backend/src/api/partners/quotes/route.ts:103-108`).
- **Admin design-line resolution is unscoped; partner is scoped** — an admin may quote a design the
  producing partner does not own (`apps/backend/src/api/admin/quotes/route.ts:104-113` vs
  `apps/backend/src/api/partners/quotes/route.ts:74-81`).
- **Partner-owned designs are hidden from the admin list by default** (`include_partner_owned`,
  `apps/backend/src/api/admin/designs/route.ts:292-296`); `POST /partners/designs` stamps
  `owner_partner_id` from auth, never the body (`apps/backend/src/api/partners/designs/route.ts:179-191`).
- **Delink verb mismatch**: admin `inventory/delink` is POST (`apps/backend/src/api/admin/designs/[id]/inventory/delink/route.ts:50`)
  while the partner twin is DELETE (`apps/backend/src/api/partners/designs/[designId]/inventory/delink/route.ts:13`).
- **Checkout refuses a null estimate** rather than selling for zero (`apps/backend/src/api/store/custom/designs/[id]/checkout/route.ts:94-99`).
- **`POST /admin/designs/produce` vs `POST /admin/orders/:id/design/produce`** are not
  interchangeable: the former has no commissioning order behind it (`apps/backend/src/api/admin/designs/produce/route.ts:15-17`).
- **`GET /admin/design-work-orders` hides cancelled runs by default** (`include_cancelled`,
  `apps/backend/src/api/admin/design-work-orders/route.ts:42-48`).
- **The MCP registry deliberately excludes the AI/file-shaped design routes** (`/admin/designs/auto`,
  `segment`, `outline`, `redesign`, `moodboard/generate`, `pattern-blocks`) because they cost money
  per call or blow the chat context — asserted by test
  `apps/backend/src/api/admin/mcp/lib/__tests__/dispatch.unit.spec.ts:748-762`.
- **`GET /admin/designs` with `customer_id` bypasses `listDesignsWorkflow`** and reads the link table
  directly (`apps/backend/src/api/admin/designs/route.ts:222-255`).

## 6. Orphans — routes invoked by NO admin UI page, NO partner-ui page and NO MCP tool

Method: for each candidate I ran three greps — (1) the route-path string in the admin UI
(`apps/backend/src/admin`), (2) in the partner UI (`apps/partner-ui/src`), (3) in the MCP registries
(`apps/backend/src/api/admin/mcp/lib/registry.ts` for `/admin/*` routes; for `/partners/*` routes
also `apps/backend/src/api/partners/mcp/lib/registry.ts`, since the admin registry only wraps
`/admin/*` paths). Store routes are consumed by the storefront (cited below), so they are N/A for
this definition.

### 6.1 Confirmed orphans (admin surface)

1. **`POST/GET /admin/designs/[id]/inquiries`, `POST .../inquiries/preview`, `POST .../inquiries/[inquiryId]/close`**
   (`apps/backend/src/api/admin/designs/[id]/inquiries/route.ts:12,38`,
   `apps/backend/src/api/admin/designs/[id]/inquiries/preview/route.ts:22`,
   `apps/backend/src/api/admin/designs/[id]/inquiries/[inquiryId]/close/route.ts:12`).
   Greps run: (1) `inquir` in `apps/backend/src/admin` → no files; (2) `inquir` in `apps/partner-ui`
   → only `/partners/inquiries*` calls (a different route family,
   `apps/partner-ui/src/hooks/api/partner-inquiries.tsx:175,204,234,267`); (3) `inquir` in
   `apps/backend/src/api/admin/mcp/lib/registry.ts` → only a chat-keyword list in
   `apps/backend/src/api/admin/mcp/lib/tool-slice.ts:307`, no tool.
   Notable: these routes are the ONLY entry point of `createDesignInquiryWorkflow` (grep across
   `apps/backend/src` matched only the workflow file and these routes), i.e. the creation side of
   the design-inquiry pipeline has no UI, while the partner answering side is fully built
   (`apps/partner-ui/src/routes/inquiries/inquiry-list/inquiry-list.tsx:45`).
2. **`GET /admin/designs/[id]/pattern-blocks`** (`apps/backend/src/api/admin/designs/[id]/pattern-blocks/route.ts:21`).
   Greps run: (1) `pattern-blocks|patternBlock` in `apps/backend/src/admin` → no files; (2) same in
   `apps/partner-ui` → no files; (3) `pattern-blocks` in
   `apps/backend/src/api/admin/mcp/lib/registry.ts` → absent (exclusion asserted in
   `apps/backend/src/api/admin/mcp/lib/__tests__/dispatch.unit.spec.ts:757`).
3. **`POST /admin/quotes/[id]/adjust`** (`apps/backend/src/api/admin/quotes/[id]/adjust/route.ts:21`).
   Greps run: (1) `adjust` in `apps/backend/src/admin` → no fetch to this route (only prose
   matches, e.g. `apps/backend/src/admin/components/designs/design-consumption-logs-section.tsx:181`);
   (2) `/adjust` in `apps/partner-ui` → only inventory-adjust UI
   (`apps/partner-ui/src/routes/inventory/inventory-detail/components/adjust-inventory/adjust-inventory-drawer.tsx:8`);
   (3) `adjust` in `apps/backend/src/api/admin/mcp/lib/registry.ts` → no tool.
4. **`POST/DELETE /admin/designs/[id]/material-groups/[groupId]`**
   (`apps/backend/src/api/admin/designs/[id]/material-groups/[groupId]/route.ts:14,39`).
   Greps run: (1) `material-groups` in `apps/backend/src/admin` → only `/admin/raw-material-groups`
   calls (a different route family, `apps/backend/src/admin/hooks/api/raw-material-groups.ts:71`);
   (2) `material-groups` in `apps/partner-ui` → no design-scoped calls; (3) registry wraps only
   `/admin/designs/:id/material-groups` GET+POST
   (`apps/backend/src/api/admin/mcp/lib/registry.ts:4686,4695`), not the `[groupId]` subroute.
   (The parent route `GET/POST /admin/designs/[id]/material-groups` is NOT an orphan — MCP covers it.)

### 6.2 Confirmed orphans (partners surface)

All checked against partner-ui, the partner MCP registry
(`apps/backend/src/api/partners/mcp/lib/registry.ts` — its design/quote paths are listed at lines
697-841 and 3573-3653), and the admin UI (which never calls `/partners/*`; grep `/partners/designs`
in `apps/backend/src/admin` → no files):

1. **`GET /partners/designs/[designId]/revisions`** (`apps/backend/src/api/partners/designs/[designId]/revisions/route.ts:37`).
   Greps: (1) `designs/.*revisions` in `apps/partner-ui/src` → none; (2) `/partners/designs` path
   list in the partner MCP registry → absent; (3) `/partners/designs` in `apps/backend/src/admin` → none.
2. **`POST /partners/designs/[designId]/revise`** (`apps/backend/src/api/partners/designs/[designId]/revise/route.ts:36`) — same three greps.
3. **`GET /partners/designs/[designId]/used-in`** (`apps/backend/src/api/partners/designs/[designId]/used-in/route.ts:27`) — same three greps.
4. **`GET /partners/designs/[designId]/components`** (`apps/backend/src/api/partners/designs/[designId]/components/route.ts:26`) — same three greps.
5. **`GET/POST /partners/designs/[designId]/tasks`** (`apps/backend/src/api/partners/designs/[designId]/tasks/route.ts:40,74`) — same three greps.
6. **`POST /partners/designs/[designId]/segment` and `POST .../segment/depth`** (`apps/backend/src/api/partners/designs/[designId]/segment/route.ts:36`, `.../segment/depth/route.ts:37`) — same three greps.
7. **`POST /partners/quotes/[id]/adjust`** (`apps/backend/src/api/partners/quotes/[id]/adjust/route.ts:27`) — greps: (1) `quotes/.*adjust|/adjust` in `apps/partner-ui/src` → none; (2) partner MCP registry → absent; (3) admin UI → none. (The admin twin in §6.1.3 is orphaned the same way.)

### 6.3 UNCLEAR

- **`GET/POST /admin/designs/[id]/[path]`** (`apps/backend/src/api/admin/designs/[id]/[path]/route.ts:95,128`)
  is a stub returning canned `notes`/`test` responses. Its usage cannot be reliably grepped because
  it is a catch-all (any single-segment subpath); no admin UI file references `/notes` or `/test`
  under designs in my greps, but I cannot rule out dynamic callers. UNCLEAR — treat as a dead stub
  pending a runtime check.
- **`POST /admin/designs/[id]/redesign`, `segment`, `outline`, `moodboard/generate`, `auto`** are
  excluded from MCP by policy (`apps/backend/src/api/admin/mcp/lib/__tests__/dispatch.unit.spec.ts:748-762`)
  but ARE used by the admin UI (`apps/backend/src/admin/hooks/api/designs.ts:842,1149,1184,295`,
  `apps/backend/src/admin/components/designs/fabric-preview-tab.tsx:258`) — not orphans.

### 6.4 Store surface — N/A for the orphan definition

Every inventoried store route is invoked by the storefront
(`apps/storefront/src/lib/data/designs.ts:127,162,201,224,291,323,442`,
`apps/storefront/src/lib/data/quotes.ts:419,477`,
`apps/storefront/src/modules/products/components/design-chat/lib/design-conversations.tsx:50,71,96,122,142`,
`.../design-uploads.ts:149`, `.../design-scene.ts:53`, `.../design-pick.ts:18`,
`apps/storefront/src/lib/data/design-references.ts:34`,
`apps/storefront/src/lib/data/ai-imagegen.ts:257`), so none is orphaned in the practical sense even
though no admin/partner UI or MCP tool calls them.

## 7. Open questions / (unverified)

- `GET /admin/partners/:id/designs` — cited only as a comment ("admin inspection mirror") in
  `apps/backend/src/api/partners/designs/route.ts:131-133`; the route file itself was not read (unverified).
- `apps/backend/src/api/admin/customers/[id]/design-order/preview/route.ts` — known only via the
  re-export in `apps/backend/src/api/admin/designs/draft-order/preview/route.ts:9`; not read directly.
- Workflows behind `admin/designs/[id]/segment`, `segment/depth`, `outline`, `redesign`,
  `store/custom/design-assistant/pick`, `references/analyze`, and the store `production-story`
  route were not opened; only their verbs are cited.
- `design_partners_link` link file (`apps/backend/src/links/`) was not read; its behaviour is cited
  only from the docblock of `apps/backend/src/api/partners/designs/route.ts:156-158`.
- Whether any external (non-repo) client calls the orphaned routes — cannot be verified from source.

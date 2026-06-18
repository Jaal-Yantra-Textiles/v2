import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { createOrderWorkflow } from "@medusajs/medusa/core-flows"
import type { Link } from "@medusajs/modules-sdk"
import type { LinkDefinition, MedusaContainer } from "@medusajs/framework/types"
import { ORDER_INVENTORY_MODULE } from "../../modules/inventory_orders"
import { PARTNER_MODULE } from "../../modules/partner"
import { UNIFIED_ORDER_STATUS_MODULE } from "../../modules/unified_order_status"
import { pickDefaultCurrency } from "../../lib/resolve-store-currency"

// #342 T2 — best-effort projection of legacy inventory orders onto the core
// `order` entity (kind=inventory = "the order↔inventory_order link exists";
// Chunk 6 retired the metadata.kind discriminator). See
// apps/docs/notes/ORDERS_UNIFICATION_342.md §3 + §5. Failure must never fail
// the legacy create, so each step swallows errors and reports via logger.

export const PARTNER_WORK_ORDERS_CHANNEL = "Partner Work Orders"

// #342 metadata-as-critical-data audit — the load-bearing unification keys on a
// unified order's `metadata`. Medusa's `update*` REPLACES the whole metadata
// blob, so any external writer (e.g. a partner PATCH) must read-then-merge AND
// must never let caller input overwrite these — they anchor backfill/idempotency
// (`legacy_id`) and the order's commercial provenance. NOTE: `kind` is no longer
// here — Chunk 6 retired it; the order↔execution link IS the discriminator now.
// `partner_status` is also gone — PR-H (Chunk 9b-contract) promoted it entirely
// onto the typed `unified_order_status` sidecar column, so the metadata copy is
// no longer written or read. See ORDERS_UNIFICATION_342.md "metadata-as-critical-data".
export const PROTECTED_UNIFICATION_METADATA_KEYS = [
  "legacy_id",
  "source_order_id",
  "source_line_item_id",
  "superseded_by_run_ids",
  "currency_assumed",
  "to_stock_location_id",
  "from_stock_location_id",
] as const

// §5 — legacy 6-value enum → core order.status. The work-progress dimension
// (metadata.partner_status) only exists once a partner is assigned, which
// never holds at create time.
const LEGACY_TO_CORE_STATUS: Record<string, string> = {
  Pending: "pending",
  Processing: "pending",
  Shipped: "pending",
  Partial: "pending",
  Delivered: "completed",
  Cancelled: "canceled",
}

// §5 — legacy status → unified metadata.partner_status (the shared
// assigned→…→completed vocabulary T3 panels key on; "partial" marks
// partially-delivered work that is still open). Pending and Cancelled are
// absent on purpose: "assigned" is stamped by send-to-partner, and the §5
// table defines no partner_status for either, so the mirror leaves the
// existing value untouched rather than inventing one.
const LEGACY_TO_PARTNER_STATUS: Record<string, string> = {
  Processing: "in_progress",
  Shipped: "finished",
  Partial: "partial",
  Delivered: "completed",
}

// Core address columns; anything else in the legacy json blob is preserved
// under order.metadata.shipping_address_extra.
const CORE_ADDRESS_KEYS = [
  "first_name",
  "last_name",
  "company",
  "address_1",
  "address_2",
  "city",
  "province",
  "postal_code",
  "country_code",
  "phone",
]

const splitShippingAddress = (raw: Record<string, unknown> | null | undefined) => {
  if (!raw || typeof raw !== "object" || !Object.keys(raw).length) {
    return { address: undefined, extra: undefined }
  }
  const address: Record<string, unknown> = {}
  const extra: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (CORE_ADDRESS_KEYS.includes(key)) {
      address[key] = value
    } else {
      extra[key] = value
    }
  }
  return {
    address: Object.keys(address).length ? address : undefined,
    extra: Object.keys(extra).length ? extra : undefined,
  }
}

type DualWriteResult = {
  unified_order_id: string | null
  skipped?: string
  error?: string
}

type MirrorResult = {
  linked: boolean
  unified_order_id?: string
  skipped?: string
  error?: string
}

// #342 PR-H (Chunk 9b-contract) retired `withUnifiedOrderMetadataLock`. It
// existed to serialize the read-modify-write of `metadata.partner_status` across
// concurrent transitions (the lost-update race). Now that `partner_status` lives
// only on the typed `unified_order_status` sidecar column — written via a
// single-column upsert (`setUnifiedOrderPartnerStatus`) with no read-modify-write
// to lose — the lock has nothing left to protect: every remaining metadata write
// is either write-once-at-create or the single-writer `superseded_by_run_ids`
// patch at approve time. The Chunk-8 Redis locking PROVIDER stays in
// medusa-config (other LOCKING consumers — `complete-production-run`, the
// `production-run-task-updated` subscriber — resolve it independently).

// D5-3 — resolve a legacy row's unified order id by the order↔<execution>
// link, forward (`<entity>.order`), which the Chunk 2 directionality finding
// established as the authoritative join. This replaces reading the
// `metadata.unified_order_id` backref as the primary path in every
// transactional mirror/partner-link reader (inventory + production-run steps,
// the admin cancel route, the task-updated subscriber). The backref survives
// only as a transitional fallback for rows projected before D5-2 (link-less);
// it goes away once T4 (Chunk 9) backfills links onto historicals, after which
// Chunk 6 stops writing it entirely.
export const resolveUnifiedOrderIdByLink = async (
  container: MedusaContainer,
  entity: "inventory_orders" | "production_runs",
  legacyId: string
): Promise<string | undefined> => {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity,
    fields: ["id", "order.id", "metadata"],
    filters: { id: legacyId },
  })
  const row = data?.[0]
  return row?.order?.id ?? row?.metadata?.unified_order_id ?? undefined
}

// #342 Chunk 9b (PR-F→PR-H) — `partner_status` lives ONLY on the typed 1:1
// `unified_order_status` sidecar column (PR-H retired the metadata copy). Atomic
// upsert: find-or-create the sidecar row (via the order↔unified_order_status
// link) and write the single `partner_status` column. A single-column write has
// no read-modify-write, so it needs no lock — which is why PR-H could drop the
// metadata RMW and its per-order lock entirely. The create race on a brand-new
// order's first status is a non-issue in practice: the create-path projection
// (production runs) and the single send-to-partner mirror (inventory) establish
// the row before any concurrent transition can run.
export const setUnifiedOrderPartnerStatus = async (
  container: MedusaContainer,
  unifiedOrderId: string,
  status: string
): Promise<void> => {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: ["id", "unified_order_status.id"],
    filters: { id: unifiedOrderId },
  })
  const existingId = data?.[0]?.unified_order_status?.id
  const service: any = container.resolve(UNIFIED_ORDER_STATUS_MODULE)
  if (existingId) {
    await service.updateUnifiedOrderStatuses([
      { id: existingId, partner_status: status },
    ])
    return
  }
  const created = await service.createUnifiedOrderStatuses({
    partner_status: status,
  })
  const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
  await remoteLink.create([
    {
      [Modules.ORDER]: { order_id: unifiedOrderId },
      [UNIFIED_ORDER_STATUS_MODULE]: { unified_order_status_id: created.id },
    },
  ])
}

// D5-cleanup (Chunk 6) — create the load-bearing order↔<execution> link
// AUTHORITATIVELY. Until Chunk 6 the link was best-effort (swallow + warn)
// because `metadata.unified_order_id` was a backref safety net. Chunk 6 stops
// writing that backref, so the link is now the SOLE pointer from a freshly
// projected order back to its legacy entity — a silent link failure would
// orphan the order (no pointer, and — being link-less — it would leak into the
// admin retail anti-join). Make the dual-write atomic instead: if the link
// fails, delete the just-created unified order and rethrow, so the projection
// reports failure via the caller's swallow-and-warn boundary and leaves no
// half-state. The work-order has no payment/fulfillment/reservation (its items
// carry no variant_id), so `deleteOrders` is a clean cascade.
export const linkUnifiedOrderOrRollback = async (
  container: MedusaContainer,
  unifiedOrderId: string,
  link: LinkDefinition
): Promise<void> => {
  const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
  try {
    await remoteLink.create([link])
  } catch (linkErr: any) {
    const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
    const orderService: any = container.resolve(Modules.ORDER)
    await orderService.deleteOrders([unifiedOrderId]).catch((delErr: any) =>
      logger.error(
        `[orders-unification] ORPHANED unified order ${unifiedOrderId}: execution link failed (${linkErr?.message}) AND rollback delete failed (${delErr?.message}) — manual cleanup needed`
      )
    )
    throw linkErr
  }
}

type DualWriteInput = {
  order: any
  orderLines: any[]
  input: {
    stock_location_id: string
    from_stock_location_id?: string
    order_lines: { inventory_item_id: string; quantity: number; price: number }[]
  } & Record<string, any>
}

export const dualWriteUnifiedOrderStep = createStep(
  "dual-write-unified-order",
  async ({ order, orderLines, input }: DualWriteInput, { container }) => {
    const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
    try {
      const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

      // Region + currency: legacy rows have neither (GAP-2). Use the store's
      // default region (or any region) and default currency, flagged as
      // assumed so FX work can re-rate later.
      const { data: stores } = await query.graph({
        entity: "store",
        fields: ["id", "default_region_id", "supported_currencies.*"],
      })
      const store = stores?.[0]
      let regionId: string | undefined = store?.default_region_id ?? undefined
      if (!regionId) {
        const { data: regions } = await query.graph({
          entity: "region",
          fields: ["id"],
          pagination: { take: 1 },
        })
        regionId = regions?.[0]?.id
      }
      if (!regionId) {
        logger.warn(
          `[orders-unification] skipped dual-write for ${order.id}: no region exists`
        )
        return new StepResponse<DualWriteResult>({
          unified_order_id: null,
          skipped: "no_region",
        })
      }
      // #485: centralised default-currency selection. Partner is linked AFTER
      // creation here, so the platform/base store currency is used at stamping
      // time; the #457 backfill job re-stamps to the partner currency later.
      const currencyCode = pickDefaultCurrency(store, "inr")

      // Internal sales channel keeps work-orders out of storefront analytics
      // and retail listings. Lazily ensured (idempotent) instead of a seed
      // script so fresh environments need no deploy-time coordination.
      const salesChannelService: any = container.resolve(Modules.SALES_CHANNEL)
      let [channel] = await salesChannelService.listSalesChannels({
        name: PARTNER_WORK_ORDERS_CHANNEL,
      })
      if (!channel) {
        channel = await salesChannelService.createSalesChannels({
          name: PARTNER_WORK_ORDERS_CHANNEL,
          description:
            "Internal channel for unified partner work-orders (#342). Not a storefront.",
        })
      }

      // Line titles come from the inventory items (raw materials have no
      // product/variant — items are custom lines with explicit unit_price).
      const inventoryService: any = container.resolve(Modules.INVENTORY)
      const inventoryItemIds = input.order_lines.map((l) => l.inventory_item_id)
      const inventoryItems = await inventoryService.listInventoryItems({
        id: inventoryItemIds,
      })
      const titleByItemId = new Map<string, string>(
        inventoryItems.map((item: any) => [
          item.id,
          item.title || item.sku || item.id,
        ])
      )

      // Legacy line `price` is the line-total contribution (the legacy
      // workflow sums plain prices into total_price); core wants unit price.
      const items = orderLines.map((line: any, idx: number) => {
        const legacyLine = input.order_lines[idx]
        const quantity = Number(line.quantity)
        const lineTotal = Number(line.price)
        return {
          title: titleByItemId.get(legacyLine?.inventory_item_id) ?? "Raw material",
          quantity,
          unit_price: quantity > 0 ? lineTotal / quantity : lineTotal,
          metadata: {
            inventory_item_id: legacyLine?.inventory_item_id,
            legacy_orderline_id: line.id,
            legacy_line_price: lineTotal,
          },
        }
      })

      const { address, extra } = splitShippingAddress(order.shipping_address)

      // Legacy metadata wins on collision except the unification keys (§3).
      const metadata: Record<string, unknown> = {
        ...(order.metadata ?? {}),
        legacy_id: order.id,
        total_quantity: Number(order.quantity),
        expected_delivery_date: order.expected_delivery_date ?? null,
        order_date: order.order_date ?? null,
        is_sample: !!order.is_sample,
        to_stock_location_id:
          input.to_stock_location_id || input.stock_location_id,
        from_stock_location_id: input.from_stock_location_id ?? null,
        currency_assumed: true,
        ...(extra ? { shipping_address_extra: extra } : {}),
      }

      // GAP-3: omit customer_id AND email — findOrCreateCustomerStep then
      // resolves no customer and the order is created customer-less. Passing
      // an email would find-or-create a guest customer row, which we don't
      // want for internal POs.
      const { result: unified } = await createOrderWorkflow(container).run({
        input: {
          region_id: regionId,
          sales_channel_id: channel.id,
          currency_code: currencyCode,
          status: (LEGACY_TO_CORE_STATUS[order.status] ?? "pending") as any,
          items: items as any,
          shipping_address: address as any,
          metadata,
        },
      })

      // D5-2 / Chunk 6 — the load-bearing order↔inventory_order link is the
      // SOLE discriminator + pointer (kind=inventory is "this link exists").
      // filterable:["id"] → the Index Module ingests it so the admin retail-list
      // anti-join can exclude work-orders (Chunk 4). This create path runs once
      // per legacy create, so no link-existence guard is needed (a fresh unified
      // order per call). Authoritative: a link failure rolls back the order
      // rather than leaving a pointer-less orphan (the metadata.unified_order_id
      // backref that used to be the safety net is no longer written, Chunk 6).
      await linkUnifiedOrderOrRollback(container, unified.id, {
        [Modules.ORDER]: { order_id: unified.id },
        [ORDER_INVENTORY_MODULE]: { inventory_orders_id: order.id },
      })

      return new StepResponse<DualWriteResult>({ unified_order_id: unified.id })
    } catch (e: any) {
      logger.warn(
        `[orders-unification] dual-write failed for ${order?.id}: ${e?.message}`
      )
      return new StepResponse<DualWriteResult>({
        unified_order_id: null,
        error: e?.message,
      })
    }
  }
)

// Send-to-partner mirror: once the partner is known, scope the unified order
// to them (D3 link) and stamp metadata.partner_status = "assigned" (§5).
// Same best-effort contract as the create-side step.
export const mirrorPartnerLinkOnUnifiedOrderStep = createStep(
  "mirror-partner-link-on-unified-order",
  async (
    input: { inventoryOrderId: string; partnerId: string },
    { container }
  ) => {
    const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
    try {
      const unifiedOrderId = await resolveUnifiedOrderIdByLink(
        container,
        "inventory_orders",
        input.inventoryOrderId
      )
      if (!unifiedOrderId) {
        return new StepResponse<MirrorResult>({
          linked: false,
          skipped: "no_unified_order",
        })
      }

      const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
      const links: LinkDefinition[] = [
        {
          [PARTNER_MODULE]: { partner_id: input.partnerId },
          [Modules.ORDER]: { order_id: unifiedOrderId },
          data: {
            partner_id: input.partnerId,
            order_id: unifiedOrderId,
            assigned_at: new Date().toISOString(),
          },
        },
      ]
      await remoteLink.create(links)

      // PR-H (Chunk 9b-contract) — `partner_status` is now column-only. Write
      // the typed `unified_order_status` sidecar (single-column upsert, no RMW,
      // no lock). A failure throws to the step's swallow-and-warn boundary so the
      // legacy path is never failed.
      await setUnifiedOrderPartnerStatus(container, unifiedOrderId, "assigned")

      return new StepResponse<MirrorResult>({
        linked: true,
        unified_order_id: unifiedOrderId,
      })
    } catch (e: any) {
      logger.warn(
        `[orders-unification] partner link mirror failed for ${input.inventoryOrderId}: ${e?.message}`
      )
      return new StepResponse<MirrorResult>({ linked: false, error: e?.message })
    }
  }
)

// Status mirror (early T3, §6): after any legacy update, re-read the legacy
// row and PATCH the unified order's status + metadata.partner_status per the
// §5 map. Appended to both update workflows so admin PUTs, partner start,
// partner complete, and their compensations all converge through one path.
// Reads current DB state rather than trusting workflow input, so it also
// mirrors rollbacks correctly. Same best-effort contract as the other steps.
export const mirrorUnifiedOrderStatusStep = createStep(
  "mirror-unified-order-status",
  async (input: { inventoryOrderId: string }, { container }) => {
    const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
    try {
      const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
      const { data: invOrders } = await query.graph({
        entity: "inventory_orders",
        fields: ["id", "status", "order.id", "metadata"],
        filters: { id: input.inventoryOrderId },
      })
      const legacy = invOrders?.[0]
      // D5-3 — resolve the unified order via the order↔inventory_order link
      // (forward, authoritative); the legacy backref is a transitional fallback
      // for pre-D5-2 link-less rows. Fetched in the same query as `status`.
      const unifiedOrderId =
        legacy?.order?.id ?? legacy?.metadata?.unified_order_id
      if (!unifiedOrderId) {
        return new StepResponse<MirrorResult>({
          linked: false,
          skipped: "no_unified_order",
        })
      }

      const coreStatus = LEGACY_TO_CORE_STATUS[legacy.status]
      const partnerStatus = LEGACY_TO_PARTNER_STATUS[legacy.status]

      // core order.status is a single column — a blind write, last-writer-wins,
      // nothing to lose, so no lock (PR-H retired withUnifiedOrderMetadataLock).
      if (coreStatus) {
        const orderService: any = container.resolve(Modules.ORDER)
        await orderService.updateOrders([
          { id: unifiedOrderId, status: coreStatus },
        ])
      }

      // PR-H — partner_status is column-only now: single-column upsert on the
      // typed `unified_order_status` sidecar. Throws to the step's swallow-and-
      // warn boundary on failure (best-effort: never fails the legacy path).
      if (partnerStatus) {
        await setUnifiedOrderPartnerStatus(container, unifiedOrderId, partnerStatus)
      }

      return new StepResponse<MirrorResult>({
        linked: true,
        unified_order_id: unifiedOrderId,
      })
    } catch (e: any) {
      logger.warn(
        `[orders-unification] status mirror failed for ${input.inventoryOrderId}: ${e?.message}`
      )
      return new StepResponse<MirrorResult>({ linked: false, error: e?.message })
    }
  }
)

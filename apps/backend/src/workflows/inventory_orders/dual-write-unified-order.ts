import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { createOrderWorkflow } from "@medusajs/medusa/core-flows"
import type { Link } from "@medusajs/modules-sdk"
import type { LinkDefinition } from "@medusajs/framework/types"
import { ORDER_INVENTORY_MODULE } from "../../modules/inventory_orders"
import { PARTNER_MODULE } from "../../modules/partner"
import InventoryOrderService from "../../modules/inventory_orders/service"

// #342 T2 — best-effort projection of legacy inventory orders onto the core
// `order` entity (metadata.kind = "inventory"). See
// apps/docs/notes/ORDERS_UNIFICATION_342.md §3 + §5. Failure must never fail
// the legacy create, so each step swallows errors and reports via logger.

export const PARTNER_WORK_ORDERS_CHANNEL = "Partner Work Orders"

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
// assigned→…→completed vocabulary T3 panels key on). Pending and Cancelled
// are absent on purpose: "assigned" is stamped by send-to-partner, and the
// §5 table defines no partner_status for either, so the mirror leaves the
// existing value untouched rather than inventing one.
const LEGACY_TO_PARTNER_STATUS: Record<string, string> = {
  Processing: "in_progress",
  Shipped: "finished",
  Partial: "completed",
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
      const currencyCode =
        store?.supported_currencies?.find((c: any) => c?.is_default)
          ?.currency_code ?? "inr"

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
        kind: "inventory",
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

      const inventoryOrderService: InventoryOrderService =
        container.resolve(ORDER_INVENTORY_MODULE)
      await inventoryOrderService.updateInventoryOrders({
        id: order.id,
        metadata: {
          ...(order.metadata ?? {}),
          unified_order_id: unified.id,
        },
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
      const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
      const { data: invOrders } = await query.graph({
        entity: "inventory_orders",
        fields: ["id", "metadata"],
        filters: { id: input.inventoryOrderId },
      })
      const unifiedOrderId = invOrders?.[0]?.metadata?.unified_order_id
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

      const orderService: any = container.resolve(Modules.ORDER)
      const unifiedOrder = await orderService.retrieveOrder(unifiedOrderId, {
        select: ["id", "metadata"],
      })
      await orderService.updateOrders([
        {
          id: unifiedOrderId,
          metadata: {
            ...(unifiedOrder?.metadata ?? {}),
            partner_status: "assigned",
          },
        },
      ])

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
        fields: ["id", "status", "metadata"],
        filters: { id: input.inventoryOrderId },
      })
      const legacy = invOrders?.[0]
      const unifiedOrderId = legacy?.metadata?.unified_order_id
      if (!unifiedOrderId) {
        return new StepResponse<MirrorResult>({
          linked: false,
          skipped: "no_unified_order",
        })
      }

      const coreStatus = LEGACY_TO_CORE_STATUS[legacy.status]
      const partnerStatus = LEGACY_TO_PARTNER_STATUS[legacy.status]

      const orderService: any = container.resolve(Modules.ORDER)
      const unifiedOrder = await orderService.retrieveOrder(unifiedOrderId, {
        select: ["id", "metadata"],
      })
      await orderService.updateOrders([
        {
          id: unifiedOrderId,
          ...(coreStatus ? { status: coreStatus } : {}),
          ...(partnerStatus
            ? {
                metadata: {
                  ...(unifiedOrder?.metadata ?? {}),
                  partner_status: partnerStatus,
                },
              }
            : {}),
        },
      ])

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

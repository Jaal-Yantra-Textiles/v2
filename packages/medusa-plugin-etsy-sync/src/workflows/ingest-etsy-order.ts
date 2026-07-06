import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  WorkflowData,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  createOrderWorkflow,
  createOrderPaymentCollectionWorkflow,
  markPaymentCollectionAsPaid,
} from "@medusajs/medusa/core-flows"
import { ETSY_SYNC_MODULE } from "../modules/etsy-sync"
import EtsySyncService from "../modules/etsy-sync/service"
import { mapReceiptToOrder } from "./ingest-etsy-order-support"

export const INGEST_ETSY_ORDER = "etsy-ingest-order"

/**
 * Best-effort inventory decrement for a sold Etsy order. Off by default — set
 * ETSY_DECREMENT_INVENTORY=true to enable. Our order line items are custom
 * (not variant-bound), so we resolve product → variant → inventory item from
 * the listing id (via sync records) and adjust the level with the most stock
 * down by the sold quantity. Wrapped so it never blocks the order.
 */
async function decrementInventory(
  container: any,
  items: Array<{ quantity: number; metadata: Record<string, any> }>,
  service: EtsySyncService,
  logger: any
) {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const inventory: any = container.resolve(Modules.INVENTORY)

  for (const item of items) {
    const listingId = item.metadata?.etsy_listing_id
    if (!listingId) continue
    try {
      const [records] = await service.listSyncRecords({ listing_id: String(listingId) }, 1, 0)
      const productId = (records as any[])?.[0]?.product_id
      if (!productId) continue

      const { data: products } = await query.graph({
        entity: "product",
        fields: [
          "id",
          "variants.inventory_items.inventory_item_id",
          "variants.inventory_items.inventory.location_levels.location_id",
          "variants.inventory_items.inventory.location_levels.stocked_quantity",
        ],
        filters: { id: productId },
      })

      const invItem = (products?.[0]?.variants || [])
        .flatMap((v: any) => v.inventory_items || [])
        .find((ii: any) => ii?.inventory_item_id)
      const levels = invItem?.inventory?.location_levels || []
      const level = [...levels].sort(
        (a: any, b: any) => Number(b.stocked_quantity) - Number(a.stocked_quantity)
      )[0]
      if (!invItem?.inventory_item_id || !level?.location_id) continue

      await inventory.adjustInventory(
        invItem.inventory_item_id,
        level.location_id,
        -Math.abs(item.quantity)
      )
      logger?.info?.(
        `[etsy-order] decremented inventory ${invItem.inventory_item_id} by ${item.quantity}`
      )
    } catch (err: any) {
      logger?.warn?.(
        `[etsy-order] inventory decrement skipped for listing ${listingId}: ${err?.message}`
      )
    }
  }
}

export type IngestEtsyOrderInput = {
  receipt: any
  etsy_order_id?: string | null
}

const ingestStep = createStep(
  "etsy-ingest-order-step",
  async (
    input: IngestEtsyOrderInput,
    { container }
  ): Promise<StepResponse<{ order_id: string | null; skipped?: string }>> => {
    const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const service: EtsySyncService = container.resolve(ETSY_SYNC_MODULE)

    const mapped = mapReceiptToOrder(input.receipt)
    if (!mapped.receipt_id) {
      return new StepResponse({ order_id: null, skipped: "no_receipt_id" })
    }
    if (!mapped.items.length) {
      return new StepResponse({ order_id: null, skipped: "no_items" })
    }

    // Idempotency — never create a second order for the same receipt (Etsy
    // retries, and order.shipped/delivered arrive later for the same receipt).
    const existing = await service
      .listEtsyOrders({ receipt_id: mapped.receipt_id } as any)
      .catch(() => [])
    const priorWithOrder = (existing as any[])?.find((e) => e.order_id)
    if (priorWithOrder) {
      return new StepResponse({ order_id: priorWithOrder.order_id, skipped: "duplicate" })
    }

    // Region matching the shop currency (fallback: any region).
    const { data: regions } = await query.graph({
      entity: "region",
      fields: ["id", "currency_code"],
    })
    const region =
      (regions as any[]).find(
        (r) => String(r.currency_code).toLowerCase() === mapped.currency_code
      ) || (regions as any[])[0]
    if (!region) {
      throw new Error("No Medusa region configured to place the Etsy order")
    }

    // Default sales channel (store default, else first).
    let salesChannelId: string | undefined
    const { data: stores } = await query.graph({
      entity: "store",
      fields: ["id", "default_sales_channel_id"],
    })
    salesChannelId = (stores as any[])?.[0]?.default_sales_channel_id
    if (!salesChannelId) {
      const { data: channels } = await query.graph({
        entity: "sales_channel",
        fields: ["id"],
      })
      salesChannelId = (channels as any[])?.[0]?.id
    }

    const orderMetadata = {
      source: "etsy",
      etsy_receipt_id: mapped.receipt_id,
      etsy_order_id: input.etsy_order_id ?? null,
      etsy_buyer_name: mapped.buyer_name,
    }

    const { result: order } = await createOrderWorkflow(container).run({
      input: {
        region_id: region.id,
        currency_code: mapped.currency_code,
        sales_channel_id: salesChannelId,
        email: mapped.email,
        items: mapped.items as any,
        shipping_address: mapped.shipping_address as any,
        metadata: orderMetadata,
      } as any,
    })

    const orderId = (order as any).id

    // Payment: Etsy already collected it → record the collection and mark paid
    // so the Medusa order shows payment_status = captured.
    try {
      const { result: pcRes }: any = await createOrderPaymentCollectionWorkflow(
        container
      ).run({ input: { order_id: orderId, amount: mapped.total as any } })
      const paymentCollectionId = Array.isArray(pcRes) ? pcRes[0]?.id : pcRes?.id
      if (paymentCollectionId) {
        await markPaymentCollectionAsPaid(container).run({
          input: {
            payment_collection_id: paymentCollectionId,
            order_id: orderId,
            captured_by: "etsy-webhook",
          } as any,
        })
      }
    } catch (err: any) {
      logger?.warn?.(
        `[etsy-order] order ${orderId} created but marking payment paid failed: ${err?.message}`
      )
    }

    // Optional inventory decrement (off unless ETSY_DECREMENT_INVENTORY=true).
    if (process.env.ETSY_DECREMENT_INVENTORY === "true") {
      await decrementInventory(container, mapped.items, service, logger)
    }

    await service
      .createEtsyOrders({
        receipt_id: mapped.receipt_id,
        order_id: orderId,
        status: "created",
        currency: mapped.currency_code,
        total: String(mapped.total),
        buyer_name: mapped.buyer_name,
        raw: input.receipt,
      } as any)
      .catch(() => {})

    logger?.info?.(
      `[etsy-order] created Medusa order ${orderId} from Etsy receipt ${mapped.receipt_id}`
    )

    return new StepResponse({ order_id: orderId })
  }
)

export const ingestEtsyOrderWorkflow = createWorkflow(
  INGEST_ETSY_ORDER,
  (input: WorkflowData<IngestEtsyOrderInput>) => {
    return new WorkflowResponse(ingestStep(input))
  }
)

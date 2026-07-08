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
import { FAIRE_SYNC_MODULE } from "../modules/faire-sync"
import FaireSyncService from "../modules/faire-sync/service"
import { mapFaireOrderToOrder } from "./ingest-faire-order-support"

export const INGEST_FAIRE_ORDER = "faire-ingest-order"

export type IngestFaireOrderInput = {
  order: any
  order_token?: string | null
}

/**
 * Best-effort inventory decrement for a sold Faire order. Off by default — set
 * FAIRE_DECREMENT_INVENTORY=true to enable. Resolves product → variant →
 * inventory item from the product token (via sync records) and adjusts the
 * level with the most stock down by the sold quantity.
 */
async function decrementInventory(
  container: any,
  items: Array<{ quantity: number; metadata: Record<string, any> }>,
  service: FaireSyncService,
  logger: any
) {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const inventory: any = container.resolve(Modules.INVENTORY)

  for (const item of items) {
    const productToken = item.metadata?.faire_product_token
    if (!productToken) continue
    try {
      const [records] = await service.listSyncRecords(
        { product_token: String(productToken) },
        1,
        0
      )
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
        `[faire-order] decremented inventory ${invItem.inventory_item_id} by ${item.quantity}`
      )
    } catch (err: any) {
      logger?.warn?.(
        `[faire-order] inventory decrement skipped for product ${productToken}: ${err?.message}`
      )
    }
  }
}

const ingestStep = createStep(
  "faire-ingest-order-step",
  async (
    input: IngestFaireOrderInput,
    { container }
  ): Promise<StepResponse<{ order_id: string | null; skipped?: string }>> => {
    const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const service: FaireSyncService = container.resolve(FAIRE_SYNC_MODULE)

    const mapped = mapFaireOrderToOrder(input.order)
    if (!mapped.order_token) {
      return new StepResponse({ order_id: null, skipped: "no_order_token" })
    }
    if (!mapped.items.length) {
      return new StepResponse({ order_id: null, skipped: "no_items" })
    }

    // Idempotency — never create a second order for the same Faire order token.
    const existing = await service
      .listFaireOrders({ order_token: mapped.order_token } as any)
      .catch(() => [])
    const priorWithOrder = (existing as any[])?.find((e) => e.order_id)
    if (priorWithOrder) {
      return new StepResponse({ order_id: priorWithOrder.order_id, skipped: "duplicate" })
    }

    const { data: regions } = await query.graph({
      entity: "region",
      fields: ["id", "currency_code"],
    })
    const region =
      (regions as any[]).find(
        (r) => String(r.currency_code).toLowerCase() === mapped.currency_code
      ) || (regions as any[])[0]
    if (!region) {
      throw new Error("No Medusa region configured to place the Faire order")
    }

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
      source: "faire",
      faire_order_token: mapped.order_token,
      faire_buyer_name: mapped.buyer_name,
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

    // Payment: Faire already collected it → record the collection and mark paid
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
            captured_by: "faire-webhook",
          } as any,
        })
      }
    } catch (err: any) {
      logger?.warn?.(
        `[faire-order] order ${orderId} created but marking payment paid failed: ${err?.message}`
      )
    }

    if (process.env.FAIRE_DECREMENT_INVENTORY === "true") {
      await decrementInventory(container, mapped.items, service, logger)
    }

    await service
      .createFaireOrders({
        order_token: mapped.order_token,
        order_id: orderId,
        status: "created",
        currency: mapped.currency_code,
        total: String(mapped.total),
        buyer_name: mapped.buyer_name,
        raw: input.order,
      } as any)
      .catch(() => {})

    logger?.info?.(
      `[faire-order] created Medusa order ${orderId} from Faire order ${mapped.order_token}`
    )

    return new StepResponse({ order_id: orderId })
  }
)

export const ingestFaireOrderWorkflow = createWorkflow(
  INGEST_FAIRE_ORDER,
  (input: WorkflowData<IngestFaireOrderInput>) => {
    return new WorkflowResponse(ingestStep(input))
  }
)

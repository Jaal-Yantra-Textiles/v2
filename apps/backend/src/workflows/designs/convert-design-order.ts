import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import type { Link } from "@medusajs/modules-sdk"
import {
  convertDraftOrderWorkflow,
  createOrderPaymentCollectionWorkflow,
  createOrderWorkflow,
  markPaymentCollectionAsPaid,
} from "@medusajs/medusa/core-flows"
import { DESIGN_MODULE } from "../../modules/designs"
import designLineItemLink from "../../links/design-line-item-link"

/**
 * #404 (#31) PR-A — admin "Convert to Order" for a design order.
 *
 * A "design order" in the admin (GET /admin/designs/orders) is a CART carrying
 * one or more design line items whose backing core `order` is still `null`
 * (the customer never checked out). This helper turns that cart into a real,
 * shippable order ADMIN-side — without routing the customer through checkout —
 * by reusing Medusa core's draft-order primitives:
 *
 *   1. createOrderWorkflow  (is_draft_order: true, status: "draft")  — build the
 *      draft from the cart's line items, addresses, customer, region, currency.
 *   2. prepaid → createOrderPaymentCollectionWorkflow + markPaymentCollectionAsPaid
 *      (core's `pp_system_default` manual provider, no region config needed) so
 *      the order lands payment_status=captured. COD → skip; the order stays
 *      not_paid and is reconciled later via Shiprocket remittance (P4 decision).
 *   3. convertDraftOrderWorkflow — flips status draft→pending, is_draft_order
 *      →false, and emits OrderWorkflowEvents.PLACED.
 *
 * Plain async helper (not a createWorkflow) to mirror projectRunToUnifiedOrder —
 * it composes core workflows the same way the partner routes do.
 *
 * PLACED side-effects (order-placed.ts) are deliberately safe here:
 *  - Line items are TITLE-ONLY (no product_id/variant_id), so the subscriber's
 *    production-run branch (`if (!productId) continue`) is skipped — converting
 *    a customer design order must NOT spawn a production work-order.
 *  - The cartless draft has no order↔cart link, so the subscriber's cart-based
 *    linkDesignsToOrder finds nothing; we link the design(s) EXPLICITLY below.
 *  - `no_notification: true` suppresses the customer order-confirmation email on
 *    an admin-initiated convert.
 */

export type ConvertDesignOrderPaymentMode = "prepaid" | "cod"

export type ConvertDesignOrderResult = {
  order_id: string
  display_id?: number
  status?: string
  payment_status?: string
  payment_mode: ConvertDesignOrderPaymentMode
  linked_design_ids: string[]
}

/** Cart/order address fields we carry over; strip ids/timestamps from the source row. */
const ADDRESS_FIELDS = [
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
] as const

const cleanAddress = (
  addr: Record<string, any> | null | undefined
): Record<string, any> | undefined => {
  if (!addr) return undefined
  const out: Record<string, any> = {}
  for (const f of ADDRESS_FIELDS) {
    if (addr[f] !== undefined && addr[f] !== null) out[f] = addr[f]
  }
  return Object.keys(out).length ? out : undefined
}

export async function convertDesignOrderToOrder(
  container: MedusaContainer,
  input: {
    lineItemId: string
    paymentMode?: ConvertDesignOrderPaymentMode
    capturedBy?: string
  }
): Promise<ConvertDesignOrderResult> {
  const paymentMode: ConvertDesignOrderPaymentMode = input.paymentMode ?? "prepaid"
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const cartService: any = container.resolve(Modules.CART)
  const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link

  // 1. Resolve the line item → its cart.
  const liRows = await cartService.listLineItems(
    { id: input.lineItemId },
    { select: ["id", "cart_id"] }
  )
  const cartId: string | undefined = liRows?.[0]?.cart_id
  if (!cartId) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Design order line item ${input.lineItemId} not found`
    )
  }

  // 2. Load the cart (region/currency/customer/addresses) + all its line items.
  const { data: carts } = await query.graph({
    entity: "cart",
    fields: [
      "id",
      "region_id",
      "currency_code",
      "sales_channel_id",
      "customer_id",
      "email",
      "completed_at",
      "metadata",
      "shipping_address.*",
      "billing_address.*",
      "items.id",
      "items.title",
      "items.quantity",
      "items.unit_price",
      "items.metadata",
    ],
    filters: { id: cartId },
  })
  const cart = carts?.[0]
  if (!cart) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Cart ${cartId} not found for design order`
    )
  }

  // Idempotency: a completed cart already has a real order; and a previous
  // convert stamps `converted_order_id` on the cart metadata.
  const alreadyConverted = (cart.metadata as any)?.converted_order_id as
    | string
    | undefined
  if (cart.completed_at || alreadyConverted) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `Design order (cart ${cartId}) has already been converted${
        alreadyConverted ? ` to order ${alreadyConverted}` : ""
      }`
    )
  }

  const lineItems: any[] = cart.items || []
  if (!lineItems.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Cart ${cartId} has no line items to convert`
    )
  }
  if (!cart.region_id || !cart.currency_code) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Cart ${cartId} is missing a region or currency; cannot convert`
    )
  }

  // 3. Build TITLE-ONLY order items (see header: keeps the PLACED subscriber
  // from spawning a production run for a customer design order).
  const orderItems = lineItems.map((li) => ({
    title: li.title,
    quantity: li.quantity,
    unit_price: li.unit_price,
    metadata: {
      ...(li.metadata || {}),
      source_cart_line_item_id: li.id,
    },
  }))

  // 4. Resolve the design(s) linked to this cart's line items (for explicit
  // linking after the order exists).
  const lineItemIds = lineItems.map((li) => li.id)
  const { data: dliRows } = await query.graph({
    entity: designLineItemLink.entryPoint,
    fields: ["design_id", "line_item_id"],
    filters: { line_item_id: lineItemIds },
  })
  const designIds: string[] = Array.from(
    new Set((dliRows || []).map((r: any) => r.design_id).filter(Boolean))
  )

  // 5. Create the draft order from the cart contents.
  const { result: order }: any = await createOrderWorkflow(container).run({
    input: {
      is_draft_order: true,
      status: "draft",
      no_notification: true,
      region_id: cart.region_id,
      currency_code: cart.currency_code,
      sales_channel_id: cart.sales_channel_id ?? undefined,
      customer_id: cart.customer_id ?? undefined,
      email: cart.email ?? undefined,
      shipping_address: cleanAddress(cart.shipping_address),
      billing_address: cleanAddress(cart.billing_address),
      items: orderItems,
      metadata: {
        source: "design-order-convert",
        source_cart_id: cart.id,
        source_line_item_id: input.lineItemId,
        payment_mode: paymentMode,
      },
    } as any,
  })

  // 6. Link the design(s) → order (the cartless draft won't auto-link).
  for (const designId of designIds) {
    await remoteLink
      .create([
        {
          [DESIGN_MODULE]: { design_id: designId },
          [Modules.ORDER]: { order_id: order.id },
        },
      ])
      .catch((e: any) =>
        logger.warn(
          `[convert-design-order] design link failed for design ${designId} → order ${order.id}: ${e?.message}`
        )
      )
  }

  // 7. Payment treatment. Always create a payment collection so the order
  // tracks the amount owed (and so COD has a record for the P4 Shiprocket-
  // remittance reconciliation). prepaid → mark it paid via the system provider
  // (payment_status=captured); cod → leave it not_paid.
  const total =
    Number(order.total) ||
    orderItems.reduce(
      (s, i) => s + (Number(i.unit_price) || 0) * (Number(i.quantity) || 0),
      0
    )
  const { result: pcRes }: any = await createOrderPaymentCollectionWorkflow(
    container
  ).run({
    input: { order_id: order.id, amount: total },
  })
  const paymentCollectionId = Array.isArray(pcRes) ? pcRes[0]?.id : pcRes?.id
  if (paymentMode === "prepaid" && paymentCollectionId) {
    await markPaymentCollectionAsPaid(container).run({
      input: {
        payment_collection_id: paymentCollectionId,
        order_id: order.id,
        captured_by: input.capturedBy,
      },
    })
  }

  // 8. Convert draft → pending order (emits PLACED; side-effects are safe, see
  // header).
  await convertDraftOrderWorkflow(container).run({ input: { id: order.id } })

  // 9. Stamp the idempotency marker on the cart (last, so a mid-failure retry
  // isn't blocked). Also set `completed_at`: this cart has become a real order,
  // so it's "done". This is the canonical Medusa "cart was converted" signal —
  // it removes the cart from the abandoned-cart recovery flow (which filters
  // `completed_at: null`) and the admin abandoned-carts view, so we never email
  // a customer who has already purchased. #443.
  await cartService
    .updateCarts(cart.id, {
      completed_at: new Date(),
      metadata: { ...(cart.metadata || {}), converted_order_id: order.id },
    })
    .catch((e: any) =>
      logger.warn(
        `[convert-design-order] failed to stamp converted_order_id on cart ${cart.id}: ${e?.message}`
      )
    )

  // 10. Read back the final state. The order's aggregate `payment_status` is a
  // computed field that query.graph doesn't reliably populate right after the
  // payment-collection link is created, so derive it from the collection
  // status (authoritative for our paid/unpaid signal).
  const { data: finalRows } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "display_id",
      "status",
      "payment_status",
      "payment_collections.status",
    ],
    filters: { id: order.id },
  })
  const final: any = finalRows?.[0] || {}
  const collectionStatus: string | undefined =
    final.payment_collections?.[0]?.status
  const paymentStatus: string | undefined =
    final.payment_status ?? collectionStatus

  return {
    order_id: order.id,
    display_id: final.display_id,
    status: final.status,
    payment_status: paymentStatus,
    payment_mode: paymentMode,
    linked_design_ids: designIds,
  }
}

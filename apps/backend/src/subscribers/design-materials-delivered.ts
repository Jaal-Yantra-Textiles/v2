import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import designInventoryOrderLink from "../links/design-inventory-order"
import { DESIGN_MODULE } from "../modules/designs"
import { ORDER_INVENTORY_MODULE } from "../modules/inventory_orders"
import { INVENTORY_ORDER_STATUS_CHANGED_EVENT } from "../workflows/inventory_orders/update-inventory-order"
import {
  decideArrivalNotice,
  MATERIAL_ARRIVED_TEMPLATE,
  stampedAttachmentData,
} from "../workflows/designs/lib/material-arrival-notice"
import { sendDesignStatusUpdateEmailWorkflow } from "../workflows/email"

/**
 * The cloth lands, and the person who commissioned it is told (#2111).
 *
 * The platform could already tell a client that production started, that it
 * finished, and that materials had been linked. It could not tell them the
 * thing they actually ask about between commissioning and production: *is my
 * fabric here yet?* That fact lived in an inventory order nobody outside the
 * admin could see.
 *
 * 🔴 Hung off the same status-changed event the run gate uses, and keyed on the
 * same `Delivered`. Two reasons it must be that event and not a nearer one:
 * `updateInventoryOrderStep` is the single choke point, so a partner recording
 * the delivery, an admin correcting the row, and the shipment tracking sync all
 * arrive here identically; and sharing the constant means the client is told
 * the cloth arrived at the same instant the run is released to work it. Telling
 * them at `Shipped` would announce an arrival while production is still
 * correctly blocked waiting for it.
 *
 * Every decision is in `decideArrivalNotice`, which is pure and tested.
 */
export default async function designMaterialsDelivered({
  event,
  container,
}: SubscriberArgs<{ id?: string; status?: string; previous_status?: string | null }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as any
  const orderId = event.data?.id

  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any

    if (String(event.data?.status ?? "") !== "Delivered" || !orderId) {
      return
    }

    const { data: links = [] } = await query
      .graph({
        entity: designInventoryOrderLink.entryPoint,
        filters: { inventory_orders_id: orderId },
        fields: [
          "design_id",
          "inventory_orders_id",
          "notify_customer",
          "notified_at",
          "note",
        ],
      })
      .catch(() => ({ data: [] }))

    const decision = decideArrivalNotice(
      event.data as any,
      (links as any[]).map((l) => ({
        design_id: String(l.design_id),
        notify_customer: l.notify_customer,
        notified_at: l.notified_at,
        note: l.note,
      }))
    )

    if (!decision.send) {
      /*
       * Logged at info and NAMED. "Nothing attached" and "everyone suppressed"
       * are different problems with different fixes, and a silent return is
       * what let five Oshen designs go un-updated for a month.
       */
      logger.info(
        `[design.materials_delivered] ${orderId}: no mail sent (${decision.reason})`
      )
      return
    }

    const { data: designs = [] } = await query.graph({
      entity: "design",
      filters: { id: decision.designIds },
      fields: ["id", "name", "status", "metadata"],
    })

    const { data: orders = [] } = await query.graph({
      entity: "inventory_orders",
      filters: { id: orderId },
      fields: ["id", "quantity", "expected_delivery_date"],
    })
    const order = (orders as any[])[0]

    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as any

    for (const design of designs as any[]) {
      const designUrl = design.metadata?.base_product_handle
        ? `${process.env.STORE_URL || ""}/products/${design.metadata.base_product_handle}/design?designId=${design.id}`
        : undefined

      await sendDesignStatusUpdateEmailWorkflow(container).run({
        input: {
          designId: String(design.id),
          designName: String(design.name ?? design.id),
          templateKey: MATERIAL_ARRIVED_TEMPLATE,
          designStatus: String(design.status ?? ""),
          designUrl,
          extraData: {
            inventory_order_id: orderId,
            material_quantity: order?.quantity ?? null,
          },
        },
      })

      /*
       * 🔴 Stamped AFTER the send, on the edge, so one arrival is announced
       * once. The upstream event only fires when the status actually moved, so
       * it cannot repeat while the order sits at Delivered — but an order
       * corrected back to Shipped and delivered again is a second event for one
       * arrival, and this is what stops the client hearing it twice.
       *
       * ⚠️ The mail is already gone by the time this runs. If the stamp fails
       * the client has still been told, so this must never throw back into the
       * bus and undo nothing while looking like a failure.
       */
      try {
        const attachment = (links as any[]).find(
          (l) => String(l.design_id) === String(design.id)
        )
        const pair = {
          [DESIGN_MODULE]: { design_id: String(design.id) },
          [ORDER_INVENTORY_MODULE]: { inventory_orders_id: orderId },
        }
        /*
         * 🔴 DISMISS THEN CREATE, carrying every column forward. This is the
         * idiom the rest of the codebase uses for changing a link's extra
         * columns (`production-run-allocation.ts`), and a bare `create` on an
         * existing pair is not a safe substitute: it either collides or writes
         * a row whose `notify_customer` and `note` are gone. Losing
         * `notify_customer` would silently revert a client who asked NOT to be
         * told back to the sending default, with the row looking untouched.
         */
        await remoteLink.dismiss([pair])
        await remoteLink.create([
          {
            ...pair,
            data: stampedAttachmentData({
              design_id: String(design.id),
              notify_customer: attachment?.notify_customer,
              note: attachment?.note,
            }),
          },
        ])
      } catch (stampError: any) {
        logger.warn(
          `[design.materials_delivered] mail sent for design ${design.id} but notified_at was not stamped: ${stampError?.message || stampError}`
        )
      }
    }

    logger.info(
      `[design.materials_delivered] ${orderId}: notified ${(designs as any[]).length} design(s)`
    )
  } catch (e: any) {
    /*
     * Never throw back into the event bus. The delivery is a fact that has
     * already been recorded and has already released the dependent runs;
     * failing here must not make any of that look otherwise.
     */
    logger.error(
      `[design.materials_delivered] failed for inventory order ${orderId}: ${e?.message || String(e)}`
    )
  }
}

export const config: SubscriberConfig = {
  event: INVENTORY_ORDER_STATUS_CHANGED_EVENT,
}

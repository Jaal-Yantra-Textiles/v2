import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { notifyCustomerOfCarrierChange } from "../../../../workflows/orders/cancel-shipment"

import type {
  MaintenanceChange,
  MaintenanceJob,
  MaintenanceJobResult,
} from "./registry"

/**
 * #1285 — (re)send the "your courier changed" email for an order.
 *
 * WHY A JOB
 * ---------
 * The email is sent by `cancel-shipment`, and it is BEST-EFFORT by design: the
 * waybill is already cancelled at the carrier by the time it runs, so failing
 * the whole operation because the template row is missing would report "cancel
 * failed" for a cancel that definitively succeeded. The consequence is that a
 * cancel can succeed while the customer is never told — which is exactly what
 * happened to order 83, whose courier changed from Delhivery to Blue Dart on
 * 2026-08-14 with no email sent. There was no way to send it afterwards short
 * of cancelling something else.
 *
 * This job is that missing path. It reuses `notifyCustomerOfCarrierChange`
 * rather than re-rendering the template, so it inherits the deliberate decision
 * NOT to leak the operator's free-text reason — that text is an internal audit
 * trail and can name partners, costs or blame. The customer gets the fact and
 * the promise.
 *
 * ⚠️ SENDING IS NOT REVERSIBLE. Dry-run (the default) resolves the order and
 * reports exactly who would be emailed, without sending. Nothing is written to
 * the order either way — this job only sends.
 */

const paramsSchema = z.object({
  order_id: z.string().min(1),
  /**
   * The carrier being moved AWAY from, named in the email. Optional: the
   * template copes with an empty value, and guessing it wrong is worse than
   * omitting it.
   */
  previous_carrier: z.string().min(1).optional(),
})

export const sendCourierChangedEmailJob: MaintenanceJob = {
  id: "send-courier-changed-email",
  label: "Send the courier-changed email for an order (#1285)",
  description:
    "(Re)send the 'your courier changed' email to an order's customer. cancel-shipment sends this best-effort — it deliberately never fails a cancel over a missing template — so a courier switch can complete with the customer never told, and until now there was no way to send it afterwards. Reuses the same renderer as cancel-shipment, so the operator's internal reason is never leaked to the customer. Dry-run reports the recipient without sending; SENDING IS NOT REVERSIBLE.",
  params: [
    {
      name: "order_id",
      type: "string",
      required: true,
      description: "Order whose customer should be emailed",
    },
    {
      name: "previous_carrier",
      type: "string",
      required: false,
      description:
        "Carrier being moved away from, named in the email (e.g. 'delhivery'). Omitted rather than guessed if unknown.",
    },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const parsed = paramsSchema.safeParse(params)
    if (!parsed.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        parsed.error.issues.map((i) => i.message).join("; ")
      )
    }
    const { order_id, previous_carrier } = parsed.data

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "order",
      filters: { id: order_id },
      fields: [
        "id",
        "display_id",
        "email",
        "customer.email",
        "customer.first_name",
        "customer.last_name",
        "shipping_address.first_name",
        "shipping_address.last_name",
      ],
    })

    const order = data?.[0]
    if (!order) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, `Order ${order_id} not found`)
    }

    const to = order.email || order.customer?.email
    if (!to) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Order ${order_id} has no email address — nobody to notify`
      )
    }

    const changes: MaintenanceChange[] = [
      {
        entity: "email",
        id: order.id,
        field: "order-courier-changed",
        before: "not sent",
        after: `would send to ${to}`,
      },
    ]

    if (dry_run) {
      return {
        job_id: "send-courier-changed-email",
        dry_run,
        applied: false,
        summary: `Would email the courier change for order #${order.display_id ?? order.id} to ${to}${previous_carrier ? ` (previous carrier: ${previous_carrier})` : ""}`,
        changes,
      }
    }

    const sent = await notifyCustomerOfCarrierChange(container, {
      order,
      carrier: previous_carrier,
    })

    if (!sent) {
      // notifyCustomerOfCarrierChange swallows its own failure by design and
      // logs the reason. Surface it as an error rather than reporting a send
      // that did not happen.
      return {
        job_id: "send-courier-changed-email",
        dry_run,
        applied: false,
        summary: `Could not send the courier-changed email for order #${order.display_id ?? order.id} — see the [cancel-shipment] warning in the logs for the reason`,
        changes: [],
        errors: [{ id: order.id, message: "notifyCustomerOfCarrierChange returned false" }],
      }
    }

    return {
      job_id: "send-courier-changed-email",
      dry_run,
      applied: true,
      summary: `Emailed the courier change for order #${order.display_id ?? order.id} to ${to}`,
      changes: [
        { ...changes[0], after: `sent to ${to}` },
      ],
    }
  },
}

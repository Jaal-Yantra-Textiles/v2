import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { sendShipmentStatusEmail } from "../../../../workflows/email/send-notification-email"

import type {
  MaintenanceChange,
  MaintenanceJob,
  MaintenanceJobResult,
} from "./registry"

/**
 * #1294 — (re)send the shipped/delivered email for a fulfillment.
 *
 * WHY A JOB
 * ---------
 * The shipped mail fires once, from the `shipment.created` subscriber, using
 * whatever labels the fulfillment held AT THAT MOMENT. If the waybill changes
 * afterwards, the customer keeps a tracking number that has stopped moving and
 * there is no path to correct it — the shipment already exists, so nothing will
 * emit `shipment.created` again.
 *
 * That is not hypothetical. **Order 79** was marked shipped on 2026-08-08 and
 * its customer was emailed the Shiprocket/SRX waybill. That booking was then
 * cancelled (three failed pickups) and the parcel went out on DTDC `N40878729`,
 * attached on 2026-08-15 — which, on the external-attach path, sent nothing.
 * The customer has been holding a dead tracking number ever since, while the
 * parcel moves under one they have never seen.
 *
 * `send-courier-changed-email` does not solve this: that mail deliberately
 * carries no AWB, because when a courier is swapped the replacement usually
 * does not exist yet. Here it does, and the number IS the message.
 *
 * The mail is rebuilt from the fulfillment's CURRENT labels, so it always
 * carries the live waybill rather than a remembered one.
 *
 * ⚠️ SENDING IS NOT REVERSIBLE. Dry-run (the default) reports the recipient AND
 * the tracking numbers that would go out — check the number before sending, as
 * a second wrong tracking mail is worse than the first. Nothing is written to
 * the order either way; this job only sends.
 */

const paramsSchema = z.object({
  /**
   * The FULFILLMENT id. Named as it is because the email workflow's
   * `shipment_id` input has always been a fulfillment id — there is no separate
   * shipment entity to point at.
   */
  fulfillment_id: z.string().min(1),
  /** Which mail to send. Defaults to the shipped one. */
  status: z.enum(["shipped", "delivered"]).optional(),
})

export const resendShipmentEmailJob: MaintenanceJob = {
  id: "resend-shipment-email",
  label: "Re-send the shipment tracking email for a fulfillment (#1294)",
  description:
    "(Re)send the shipped/delivered email for a fulfillment, rebuilt from its CURRENT labels. The shipped mail fires once from shipment.created with whatever waybill existed then, so a later carrier swap leaves the customer holding a tracking number that has stopped moving and no way to correct it. Unlike send-courier-changed-email, this one carries the actual AWB. Dry-run reports the recipient and the tracking numbers; SENDING IS NOT REVERSIBLE.",
  params: [
    {
      name: "fulfillment_id",
      type: "string",
      required: true,
      description:
        "Fulfillment whose customer should be emailed, e.g. 'ful_...'. The mail is built from this fulfillment's current labels.",
    },
    {
      name: "status",
      type: "string",
      required: false,
      description:
        "'shipped' (default) or 'delivered' — which template to send.",
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
    const { fulfillment_id } = parsed.data
    const status = parsed.data.status ?? "shipped"

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "fulfillment",
      filters: { id: fulfillment_id },
      fields: [
        "id",
        "shipped_at",
        "canceled_at",
        "labels.tracking_number",
        "labels.tracking_url",
        "order.id",
        "order.display_id",
        "order.email",
      ],
    })

    const fulfillment = data?.[0]
    if (!fulfillment) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Fulfillment ${fulfillment_id} not found`
      )
    }

    const order = fulfillment.order
    if (!order) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Fulfillment ${fulfillment_id} is not linked to an order`
      )
    }

    const to = order.email
    if (!to) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Order ${order.id} has no email address — nobody to notify`
      )
    }

    const labels = Array.isArray(fulfillment.labels) ? fulfillment.labels : []
    const trackingNumbers = labels
      .map((l: any) => l?.tracking_number)
      .filter(Boolean)

    if (!trackingNumbers.length) {
      // The mail's entire purpose is the tracking number. Sending one with an
      // empty tracking block would be a worse silence than none at all.
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Fulfillment ${fulfillment_id} has no tracking number on any label — there is nothing to tell the customer. Attach the waybill first.`
      )
    }

    if (fulfillment.canceled_at) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Fulfillment ${fulfillment_id} is cancelled — refusing to email tracking for a parcel that is not going out.`
      )
    }

    const label = `order-shipment-${status === "delivered" ? "delivered" : "created"}`
    const changes: MaintenanceChange[] = [
      {
        entity: "email",
        id: fulfillment.id,
        field: label,
        before: "not sent",
        after: `would send to ${to} with tracking ${trackingNumbers.join(", ")}`,
      },
    ]

    if (dry_run) {
      return {
        job_id: "resend-shipment-email",
        dry_run,
        applied: false,
        summary: `Would email the ${status} notice for order #${order.display_id ?? order.id} to ${to} carrying tracking ${trackingNumbers.join(", ")}`,
        changes,
      }
    }

    await sendShipmentStatusEmail(container).run({
      input: { shipment_id: fulfillment.id, status },
    })

    return {
      job_id: "resend-shipment-email",
      dry_run,
      applied: true,
      summary: `Emailed the ${status} notice for order #${order.display_id ?? order.id} to ${to} carrying tracking ${trackingNumbers.join(", ")}`,
      changes: [
        {
          ...changes[0],
          after: `sent to ${to} with tracking ${trackingNumbers.join(", ")}`,
        },
      ],
    }
  },
}

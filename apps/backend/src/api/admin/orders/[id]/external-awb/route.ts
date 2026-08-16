import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { z } from "zod"
import { ensureOrderFulfillment } from "../../../../../workflows/orders/fulfillment-context"
import { attachExternalAwb } from "../../../../../workflows/orders/external-awb"

/**
 * POST /admin/orders/:id/external-awb
 *
 * The manual override: attach a waybill we did NOT book. For a carrier we do
 * not integrate (DTDC, India Post, a local courier), a counter booking, or a
 * waybill generated on a carrier's own portal because ours would not — which is
 * exactly where order 83 sat while Blue Dart answered with an empty 400.
 *
 * NO carrier API is called, for creation OR validation. That is the whole
 * point: `POST /admin/orders/:id/shiprocket-attach-awb` validates by looking
 * the AWB up, which hard-wires it to Shiprocket and would reject a freshly
 * created waybill anyway (Blue Dart's TnT cannot distinguish a scanless AWB
 * from a typo). The operator holding the physical waybill is the authority.
 *
 * ADMIN ONLY, matching the cancel flow: asserting that a parcel is out on a
 * carrier we cannot verify is a claim only staff should be able to make.
 */
const Body = z.object({
  awb: z.string().trim().min(1, "An AWB is required"),
  carrier: z.string().trim().min(1, "A carrier name is required"),
  /** Where a human can follow the parcel; free-form, carrier-specific. */
  tracking_url: z.string().trim().url().optional(),
  label_url: z.string().trim().url().optional(),
  /** Existing fulfillment to attach to; one is created when omitted. */
  fulfillment_id: z.string().trim().optional(),
  /** Defaults to false — attaching and handing over are different events. */
  mark_shipped: z.boolean().optional(),
  /**
   * Email the customer their tracking when `mark_shipped` is set. Defaults to
   * TRUE, matching every other shipment — this path used to be silent, which is
   * how order 79 shipped without its customer ever being told. Pass false for a
   * back-fill, where the customer already has the details.
   */
  notify_customer: z.boolean().optional(),
  /** Why this was booked outside the system. Kept in the audit trail. */
  notes: z.string().trim().max(500).optional(),
  /**
   * What the waybill cost. Omit when unknown — a blank must not read as free,
   * so absence leaves the freight ledger untouched while 0 records free
   * shipping. Negative is rejected: a refund is a reversal, not a charge.
   */
  shipping_amount: z.number().nonnegative().optional(),
  /** Currency of `shipping_amount`; defaults to the order's currency. */
  shipping_currency_code: z.string().trim().length(3).optional(),
  /**
   * The FX rate actually paid, when the charge is in another currency. Beats
   * the cached market rate, which is the fallback — only the rate you were
   * billed at reconciles against a bank statement.
   */
  shipping_fx_rate: z.number().positive().optional(),
})

/** The logged-in admin's email, recorded on the attachment. */
const resolveActorEmail = async (
  req: MedusaRequest
): Promise<string | undefined> => {
  try {
    const actorId = (req as any).auth_context?.actor_id
    if (!actorId) return undefined
    const userService: any = req.scope.resolve(Modules.USER)
    const user = await userService.retrieveUser(actorId)
    return user?.email
  } catch {
    return undefined
  }
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const orderId = req.params.id
  const body = Body.parse((req.body as Record<string, unknown>) ?? {})

  const fulfillmentId =
    body.fulfillment_id || (await ensureOrderFulfillment(req.scope, orderId))

  const result = await attachExternalAwb(req.scope, {
    orderId,
    fulfillmentId,
    awb: body.awb,
    carrier: body.carrier,
    trackingUrl: body.tracking_url,
    labelUrl: body.label_url,
    markShipped: body.mark_shipped === true,
    notifyCustomer: body.notify_customer,
    notes: body.notes,
    actingEmail: await resolveActorEmail(req),
    shippingAmount: body.shipping_amount,
    shippingCurrencyCode: body.shipping_currency_code,
    shippingFxRate: body.shipping_fx_rate,
  })

  res.status(200).json({ external_awb: result })
}

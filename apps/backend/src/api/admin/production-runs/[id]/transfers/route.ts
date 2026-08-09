import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { FULLFILLED_ORDERS_MODULE } from "../../../../../modules/fullfilled_orders"
import { createProductionRunTransfer } from "../../../../../workflows/production-runs/create-production-run-transfer"

/**
 * Admin goods movement for a production run (#891).
 *
 *   POST /admin/production-runs/:id/transfers  — move the run's output onwards
 *   GET  /admin/production-runs/:id/transfers  — the hops so far
 *
 * The partner route (`/partners/production-runs/:id/transfers`) mirrors this
 * one; admin can move any run's output, and gets carrier-account errors phrased
 * for someone who can actually open the carrier dashboard.
 */

const CreateTransferSchema = z.object({
  to_location_id: z.string().min(1),
  from_location_id: z.string().optional(),
  reason: z
    .enum(["finishing", "qc", "packaging", "stock", "customer", "other"])
    .optional(),
  quantity: z.number().positive().optional(),
  /** Omit to record the hop without booking a carrier. */
  carrier: z.string().optional(),
  weight_grams: z.number().positive().optional(),
  dimensions_cm: z
    .object({
      length: z.number().positive().optional(),
      width: z.number().positive().optional(),
      breadth: z.number().positive().optional(),
      height: z.number().positive().optional(),
    })
    .optional(),
  preferred_courier_id: z.union([z.string(), z.number()]).optional(),
  notes: z.string().optional(),
})

export const POST = async (
  req: MedusaRequest & { params: { id: string } },
  res: MedusaResponse
) => {
  const parsed = CreateTransferSchema.safeParse(
    (req as any).validatedBody || req.body || {}
  )
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Invalid body: ${parsed.error.issues.map((i) => i.message).join(", ")}`
    )
  }
  const body = parsed.data

  const transfer = await createProductionRunTransfer(req.scope, {
    productionRunId: req.params.id,
    toLocationId: body.to_location_id,
    fromLocationId: body.from_location_id,
    reason: body.reason,
    quantity: body.quantity,
    carrier: body.carrier,
    weightGrams: body.weight_grams,
    dimensionsCm: body.dimensions_cm as any,
    preferredCourierId: body.preferred_courier_id,
    notes: body.notes,
    actingEmail: (req as any).auth_context?.app_metadata?.user_email,
  })

  res.status(200).json({ goods_transfer: transfer })
}

export const GET = async (
  req: MedusaRequest & { params: { id: string } },
  res: MedusaResponse
) => {
  const service: any = req.scope.resolve(FULLFILLED_ORDERS_MODULE)
  const transfers = await service.listGoodsTransfers(
    { production_run_id: req.params.id },
    { order: { created_at: "DESC" } }
  )

  res.status(200).json({ goods_transfers: transfers })
}

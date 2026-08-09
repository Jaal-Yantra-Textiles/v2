import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { PRODUCTION_RUNS_MODULE } from "../../../../../modules/production_runs"
import { FULLFILLED_ORDERS_MODULE } from "../../../../../modules/fullfilled_orders"
import { createProductionRunTransfer } from "../../../../../workflows/production-runs/create-production-run-transfer"

/**
 * Partner-facing goods movement for a production run (#891).
 *
 *   POST /partners/production-runs/:id/transfers  — move the output onwards
 *   GET  /partners/production-runs/:id/transfers  — the hops so far
 *
 * This is the partner's "move shipment to the next location" action: the run is
 * where the goods physically are, and finishing a run is the moment its output
 * either travels on (to an embroiderer, a QC/packaging warehouse) or parks as
 * stock. Mirrors the admin route exactly (feedback_partner_api_mirrors_admin);
 * the only difference is ownership and error wording.
 *
 * The carrier is optional — a van run between two of our own locations is a
 * real movement with no AWB, and refusing to record it would just push the
 * truth back out of the system.
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

/** 404 (never 403) for a run that isn't this partner's — don't confirm it exists. */
async function assertPartnerOwnsRun(
  req: AuthenticatedMedusaRequest,
  runId: string,
  partnerId: string
) {
  const runService: any = req.scope.resolve(PRODUCTION_RUNS_MODULE)
  const run = await runService.retrieveProductionRun(runId).catch(() => null)
  if (!run || (run.partner_id !== partnerId && run.sub_partner_id !== partnerId)) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Production run ${runId} not found`
    )
  }
  return run
}

export async function POST(
  req: AuthenticatedMedusaRequest & { params: { id: string } },
  res: MedusaResponse
) {
  const partnerId = req.auth_context?.actor_id
  if (!partnerId) {
    return res
      .status(401)
      .json({ error: "Partner authentication required - no actor ID" })
  }

  await assertPartnerOwnsRun(req, req.params.id, partnerId)

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
    // Carrier-account failures must read as something a partner can act on.
    audience: "partner",
  })

  return res.status(200).json({ goods_transfer: transfer })
}

export async function GET(
  req: AuthenticatedMedusaRequest & { params: { id: string } },
  res: MedusaResponse
) {
  const partnerId = req.auth_context?.actor_id
  if (!partnerId) {
    return res
      .status(401)
      .json({ error: "Partner authentication required - no actor ID" })
  }

  await assertPartnerOwnsRun(req, req.params.id, partnerId)

  const service: any = req.scope.resolve(FULLFILLED_ORDERS_MODULE)
  const transfers = await service.listGoodsTransfers(
    { production_run_id: req.params.id },
    { order: { created_at: "DESC" } }
  )

  return res.status(200).json({ goods_transfers: transfers })
}

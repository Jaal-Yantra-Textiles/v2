import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { recreateProductionRunWorkflow } from "../../../../workflows/production-runs/recreate-production-run"
import type { AdminRecreateProductionRunReq } from "./validators"

export const POST = async (
  req: MedusaRequest<AdminRecreateProductionRunReq>,
  res: MedusaResponse
) => {
  const body = (req as any).validatedBody || req.body

  if (!body.designs?.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "At least one design is required"
    )
  }

  if (!body.partner_id) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "A partner must be selected"
    )
  }

  const { result, errors } = await recreateProductionRunWorkflow(req.scope).run({
    input: {
      designs: body.designs,
      partner_id: body.partner_id,
      run_type: body.run_type || "production",
      notes: body.notes,
      metadata: body.metadata,
    },
  })

  if (errors?.length) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `Failed to create recreation production run: ${errors
        .map((e: any) => e?.error?.message || String(e))
        .join(", ")}`
    )
  }

  return res.status(201).json({
    production_run: result.parent,
    children: result.children,
  })
}

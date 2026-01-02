import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import {
  createProductionRunWorkflow,
} from "../../../workflows/production-runs/create-production-run"
import { PRODUCTION_RUNS_MODULE } from "../../../modules/production_runs"
import type ProductionRunService from "../../../modules/production_runs/service"

import type { AdminCreateProductionRunReq } from "./validators"

export const POST = async (
  req: MedusaRequest<AdminCreateProductionRunReq>,
  res: MedusaResponse
) => {
  const body = (req as any).validatedBody || req.body

  const { result, errors } = await createProductionRunWorkflow(req.scope).run({
    input: {
      design_id: body.design_id,
      partner_id: body.partner_id ?? null,
      quantity: body.quantity,
      product_id: body.product_id,
      variant_id: body.variant_id,
      order_id: body.order_id,
      order_line_item_id: body.order_line_item_id,
      metadata: body.metadata,
    },
  })

  if (errors?.length) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `Failed to create production run: ${errors
        .map((e: any) => e?.error?.message || String(e))
        .join(", ")}`
    )
  }

  return res.status(201).json({ production_run: result })
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const productionRunService: ProductionRunService = req.scope.resolve(
    PRODUCTION_RUNS_MODULE
  )

  const runs = await productionRunService.listProductionRuns({} as any)

  return res.status(200).json({ production_runs: runs, count: runs.length })
}

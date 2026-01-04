import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import {
  createProductionRunWorkflow,
} from "../../../workflows/production-runs/create-production-run"

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
  const q = req.query as any
  const limit = Number(q.limit) || 20
  const offset = Number(q.offset) || 0

  const filters: any = {}
  if (q.design_id) {
    filters.design_id = q.design_id
  }
  if (q.status) {
    filters.status = q.status
  }
  if (q.partner_id) {
    filters.partner_id = q.partner_id
  }
  if (q.parent_run_id) {
    filters.parent_run_id = q.parent_run_id
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: runs, metadata } = await query.graph({
    entity: "production_runs",
    fields: ["*"],
    filters,
    pagination: { skip: offset, take: limit },
  })

  const list = runs || []

  return res.status(200).json({
    production_runs: list,
    count: (metadata as any)?.count ?? list.length,
    limit,
    offset,
  })
}

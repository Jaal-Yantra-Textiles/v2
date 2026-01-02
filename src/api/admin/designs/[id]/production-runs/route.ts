import { MedusaRequest, MedusaResponse, refetchEntity } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"

import { createProductionRunWorkflow } from "../../../../../workflows/production-runs/create-production-run"
import { approveProductionRunWorkflow } from "../../../../../workflows/production-runs/approve-production-run"

import type { AdminCreateDesignProductionRunReq } from "./validators"

export const POST = async (
  req: MedusaRequest<AdminCreateDesignProductionRunReq>,
  res: MedusaResponse
) => {
  const { id: designId } = req.params

  const designExists = await refetchEntity({
    entity: "design",
    idOrFilter: designId,
    scope: req.scope,
    fields: ["id"],
  })

  if (!designExists) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Design with id ${designId} was not found`
    )
  }

  const body = (req as any).validatedBody || req.body
  const assignments = (body.assignments || []) as any[]

  let parentQuantity: number | undefined = body.quantity

  if (assignments.length) {
    const missingQty = assignments.some((a) => typeof a.quantity !== "number")
    if (missingQty) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "All assignments must include quantity"
      )
    }

    const total = assignments.reduce(
      (sum, a) => sum + (Number(a.quantity) || 0),
      0
    )

    if (body.quantity != null && Number(body.quantity) !== total) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Assignments quantity sum (${total}) must match parent quantity (${body.quantity})`
      )
    }

    parentQuantity = parentQuantity ?? total
  }

  const { result: createdRun, errors } = await createProductionRunWorkflow(
    req.scope
  ).run({
    input: {
      design_id: designId,
      partner_id: null,
      quantity: parentQuantity,
      metadata: {
        source: "admin.designs.manual",
      },
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

  if (!assignments.length) {
    return res.status(201).json({ production_run: createdRun })
  }

  const { result: approved } = await approveProductionRunWorkflow(req.scope).run({
    input: {
      production_run_id: (createdRun as any).id,
      assignments,
    },
  })

  return res.status(201).json({
    production_run: approved?.parent || createdRun,
    children: approved?.children || [],
  })
}

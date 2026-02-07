
/**
 * POST /admin/designs/:id/production-runs
 *
 * Create a production run for a design and optionally approve it with assignments.
 *
 * Behavior:
 * - Verifies the design with the given `id` exists.
 * - Validates `assignments` (if provided): every assignment must include a numeric `quantity`.
 * - If `assignments` are provided and the parent `quantity` is provided, the sum of assignment
 *   quantities must equal the parent quantity.
 * - Creates a production run via createProductionRunWorkflow.
 * - If assignments are provided, runs approveProductionRunWorkflow on the created run so that
 *   the parent run and child assignments are created/approved in a single operation.
 * - Returns HTTP 201 with the created/approved production run information.
 *
 * @param req - MedusaRequest<AdminCreateDesignProductionRunReq> request object. URL param: `id` = design id.
 *                  Body shape (validated):
 *                  {
 *                    quantity?: number,
 *                    assignments?: Array<{
 *                      partner_id?: string | null,
 *                      quantity: number,
 *                      metadata?: Record<string, any>
 *                    }>,
 *                    metadata?: Record<string, any>
 *                  }
 * @param res - MedusaResponse used to send the 201 JSON response.
 *
 * @returns HTTP 201 JSON:
 * - When no `assignments` are provided:
 *   { production_run: { /* created run object *\/} }
 * - When `assignments` are provided:
 *   {
 *     production_run: { /* approved parent run (or created parent) *\/ },
 *     children: [ /* array of approved child runs (assignments) *\/ ]
 *   }
 *
 * @throws MedusaError.Types.NOT_FOUND if the design with `id` does not exist.
 * @throws MedusaError.Types.INVALID_DATA if assignments are missing `quantity` or sums mismatch.
 * @throws MedusaError.Types.UNEXPECTED_STATE if the creation workflow returns errors.
 *
 * @example Create a simple production run (no assignments)
 * Request:
 * {
 *   "quantity": 10,
 *   "metadata": { "source": "admin.designs.manual" }
 * }
 * Response (201):
 * {
 *   "production_run": {
 *     "id": "run_abc123",
 *     "design_id": "design_xyz",
 *     "quantity": 10,
 *     "metadata": { "source": "admin.designs.manual" },
 *     /* ...other run fields... *\/ 
 *   }
 * }
 *
 * @example Create and approve with assignments (parent quantity provided)
 * Request:
 * {
 *   "quantity": 10,
 *   "assignments": [
 *     { "partner_id": "partner_1", "quantity": 4 },
 *     { "partner_id": "partner_2", "quantity": 6 }
 *   ]
 * }
 * Response (201):
 * {
 *   "production_run": {
 *     "id": "run_parent_123",
 *     "design_id": "design_xyz",
 *     "quantity": 10,
 *     /* approved parent run fields *\/
 *   },
 *   "children": [
 *     { "id": "run_child_1", "parent_id": "run_parent_123", "partner_id": "partner_1", "quantity": 4 },
 *     { "id": "run_child_2", "parent_id": "run_parent_123", "partner_id": "partner_2", "quantity": 6 }
 *   ]
 * }
 *
 * @example Create with assignments but without parent quantity (parent quantity inferred)
 * Request:
 * {
 *   "assignments": [
 *     { "partner_id": "p1", "quantity": 3 },
 *     { "partner_id": "p2", "quantity": 2 }
 *   ]
 * }
 * Response (201):
 * {
 *   "production_run": { "id": "run_parent_456", "quantity": 5, /* ... *\/ },
 *   "children": [ /* children for p1 and p2 *\/ ]
 * }
 */
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

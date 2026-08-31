
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
 *                      template_ids?: string[],
 *                      template_names?: string[],
 *                      metadata?: Record<string, any>
 *                    }>,
 *                    // Used ONLY for assignments this route builds itself from
 *                    // the design's linked partners; ignored when `assignments`
 *                    // are supplied.
 *                    template_ids?: string[],
 *                    template_names?: string[],
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
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import { createProductionRunWorkflow } from "../../../../../workflows/production-runs/create-production-run"
import { approveProductionRunWorkflow } from "../../../../../workflows/production-runs/approve-production-run"
import { autoDispatchApprovedChildren } from "../../../production-runs/auto-dispatch-approved-children"

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
  let assignments = (body.assignments || []) as any[]

  // Auto-populate from linked partners if no assignments provided
  if (!assignments.length) {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any
    const { data: designs } = await query.graph({
      entity: "design",
      filters: { id: designId },
      fields: ["partners.id", "partners.name"],
    })
    const linkedPartners = designs?.[0]?.partners || []

    if (linkedPartners.length && body.quantity != null) {
      // Single partner: assign full quantity
      // Multiple partners: split equally (admin can adjust via explicit assignments)
      const perPartner = Math.ceil(Number(body.quantity) / linkedPartners.length)
      assignments = linkedPartners.map((p: any, idx: number) => ({
        partner_id: p.id,
        quantity: idx === linkedPartners.length - 1
          ? Number(body.quantity) - perPartner * (linkedPartners.length - 1)
          : perPartner,
        // Ids where given — a name may match two templates and be refused at
        // dispatch (#1261). Both are passed through; the approval records
        // whichever it was told, and dispatch prefers the ids.
        template_ids: body.template_ids || [],
        template_names: body.template_names || [],
      }))
    } else if (linkedPartners.length && body.quantity === null) {
      /**
       * An OPEN-ENDED parent (#1676). There is no quantity to split, so every
       * linked partner gets an open-ended share rather than none at all —
       * without this branch the run would be created with no children, which
       * looks like the same request quietly doing less.
       */
      assignments = linkedPartners.map((p: any) => ({
        partner_id: p.id,
        quantity: null,
        template_ids: body.template_ids || [],
        template_names: body.template_names || [],
      }))
    }
  }

  /**
   * ⚠️ Three states, not two (#1676): a number, `undefined` (infer it), and
   * `null` (there is NO agreed quantity — an open-ended run, outside the
   * payment ceiling). `parentQuantity ?? total` collapsed the last two, which
   * would have silently un-declared open-endedness by filling in the sum.
   */
  const statedQuantity: number | null | undefined = body.quantity
  let parentQuantity: number | null | undefined = statedQuantity

  if (assignments.length) {
    const missingQty = assignments.some(
      (a) => a.quantity !== null && typeof a.quantity !== "number"
    )
    if (missingQty) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "All assignments must include quantity, or null for an open-ended one"
      )
    }

    const anyOpenEnded = assignments.some((a) => a.quantity === null)
    const total = assignments.reduce(
      (sum, a) => sum + (Number(a.quantity) || 0),
      0
    )

    /**
     * The sum rule only applies when every share is a number. One open-ended
     * child makes the total unknowable — refusing on a sum that cannot be
     * computed would just be refusing the feature.
     */
    if (
      statedQuantity != null &&
      !anyOpenEnded &&
      Number(statedQuantity) !== total
    ) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Assignments quantity sum (${total}) must match parent quantity (${statedQuantity})`
      )
    }

    if (statedQuantity === undefined) {
      // Inferred, as before — except that an open-ended child makes the parent
      // open-ended too rather than understating it by that child's share.
      parentQuantity = anyOpenEnded ? null : total
    }
  }

  const { result: createdRun, errors } = await createProductionRunWorkflow(
    req.scope
  ).run({
    input: {
      design_id: designId,
      partner_id: null,
      quantity: parentQuantity,
      run_type: body.run_type || "production",
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

  // See `autoDispatchApprovedChildren` — a dispatch failure is reported, not
  // thrown, because the approval above has already committed (#1268).
  const dispatch = await autoDispatchApprovedChildren(
    req.scope,
    (approved?.children || []) as any
  )

  return res.status(201).json({
    production_run: approved?.parent || createdRun,
    children: approved?.children || [],
    dispatch,
  })
}

/**
 * @file Partner-originated production runs
 * @description Roadmap #6 Phase 4 — a partner creates a SELF-APPROVED
 * production run for their OWN design and runs production themselves
 * (in_house) or farms it out to a sub-partner (outsourced).
 *
 * The creating partner is the run's `partner_id` (originator + lifecycle
 * driver). `execution_mode` + `sub_partner_id` are recorded structurally
 * so cost tracking can isolate self-made vs outsourced work. For
 * outsourced runs we also mirror the design→sub-partner link so the
 * vendor can see the design. NOTE (Phase 4b follow-up): full vendor-side
 * execution handoff — the sub-partner accepting/working an outsourced
 * run via the partner lifecycle endpoints — is not yet wired; today the
 * originating partner drives the lifecycle.
 *
 * @module API/Partners/Designs/ProductionRuns
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import { createProductionRunWorkflow } from "../../../../../workflows/production-runs/create-production-run"
import { linkDesignPartnerWorkflow } from "../../../../../workflows/designs/partner/link-design-to-partner"
import { assertPartnerOwnsDesign } from "../../helpers"
import { PartnerCreateProductionRunReq } from "./validators"

export async function POST(
  req: AuthenticatedMedusaRequest<PartnerCreateProductionRunReq> & {
    params: { designId: string }
  },
  res: MedusaResponse
) {
  const { designId } = req.params
  const { partner } = await assertPartnerOwnsDesign(req, designId)

  const body = req.validatedBody

  const { result: createdRun, errors } = await createProductionRunWorkflow(
    req.scope
  ).run({
    input: {
      design_id: designId,
      // Originator + lifecycle driver.
      partner_id: partner.id,
      quantity: body.quantity ?? 1,
      run_type: body.run_type ?? "production",
      // Self-approved AND self-started: a partner running their own
      // production owns the decision (no admin gate) and is ready to
      // work it immediately — so it enters `in_progress`, which also
      // unlocks consumption logging + completion via the existing
      // partner lifecycle endpoints. (The dispatch→accept dance only
      // applies to admin-assigned runs.)
      status: "in_progress",
      execution_mode: body.execution_mode,
      sub_partner_id:
        body.execution_mode === "outsourced" ? body.sub_partner_id : null,
      metadata: {
        ...(body.metadata ?? {}),
        source: "partner.self_serve",
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

  // Outsourced: let the sub-partner see the design (the run carries
  // sub_partner_id; mirroring the design link surfaces it on their
  // /partners/designs). Idempotent on the (design, partner) pair.
  if (body.execution_mode === "outsourced" && body.sub_partner_id) {
    try {
      await linkDesignPartnerWorkflow(req.scope).run({
        input: { design_id: designId, partner_ids: [body.sub_partner_id] },
      })
    } catch {
      // Non-fatal — the run is created; link mirror is best-effort.
    }
  }

  res.status(201).json({ production_run: createdRun })
}

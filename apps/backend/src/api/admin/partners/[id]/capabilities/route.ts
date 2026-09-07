/**
 * @file Admin read/write for a partner's capability library (#1531).
 * @description The partner's photographs of what they have actually made,
 *   with the textile facts beside them — surfaced for an operator so the
 *   admin assistant can answer "what can this partner produce" and file
 *   evidence from a conversation, without waiting for the partner to run
 *   the wizard themselves.
 * @module API/Admin/Partners/Capabilities
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { listPartnerCapabilitiesWorkflow } from "../../../../../workflows/partner/list-partner-capabilities"
import { createPartnerCapabilityWorkflow } from "../../../../../workflows/partner/create-partner-capability"
import type {
  AdminListPartnerCapabilitiesQuery,
  AdminCreatePartnerCapabilityReq,
} from "./validators"

/**
 * GET /admin/partners/:id/capabilities
 *
 * Mirrors GET /partners/capabilities, with the partner named in the URL rather
 * than derived from the auth context. Returns the library newest-first by
 * captured_at, filterable by technique and material.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id: partnerId } = req.params
  const validated = ((req as any).validatedQuery || req.query ||
    {}) as AdminListPartnerCapabilitiesQuery

  const { result } = await listPartnerCapabilitiesWorkflow(req.scope).run({
    input: {
      partner_id: partnerId,
      technique: validated.technique,
      material: validated.material,
      limit: validated.limit,
      offset: validated.offset,
    },
  })

  return res.json({ samples: result.samples, count: result.count })
}

/**
 * POST /admin/partners/:id/capabilities — file a sample on the partner's behalf.
 *
 * Same shape as POST /partners/capabilities with two deliberate differences:
 * `partner_id` comes from the URL rather than the auth context, and the
 * workflow stamps `source: "admin"` — someone typing up a conversation, which
 * the model distinguishes from the partner's own structured answer.
 *
 * 🔑 `captured_at` defaults to now and SAYS SO in the response, for the same
 * reason as the partner route: silence would make every back-filled row look
 * fresh, and the library is only worth searching if it admits how stale it is.
 */
export const POST = async (
  req: MedusaRequest<AdminCreatePartnerCapabilityReq>,
  res: MedusaResponse
) => {
  const { id: partnerId } = req.params
  const body = ((req as any).validatedBody ||
    req.body) as AdminCreatePartnerCapabilityReq

  const { result, errors } = await createPartnerCapabilityWorkflow(
    req.scope
  ).run({
    input: {
      partner_id: partnerId,
      title: body.title,
      technique: body.technique ?? null,
      material: body.material ?? null,
      media_file_ids: body.media_file_ids,
      notes: body.notes ?? null,
      captured_at: body.captured_at ?? null,
    },
  })

  if (errors?.length) {
    throw (
      errors[0].error ||
      new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Failed to create capability sample"
      )
    )
  }

  return res.status(201).json({
    sample: result.sample,
    captured_at_defaulted: !body.captured_at,
  })
}

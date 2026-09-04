import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import type { Link } from "@medusajs/framework/modules-sdk"

import { extractPersonFromIdWorkflow } from "../../../../workflows/ai/extract-person-from-id"
import { getPartnerFromAuthContext } from "../../helpers"
import { PARTNER_MODULE } from "../../../../modules/partner"
import { PERSON_MODULE } from "../../../../modules/person"
import type { PartnerIdExtractionReqType } from "./validators"

/**
 * POST /partners/people/id-extraction
 *
 * A partner photographs an artisan's ID card and gets a person on their own
 * roster. Same reading and the same masking policy as the admin route; the
 * difference is who it belongs to.
 *
 * 🔴 The partner comes from the AUTHENTICATED ACTOR, never from the body. The
 * validator has no `partner_id` field at all, so there is nothing to spoof —
 * and a route that took one would be a cross-tenant write waiting to happen.
 *
 * ⚠️ A new partner route 401s until `middlewares.ts` names it. Auth here is
 * per-route, and neither tsc nor a green suite will tell you.
 */
export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const body = (req.validatedBody ?? req.body) as PartnerIdExtractionReqType

  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner?.id) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "No partner is associated with this session."
    )
  }

  if (body.persist && !body.confirm) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Creating a person from an identity document requires confirm:true alongside persist:true. Read it without persist first and check the draft."
    )
  }

  const { result } = await extractPersonFromIdWorkflow(req.scope).run({
    input: {
      image_url: body.image_url,
      notes: body.notes ?? null,
      id_number_policy: body.id_number_policy ?? "mask",
      persist: Boolean(body.persist),
      partner_id: partner.id,
      person_type_ids: body.person_type_ids ?? null,
    },
  })

  const out = result as any

  /**
   * The link is what makes this the PARTNER's person rather than a floating
   * record. Reported rather than rolled back: a person read correctly should
   * not be destroyed because an association failed, but an unlinked person is
   * invisible on the partner's roster, so the caller has to be told.
   */
  let linked = false
  let link_error: string | null = null

  if (out.person?.id) {
    try {
      const link: Link = req.scope.resolve(ContainerRegistrationKeys.LINK)
      await link.create({
        [PARTNER_MODULE]: { partner_id: partner.id },
        [PERSON_MODULE]: { person_id: out.person.id },
      })
      linked = true
    } catch (e: any) {
      link_error = e?.message ?? String(e)
    }
  }

  return res.status(out.persisted ? 201 : 200).json({
    message: out.persisted
      ? linked
        ? "Person created and added to your people."
        : "Person created, but could not be added to your people — see link_error."
      : "Document read. Nothing was created.",
    draft: out.draft,
    person: out.person ?? null,
    persisted: out.persisted,
    not_persisted_reason: out.not_persisted_reason,
    linked,
    link_error,
    model: out.model,
  })
}

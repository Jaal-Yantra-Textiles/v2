import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import type { Link } from "@medusajs/framework/modules-sdk"

import { extractPersonFromIdWorkflow } from "../../../../workflows/ai/extract-person-from-id"
import { PARTNER_MODULE } from "../../../../modules/partner"
import { PERSON_MODULE } from "../../../../modules/person"
import type { AdminIdExtractionReqType } from "./validators"

/**
 * POST /admin/people/id-extraction
 *
 * Read a photographed identity document and, on request, create the person.
 *
 * ## Preview, then create — two calls, never one
 *
 * `persist:false` (the default) reads the card and returns a draft with its
 * warnings; `persist:true` **and** `confirm:true` creates. The operator sees
 * what a machine made of a photograph of someone's legal document before a row
 * exists, which is the same discipline `extract_inventory_from_image` (#769)
 * established for stock — and this is a person, not a bale of cloth.
 *
 * ## 🔴 What is kept
 *
 * The ID number is masked to its last four digits and the card's type. Nothing
 * here verifies an identity, and `metadata.id_document.verified` is written
 * `false` so no later reader mistakes a photo for KYC. See
 * `lib/people/id-card.ts` for why full retention is not an option on this
 * route.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = (req.validatedBody ?? req.body) as AdminIdExtractionReqType

  if (body.persist && !body.confirm) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Creating a person from an identity document requires confirm:true alongside persist:true. Run it without persist first and show the operator the draft."
    )
  }

  const { result } = await extractPersonFromIdWorkflow(req.scope).run({
    input: {
      image_url: body.image_url,
      notes: body.notes ?? null,
      id_number_policy: body.id_number_policy ?? "mask",
      persist: Boolean(body.persist),
      partner_id: body.partner_id ?? null,
      person_type_ids: body.person_type_ids ?? null,
    },
  })

  const out = result as any

  /**
   * Linking is done here rather than in the workflow because a partner link is
   * an admin-side association, and a failure to link must not roll back a
   * person who was read correctly. It is reported instead.
   */
  let linked_partner_id: string | null = null
  let link_error: string | null = null

  if (out.person?.id && body.partner_id) {
    try {
      const link: Link = req.scope.resolve(ContainerRegistrationKeys.LINK)
      // Same shape the existing /admin/partners/:id/people route uses — a
      // single object, not an array.
      await link.create({
        [PARTNER_MODULE]: { partner_id: body.partner_id },
        [PERSON_MODULE]: { person_id: out.person.id },
      })
      linked_partner_id = body.partner_id
    } catch (e: any) {
      link_error = e?.message ?? String(e)
    }
  }

  return res.status(out.persisted ? 201 : 200).json({
    message: out.persisted
      ? "Person created from the identity document."
      : "Document read. Nothing was created.",
    draft: out.draft,
    person: out.person ?? null,
    persisted: out.persisted,
    not_persisted_reason: out.not_persisted_reason,
    linked_partner_id,
    link_error,
    model: out.model,
  })
}

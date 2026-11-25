import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { buildBriefView } from "../../../../../../modules/partner-quote/lib/brief-view"
import { updateQuoteBriefChoiceWorkflow } from "../../../../../../workflows/partner-quote/update-quote-brief-choice"
import type { AdminUpdateQuoteBriefChoiceReqType } from "../../../validators"

/**
 * #2608 — attach, swap or clear a partner's rate (and samples / note) on one
 * choice of a brief. The buyer's estimate picks it up on her next view; this
 * sends her nothing. The rate must belong to the choice's partner.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  await updateQuoteBriefChoiceWorkflow(req.scope).run({
    input: {
      ...(req.validatedBody as AdminUpdateQuoteBriefChoiceReqType),
      brief_id: req.params.id,
      choice_id: req.params.choiceId,
    },
  })
  res.json({ brief: await buildBriefView(req.scope, req.params.id, { audience: "admin" }) })
}

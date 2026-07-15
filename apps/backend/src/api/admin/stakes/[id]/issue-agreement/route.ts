import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { issueAgreementForStake } from "../../../lib/issue-investor-agreement"

// POST /admin/stakes/:id/issue-agreement — issue (or return the already-issued)
// subscription agreement for an equity participation. Admin counterpart to
// participate-time issuance: used to backfill stakes created before the
// agreement templates existed. Idempotent — returns the existing response with
// `reused: true` rather than issuing (and re-emailing) a duplicate.
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const result = await issueAgreementForStake(req.scope, req.params.id)
  res.json(result)
}

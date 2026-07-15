import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { issueAgreementForConvertible } from "../../../lib/issue-investor-agreement"

// POST /admin/convertibles/:id/issue-agreement — issue (or return the
// already-issued) subscription agreement for a SAFE / note / CCPS participation.
// Admin counterpart to participate-time issuance; idempotent (see the stake
// twin). Used to backfill convertibles created before the agreement templates
// existed — e.g. an already-paid CCPS that never received its agreement.
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const result = await issueAgreementForConvertible(req.scope, req.params.id)
  res.json(result)
}

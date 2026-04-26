import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { commitImportMappingsWorkflow } from "../../../../../../../workflows/google_merchant/workflows/commit-import-mappings"
import type { CommitImportMapping } from "../../../../../../../workflows/google_merchant/steps/commit-import-mappings"

type Body = {
  mappings?: CommitImportMapping[]
}

export const POST = async (req: MedusaRequest<Body>, res: MedusaResponse) => {
  const mappings = req.body?.mappings
  if (!Array.isArray(mappings) || mappings.length === 0) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "mappings must be a non-empty array")
  }
  for (const m of mappings) {
    if (!m?.offer_id || !m?.product_id) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "each mapping requires offer_id and product_id"
      )
    }
  }

  const { result } = await commitImportMappingsWorkflow(req.scope).run({
    input: { account_id: req.params.id, mappings },
  })
  res.status(200).json(result)
}

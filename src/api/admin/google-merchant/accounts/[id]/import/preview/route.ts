import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { previewImportFromGoogleWorkflow } from "../../../../../../../workflows/google_merchant/workflows/preview-import-from-google"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { result } = await previewImportFromGoogleWorkflow(req.scope).run({
    input: { account_id: req.params.id },
  })
  res.status(200).json(result)
}

import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { importExistingProductsFromGoogleWorkflow } from "../../../../../../workflows/google_merchant"

type Body = { dry_run?: boolean }

export const POST = async (req: MedusaRequest<Body>, res: MedusaResponse) => {
  const { result } = await importExistingProductsFromGoogleWorkflow(req.scope).run({
    input: {
      account_id: req.params.id,
      dry_run: !!req.body?.dry_run,
    },
  })
  res.status(200).json(result)
}

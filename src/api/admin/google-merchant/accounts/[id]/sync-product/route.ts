import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { syncProductToGoogleWorkflow } from "../../../../../../workflows/google_merchant"

type Body = {
  product_id: string
  content_language?: string
  feed_label?: string
  currency_code?: string
  landing_url_base?: string
}

export const POST = async (req: MedusaRequest<Body>, res: MedusaResponse) => {
  const { product_id, content_language, feed_label, currency_code, landing_url_base } = req.body || ({} as Body)
  if (!product_id) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "product_id is required")
  }

  const { result } = await syncProductToGoogleWorkflow(req.scope).run({
    input: {
      product_id,
      account_id: req.params.id,
      content_language,
      feed_label,
      currency_code,
      landing_url_base,
    },
  })

  res.status(200).json(result)
}

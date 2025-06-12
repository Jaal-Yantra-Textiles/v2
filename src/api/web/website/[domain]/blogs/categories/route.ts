import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { fetchAllCategoriesPerSiteWorkflow } from "../../../../../../workflows/website/website-page/fetch-all-categories-per-site"

export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<MedusaResponse> {
  const { domain } = req.params
  const workflow = fetchAllCategoriesPerSiteWorkflow(req.scope)
  const { result } = await workflow.run({
    input: {
      domain,
    },
  })

  return res.json({ categories: result })
}

import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { seedDefaultPagesWorkflow } from "../../../../../workflows/website/seed-default-pages"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const websiteId = req.params.id

  const { result } = await seedDefaultPagesWorkflow(req.scope).run({
    input: { website_id: websiteId },
  })

  res.status(201).json({
    message: `Seeded ${result.pages.length} pages, skipped ${result.skipped.length} existing`,
    pages: result.pages,
    skipped: result.skipped,
  })
}

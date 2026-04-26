import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import { WEBSITE_MODULE } from "../../../../../../modules/website"
import WebsiteService from "../../../../../../modules/website/service"

/**
 * DELETE /admin/websites/:id/domains/:domainId
 * Remove an alias domain. Refuses to delete the primary — rename via PUT /admin/websites/:id instead.
 */
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id, domainId } = req.params
  const websiteService: WebsiteService = req.scope.resolve(WEBSITE_MODULE)

  const [rows] = await (websiteService as any).listAndCountWebsiteDomains(
    { id: domainId, website_id: id },
    { take: 1 }
  )
  const row = rows?.[0]
  if (!row) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Domain ${domainId} not found for website ${id}`
    )
  }
  if (row.is_primary) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "The primary domain cannot be deleted. Update the website's canonical domain instead."
    )
  }

  await (websiteService as any).softDeleteWebsiteDomains(domainId)

  res.json({ id: domainId, deleted: true })
}

import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import partnerRegionLink from "../../../../../links/partner-region"

/**
 * GET /admin/regions/:id/partner-coverage
 *
 * Surfaces how many active partners are linked to this region, used by
 * the admin region-detail widget to render "Linked to N / M partners"
 * and to know whether to expose the Share-to-all button.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const regionId = req.params.id

  const { data: regions } = await query.graph({
    entity: "region",
    filters: { id: regionId },
    fields: ["id", "name", "currency_code"],
  })
  const region = regions?.[0]
  if (!region) {
    return res.status(404).json({ message: `Region ${regionId} not found` })
  }

  const { data: partners } = await query.graph({
    entity: "partners",
    fields: ["id", "name"],
  })
  const totalPartners = (partners ?? []).length

  const { data: links } = await query.graph({
    entity: partnerRegionLink.entryPoint,
    filters: { region_id: regionId },
    fields: ["partner_id"],
  })
  const linkedPartnerIds = new Set(
    (links ?? []).map((l: any) => l.partner_id).filter(Boolean)
  )
  const unlinkedPartners = (partners ?? [])
    .filter((p: any) => !linkedPartnerIds.has(p.id))
    .map((p: any) => ({ id: p.id, name: p.name }))

  res.json({
    region,
    total_partners: totalPartners,
    linked_partners: linkedPartnerIds.size,
    unlinked_partners: unlinkedPartners,
  })
}

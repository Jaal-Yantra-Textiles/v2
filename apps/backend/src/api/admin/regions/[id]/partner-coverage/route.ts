import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import partnerRegionLink from "../../../../../links/partner-region"

/**
 * GET /admin/regions/:id/partner-coverage
 *
 * Surfaces how many active partners are linked to this region, used by
 * the admin region-detail widget to render "Linked to N / M partners"
 * and to know whether to expose the Share-to-all button.
 *
 * 🔴 Both numbers here are COUNTS, and each one has to be paged for
 * deliberately. `query.graph` with no `pagination` returns a PAGE, not the
 * table — so the previous version rendered a page size as if it were a total.
 * On prod that read "Europe 31/30": 31 linked partners out of 30 that exist,
 * a ratio above 1, because the denominator had been truncated while the
 * numerator had not. There were 31 partners at the time.
 *
 * A truncated count does not announce itself — it looks like a smaller
 * business. So page explicitly until the rows are exhausted rather than
 * trusting one call to have returned everything.
 */
const PAGE = 200
const MAX_PAGES = 100

/** Page an entity to exhaustion. Returns every row, not the first page. */
const fetchAll = async (
  query: any,
  args: { entity: string; fields: string[]; filters?: Record<string, unknown> }
): Promise<any[]> => {
  const rows: any[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data } = await query.graph({
      ...args,
      pagination: { take: PAGE, skip: page * PAGE },
    })
    const batch = data ?? []
    rows.push(...batch)
    // A short page is the last page. An exactly-full one might not be.
    if (batch.length < PAGE) {
      return rows
    }
  }
  return rows
}

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

  const partners = await fetchAll(query, {
    entity: "partners",
    fields: ["id", "name"],
  })
  const totalPartners = partners.length

  const links = await fetchAll(query, {
    entity: partnerRegionLink.entryPoint,
    filters: { region_id: regionId },
    fields: ["partner_id"],
  })

  const partnerIds = new Set(partners.map((p: any) => p.id))
  const linkedPartnerIds = new Set(
    links.map((l: any) => l.partner_id).filter(Boolean)
  )

  // A link can outlive the partner it names. Counting those in `linked` while
  // they are absent from `total` is the other half of how the ratio went past
  // 1, and it is not the same fault as the paging one — so they are separated
  // here and the orphans reported rather than quietly folded into the count.
  const orphanedLinkPartnerIds = [...linkedPartnerIds].filter(
    (id) => !partnerIds.has(id)
  )
  const linkedExistingPartnerIds = [...linkedPartnerIds].filter((id) =>
    partnerIds.has(id)
  )

  const unlinkedPartners = partners
    .filter((p: any) => !linkedPartnerIds.has(p.id))
    .map((p: any) => ({ id: p.id, name: p.name }))

  res.json({
    region,
    total_partners: totalPartners,
    linked_partners: linkedExistingPartnerIds.length,
    unlinked_partners: unlinkedPartners,
    // Surfaced rather than hidden: a non-empty list means link rows point at
    // partners that no longer exist.
    orphaned_links: orphanedLinkPartnerIds,
  })
}

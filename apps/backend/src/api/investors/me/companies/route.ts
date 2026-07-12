import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { requireInvestor } from "../../helpers"
import { COMPANY_MODULE } from "../../../../modules/company"
import type CompanyService from "../../../../modules/company/service"

// GET /investors/me/companies — the rich company profile(s) this investor is
// linked to (via the investor pipeline), for the portal's Company / Platform
// overview page. Combines the descriptive `company` entity (name, description,
// website, logo, industry, founded) + an investor-facing `profile` blob from
// metadata (tagline, github_url, pitch_deck_url, links[], highlights[]) + a
// `team` derived from the cap-table stakeholders already shared in (stakes and
// convertibles), so "team" reflects who's actually on the cap table.
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const investor = await requireInvestor(req.auth_context, req.scope)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: pipelines } = await query.graph({
    entity: "investor_pipeline",
    filters: { investor_id: investor.id },
    fields: ["company_id"],
  })
  const companyIds = [
    ...new Set((pipelines || []).map((p: any) => p.company_id).filter(Boolean)),
  ]
  if (!companyIds.length) {
    return res.json({ companies: [], count: 0 })
  }

  const companyService: CompanyService = req.scope.resolve(COMPANY_MODULE)
  const companies = await companyService.listCompanies({
    id: companyIds,
  } as any)

  // Cap tables → stakeholders, grouped by company, for the "team" section.
  const { data: capTables } = await query.graph({
    entity: "cap_tables",
    filters: { company_id: companyIds },
    fields: [
      "company_id",
      "stakes.investor.id",
      "stakes.investor.name",
      "stakes.ownership_percentage",
      "stakes.status",
      "convertibles.investor.id",
      "convertibles.investor.name",
    ],
  })

  // Build a distinct stakeholder list per company. A person can hold several
  // stakes; sum ownership and keep one row. Convertible holders are included
  // (no equity % yet) so early SAFE/CCPS backers still show as team.
  const teamByCompany = new Map<string, Map<string, any>>()
  for (const ct of capTables || []) {
    const cid = ct.company_id
    if (!cid) continue
    const map = teamByCompany.get(cid) ?? new Map<string, any>()
    const add = (inv: any, ownership?: number | null) => {
      const id = inv?.id
      if (!id) return
      const existing = map.get(id)
      const own = Number(ownership ?? 0) || 0
      if (existing) {
        existing.ownership_percentage =
          (Number(existing.ownership_percentage) || 0) + own
      } else {
        map.set(id, {
          id,
          name: inv?.name ?? "Investor",
          ownership_percentage: own,
          is_me: id === investor.id,
        })
      }
    }
    for (const s of ct.stakes || []) add(s?.investor, s?.ownership_percentage)
    for (const c of ct.convertibles || []) add(c?.investor, null)
    teamByCompany.set(cid, map)
  }

  const result = (companies || []).map((c: any) => {
    const meta = c.metadata || {}
    const team = [...(teamByCompany.get(c.id)?.values() ?? [])].sort(
      (a, b) =>
        (Number(b.ownership_percentage) || 0) -
        (Number(a.ownership_percentage) || 0)
    )
    return {
      id: c.id,
      name: c.name,
      legal_name: c.legal_name,
      website: c.website,
      logo_url: c.logo_url,
      industry: c.industry,
      description: c.description,
      founded_date: c.founded_date,
      status: c.status,
      profile: {
        tagline: meta.tagline ?? null,
        github_url: meta.github_url ?? null,
        pitch_deck_url: meta.pitch_deck_url ?? null,
        // Freeform labelled links: [{ label, url }]
        links: Array.isArray(meta.links) ? meta.links : [],
        // Bullet highlights of what the team is building.
        highlights: Array.isArray(meta.highlights) ? meta.highlights : [],
      },
      team,
    }
  })

  res.json({ companies: result, count: result.length })
}

import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createTaxRegionsWorkflow } from "@medusajs/medusa/core-flows"
import { validatePartnerStoreAccess, getPartnerFromAuthContext } from "../../../helpers"
import partnerRegionLink from "../../../../../links/partner-region"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { store } = await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Get all regions linked to this partner
  const { data: links } = await query.graph({
    entity: partnerRegionLink.entryPoint,
    filters: { partner_id: partner!.id },
    fields: ["region_id", "region.countries.iso_2"],
  })

  // Collect all country codes from partner's regions.
  // Lowercase defensively: partner-ui dropdowns sometimes send "IN" /
  // "US" while Medusa stores `country.iso_2` lowercase. Without the
  // normalization here, a tax_region created with country_code: "IN"
  // never matches the filter `country_code IN ['in']` and disappears
  // from the partner table view. (Surfaced by partner-ui testing —
  // see commit message.)
  const countryCodes: string[] = []
  for (const link of links || []) {
    const countries = link.region?.countries || []
    for (const c of countries) {
      if (c.iso_2) countryCodes.push(String(c.iso_2).toLowerCase())
    }
  }

  // Also include countries from the store's default region (backwards compat)
  if (store.default_region_id) {
    const hasDefaultInLinks = (links || []).some(
      (l: any) => l.region_id === store.default_region_id
    )
    if (!hasDefaultInLinks) {
      const { data: defaultRegions } = await query.graph({
        entity: "regions",
        fields: ["countries.iso_2"],
        filters: { id: store.default_region_id },
      })
      const defaultCountries = (defaultRegions?.[0]?.countries ?? [])
        .map((c: any) => String(c.iso_2 ?? "").toLowerCase())
        .filter(Boolean)
      countryCodes.push(...defaultCountries)
    }
  }

  // Filter tax regions by partner's country codes — lowercase set so
  // the comparison matches regardless of stored case.
  const filters: Record<string, any> = {}
  if (countryCodes.length) {
    filters.country_code = [...new Set(countryCodes)]
  }

  // Pass-through filterable params from the request query so partner-ui
  // can ask focused questions like "children of this tax_region"
  // (parent_id=X) or "roots only" (parent_id="null"). Without this,
  // the backend silently dropped them and returned every tax_region
  // in the partner's countries — caused the cross-country leak where
  // South Africa's provinces section listed India's regions and vice
  // versa. Surfaced by partner-ui testing of PR
  // feat/partner-regions-admin-parity.
  //
  // Special handling for `parent_id: "null"` (literal string): the
  // top-level tax-region list uses this convention to mean "roots
  // only" (parent_id IS NULL). Convert the string to actual null so
  // query.graph emits the right SQL — otherwise it does a literal
  // string comparison and returns zero rows.
  //
  // PR B will replace this with proper validateAndTransformQuery
  // middleware (mirroring admin's full filter set); for now the
  // pass-through is the smallest fix that closes the leak.
  const passthroughKeys = [
    "parent_id",
    "province_code",
    "id",
    "provider_id",
  ] as const
  for (const key of passthroughKeys) {
    const raw = (req.query as any)?.[key]
    if (raw === undefined || raw === "") continue
    if (raw === "null" || raw === null) {
      // Explicit operator form — `{ field: null }` in MikroORM/query.graph
      // does a literal `field = NULL` compare (always false in SQL); the
      // `$eq: null` form correctly emits `field IS NULL`.
      filters[key] = { $eq: null }
    } else {
      filters[key] = raw
    }
  }

  const { data: taxRegions } = await query.graph({
    entity: "tax_regions",
    fields: ["*", "tax_rates.*", "children.*"],
    ...(Object.keys(filters).length ? { filters } : {}),
  })

  res.json({
    tax_regions: taxRegions || [],
    count: taxRegions?.length || 0,
    offset: 0,
    limit: 20,
  })
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  const body = req.body as Record<string, any>

  // Defensive: lowercase country/province codes on create so a UI
  // dropdown sending "IN" / "ON" can't desync from the list filter
  // (which lowercases both sides). The list view bug that prompted
  // this fix would have masked the create with either side
  // normalizing — doing both makes it impossible to recur regardless
  // of how the UI evolves.
  const normalizedBody = {
    ...body,
    country_code: body.country_code ? String(body.country_code).toLowerCase() : body.country_code,
    province_code: body.province_code ? String(body.province_code).toLowerCase() : body.province_code,
  }

  const { result } = await createTaxRegionsWorkflow(req.scope).run({
    input: [normalizedBody] as any,
  })

  res.status(201).json({ tax_region: result[0] })
}

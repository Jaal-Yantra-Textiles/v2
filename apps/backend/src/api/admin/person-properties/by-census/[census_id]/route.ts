import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { PERSON_PROPERTY_MODULE } from "../../../../../modules/personproperty"

/**
 * Weaver "edit / changes" surface, addressed by census_id (the natural key).
 *
 * The weaver detail page is keyed by census_id (not a person id), so these
 * routes resolve the person_property record the same way — a 1:1 upsert on
 * `census_id`. The record lives in the MikroHyperbee KV store (append-only,
 * keyed by census_id) when PERSON_PROPERTY_HYPERBEE=true; otherwise the Postgres
 * fallback. Either way the wire contract is identical.
 */

// GET /admin/person-properties/by-census/:census_id — retrieve (or null)
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(PERSON_PROPERTY_MODULE)
  const [person_property] = await service.listAndCountPersonProperties(
    { census_id: req.params.census_id },
    { take: 1 }
  )
  res.json({ person_property: person_property ?? null })
}

// POST /admin/person-properties/by-census/:census_id — upsert by census_id
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(PERSON_PROPERTY_MODULE)
  const body = (req.validatedBody || {}) as Record<string, unknown>

  const [existing] = await service.listAndCountPersonProperties(
    { census_id: req.params.census_id },
    { take: 1 }
  )

  const result = existing
    ? await service.updatePersonProperties({ id: existing.id, ...body })
    : await service.createPersonProperties({ census_id: req.params.census_id, ...body })

  const person_property = Array.isArray(result) ? result[0] : result
  res.status(existing ? 200 : 201).json({ person_property })
}
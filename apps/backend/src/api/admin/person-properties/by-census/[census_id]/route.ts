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
  /*
   * 🔴 `listAndCount*` returns a TUPLE — `[rows, count]` — so the first element
   * is the ROW LIST, not a row. Destructured as one record this answered
   * `{"person_property":[]}`: an array where the client's type says
   * `WeaverProperty | null`, never null even when nothing exists, and never the
   * object when something does. `WeaverEditsSection` then read
   * `prop?.social_media` and `prop?.id` off an array — both undefined — so the
   * form stayed empty and its seeding effect never re-ran.
   */
  const [rows] = await service.listAndCountPersonProperties(
    { census_id: req.params.census_id },
    { take: 1 }
  )
  res.json({ person_property: rows?.[0] ?? null })
}

// POST /admin/person-properties/by-census/:census_id — upsert by census_id
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(PERSON_PROPERTY_MODULE)
  const body = (req.validatedBody || {}) as Record<string, unknown>

  /*
   * 🔴 The same tuple, and here it did not merely mis-shape a response — it
   * made the feature impossible to use. `existing` was the row list, and an
   * EMPTY ARRAY IS TRUTHY, so the create branch was unreachable and every
   * first save went to update with `id: undefined`:
   *
   *   POST /admin/person-properties/by-census/VERIFY-1864-A
   *   {"message":"PersonProperty with id \"\" not found"}   HTTP 404
   *
   * Measured against a running server. No weaver edit could ever be saved.
   */
  const [rows] = await service.listAndCountPersonProperties(
    { census_id: req.params.census_id },
    { take: 1 }
  )
  const existing = rows?.[0]

  const result = existing
    ? await service.updatePersonProperties({ id: existing.id, ...body })
    : await service.createPersonProperties({ census_id: req.params.census_id, ...body })

  const person_property = Array.isArray(result) ? result[0] : result
  res.status(existing ? 200 : 201).json({ person_property })
}
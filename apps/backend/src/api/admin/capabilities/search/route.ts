/**
 * GET /admin/capabilities/search — #2596. Partners who can do a technique /
 * material / product type, or whose samples mention `q`, each with their
 * evidence and LIVE rate estimates. No AI.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { searchCapabilities } from "../../../../lib/capability-search"
import type { AdminSearchCapabilitiesQuery } from "../validators"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const q = (req as any).validatedQuery as AdminSearchCapabilitiesQuery
  const partners = await searchCapabilities(req.scope, q)
  res.json({ partners, count: partners.length })
}

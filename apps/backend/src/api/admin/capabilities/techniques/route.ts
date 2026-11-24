/** GET /admin/capabilities/techniques — #2596. The technique vocabulary. */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { TECHNIQUES, RATE_UNITS } from "../../../../modules/partner_capability/lib/techniques"

export const GET = async (_req: MedusaRequest, res: MedusaResponse) => {
  res.json({ techniques: TECHNIQUES, units: RATE_UNITS })
}

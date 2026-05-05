import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { listAccessibleResourcesWorkflow } from "../../../../../../../workflows/google/list-accessible-resources"
import type { GoogleService } from "../../../../../../../modules/social-provider/google-connection-service"

const KNOWN_SERVICES = new Set<GoogleService>([
  "merchant",
  "ads",
  "search-console",
  "business-profile",
])

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service = req.params.service as GoogleService
  if (!KNOWN_SERVICES.has(service)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Unknown Google service: ${service}. Allowed: ${[...KNOWN_SERVICES].join(", ")}`
    )
  }

  const { result } = await listAccessibleResourcesWorkflow(req.scope).run({
    input: {
      platform_id: req.params.id,
      service,
    },
  })

  res.status(200).json(result)
}

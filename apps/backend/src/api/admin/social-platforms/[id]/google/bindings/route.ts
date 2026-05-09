import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { SOCIALS_MODULE } from "../../../../../../modules/socials"
import { upsertGoogleBindingWorkflow } from "../../../../../../workflows/google/upsert-binding"
import type { GoogleService } from "../../../../../../modules/social-provider/google-connection-service"

const KNOWN_SERVICES = new Set<GoogleService>([
  "merchant",
  "ads",
  "search-console",
  "business-profile",
])

type CreateBody = {
  service: GoogleService
  resource_id: string
  resource_label?: string | null
  settings?: Record<string, any> | null
  metadata?: Record<string, any> | null
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const socials = req.scope.resolve(SOCIALS_MODULE) as any

  const filters: Record<string, any> = { platform_id: req.params.id }
  const serviceQuery = (req.query?.service as string) || undefined
  if (serviceQuery) {
    if (!KNOWN_SERVICES.has(serviceQuery as GoogleService)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Unknown service filter: ${serviceQuery}`
      )
    }
    filters.service = serviceQuery
  }

  const [bindings, count] = await socials.listAndCountSocialPlatformBindings(filters, {
    take: 100,
    order: { service: "ASC", resource_label: "ASC" },
  })

  res.status(200).json({ bindings, count })
}

export const POST = async (req: MedusaRequest<CreateBody>, res: MedusaResponse) => {
  const body = (req.body || {}) as CreateBody

  if (!body.service || !KNOWN_SERVICES.has(body.service)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `service must be one of ${[...KNOWN_SERVICES].join(", ")}`
    )
  }
  if (!body.resource_id) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "resource_id is required")
  }

  const { result } = await upsertGoogleBindingWorkflow(req.scope).run({
    input: {
      platform_id: req.params.id,
      service: body.service,
      resource_id: body.resource_id,
      resource_label: body.resource_label ?? null,
      settings: body.settings ?? null,
      metadata: body.metadata ?? null,
    },
  })

  res.status(201).json({ binding: result })
}

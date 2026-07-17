import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { hostToCandidates, resolveStorefrontForPartner } from "../resolve-key"

/**
 * GET /web/storefront/resolve?host=<host>
 *
 * Public host → storefront resolver for the multi-tenant ("Basic" tier)
 * storefront running as a single shared Worker. The edge middleware calls this
 * with the incoming `Host` and gets back the publishable key it must send to
 * the Store API for that tenant. Two lookup paths, in order:
 *   1. Custom domain  — `partner.storefront_domain === host`
 *   2. Handle subdomain — first label of the host === `partner.handle`
 *
 * Single-tenant (per-partner Vercel) deploys never call this: they carry their
 * own `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` and short-circuit before resolution.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const rawHost = (req.query.host as string) || ""
  if (!rawHost) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Query param 'host' is required"
    )
  }

  const { host, subdomain } = hostToCandidates(rawHost)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const partnerFields = [
    "id",
    "name",
    "handle",
    "storefront_domain",
    "metadata",
    "stores.*",
  ]

  // 1. Custom domain match.
  let { data: partners } = await query.graph({
    entity: "partners",
    fields: partnerFields,
    filters: { storefront_domain: host },
  })

  // 2. Fall back to handle-subdomain match.
  if (!partners?.length && subdomain) {
    ;({ data: partners } = await query.graph({
      entity: "partners",
      fields: partnerFields,
      filters: { handle: subdomain },
    }))
  }

  if (!partners?.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `No storefront found for host '${host}'`
    )
  }

  const resolved = await resolveStorefrontForPartner(query, partners[0])

  res.status(200).json({
    host,
    ...resolved,
  })
}

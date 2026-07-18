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
 *   1. Provisioned subdomain — `partner.storefront_domain === host`
 *   2. Connected custom domain — `partner.custom_domain === host` (apex or www)
 *   3. Website-domain alias — a `website_domain` row for the host
 *   4. Handle subdomain — first label of the host === `partner.handle`
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
  // The raw host, lowercased + port-stripped but NOT www-stripped — so a
  // www-primary custom domain (stored as `www.foo.com`) still matches.
  const rawHostLower = rawHost.toLowerCase().split(":")[0].trim()
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const partnerFields = [
    "id",
    "name",
    "handle",
    "storefront_domain",
    "custom_domain",
    "metadata",
    "stores.*",
  ]

  // 1. Provisioned-subdomain match (partner.storefront_domain column).
  let { data: partners } = await query.graph({
    entity: "partners",
    fields: partnerFields,
    filters: { storefront_domain: host },
  })

  // 2. Connected custom domain (partner.custom_domain column). hostToCandidates
  //    already stripped a leading `www.`, so the apex form stored here matches
  //    both `foo.com` and `www.foo.com`; we also try the raw host so a
  //    www-primary domain resolves. This does NOT depend on website_domain
  //    alias rows (which require a website_id the partner may not have) — the
  //    gap that left an attached custom domain reaching the worker but showing
  //    "no shop found".
  if (!partners?.length) {
    const customCandidates = Array.from(
      new Set([host, rawHostLower].filter(Boolean))
    )
    ;({ data: partners } = await query.graph({
      entity: "partners",
      fields: partnerFields,
      filters: { custom_domain: customCandidates },
    }))
  }

  // 3. Alias/custom domain a partner attached later. These are registered as
  //    `website_domain` rows (primary + www/apex twin) on the partner's
  //    website, so resolve host -> website_domain -> website_id -> the partner
  //    whose website_id matches. Soft-deleted aliases are excluded by default.
  if (!partners?.length) {
    const { data: aliasRows } = await query.graph({
      entity: "website_domain",
      fields: ["domain", "website.id"],
      filters: { domain: host },
    })
    const websiteId = aliasRows?.[0]?.website?.id
    if (websiteId) {
      ;({ data: partners } = await query.graph({
        entity: "partners",
        fields: partnerFields,
        filters: { website_id: websiteId },
      }))
    }
  }

  // 4. Fall back to handle-subdomain match.
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

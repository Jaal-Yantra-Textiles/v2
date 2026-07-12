import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../../../helpers"
import partnerProductLink from "../../../../../links/partner-product"
import { signPreviewToken } from "../../../../store/products/preview/lib/token"

const LINK_ENTRY = partnerProductLink.entryPoint

/**
 * Return a private, shareable review link for an artisan's (unpublished)
 * product (#859). The product lists on the core cicilabel.com channel, so the
 * preview lives on the core storefront (`FRONTEND_URL`) under the token-gated
 * `/products/preview/:token` route — not discoverable in any listing/sitemap.
 *
 * @route GET /partners/products/:id/preview-link
 */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  if (!req.auth_context?.actor_id) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Partner authentication required")
  }
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "No partner associated with this account")
  }

  const productId = req.params.id
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any

  // Ownership gate — only the owning partner gets a share link.
  const { data: ownerLinks = [] } = await query.graph({
    entity: LINK_ENTRY,
    fields: ["partner_id", "product_id"],
    filters: { product_id: productId },
  })
  const ownedByPartner = ownerLinks.some(
    (l: any) => l.partner_id === partner.id
  )
  if (!ownedByPartner) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Product ${productId} not found`)
  }

  const { data: products = [] } = await query.graph({
    entity: "product",
    fields: ["id", "status"],
    filters: { id: productId },
  })
  const product = products[0]
  if (!product) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Product ${productId} not found`)
  }

  // Resolve a country code for the region-prefixed storefront URL from the
  // partner's store region (falls back to a sensible default).
  let countryCode = "de"
  try {
    const { data: partners = [] } = await query.graph({
      entity: "partners",
      fields: ["id", "stores.default_region_id"],
      filters: { id: partner.id },
    })
    const regionId = partners?.[0]?.stores?.find(
      (s: any) => s?.default_region_id
    )?.default_region_id
    if (regionId) {
      const { data: regions = [] } = await query.graph({
        entity: "region",
        fields: ["id", "countries.iso_2"],
        filters: { id: regionId },
      })
      const iso = regions?.[0]?.countries?.[0]?.iso_2
      if (iso) {
        countryCode = iso
      }
    }
  } catch {
    // keep the default country code
  }

  const token = signPreviewToken(productId)
  const base = (process.env.FRONTEND_URL || "").replace(/\/$/, "")
  const path = `/${countryCode}/products/preview/${token}`

  res.json({
    token,
    path,
    url: base ? `${base}${path}` : path,
    status: product.status,
  })
}

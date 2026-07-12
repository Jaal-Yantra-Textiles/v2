import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../../../helpers"
import partnerProductLink from "../../../../../links/partner-product"
import { signPreviewToken } from "../../../../store/products/preview/lib/token"

const LINK_ENTRY = partnerProductLink.entryPoint

/** Core storefront base (cicilabel.com) — where artisan products list + preview.
 * `STORE_URL` is the canonical core-storefront env (FRONTEND_URL is the separate
 * CREATE/brand site, jaalyantra.com — using it produced the wrong domain). */
const CORE_STOREFRONT_URL = process.env.STORE_URL || "https://cicilabel.com"

/**
 * Return a private, shareable review link for an artisan's (unpublished)
 * product (#859). The product lists on the core cicilabel.com channel, so the
 * preview lives on the core storefront under the token-gated
 * `/products/preview/:token` route — not discoverable in any listing/sitemap.
 *
 * The path is intentionally country-less: the storefront middleware redirects it
 * to the store's own default region (`/{country}/products/preview/:token`), so
 * we don't hard-code a country (the partner's region country could be one the
 * core store doesn't even serve).
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

  const token = signPreviewToken(productId)
  const base = CORE_STOREFRONT_URL.replace(/\/$/, "")
  const path = `/products/preview/${token}`

  res.json({
    token,
    path,
    url: `${base}${path}`,
    status: product.status,
  })
}

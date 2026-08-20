import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import { createProductsWorkflow } from "@medusajs/medusa/core-flows"

import { PARTNER_MODULE } from "../../../../../modules/partner"
import { ensureInventoryLevelsForVariants } from "../../../../partners/helpers"
import { requestVariantPriceFanout } from "../../../../../workflows/fx/fanout-variant-prices"
import { recordProductProvenance } from "./lib/provenance"

/**
 * POST /admin/stores/:id/products
 *
 * Create a product INTO a partner's store, as an admin, on their behalf.
 *
 * Why this route exists: core `POST /admin/products` creates a product that
 * belongs to no sales channel, so it is invisible on every storefront, and it
 * seeds no inventory levels, so every variant reads 0 stock everywhere and the
 * partner-ui inventory page 404s on it. Every store-scoped product route lived
 * under `/partners/*` and required partner auth, so an admin had no way to put
 * a product into a partner's shop at all — support could not do it, and the
 * admin assistant could not either.
 *
 * This mirrors `POST /partners/stores/:id/products` step for step (sales
 * channel injection, inventory levels, FX price fanout) with two differences:
 * the actor is an admin rather than the store's owner, and the act is
 * RECORDED. A product landing on someone's live storefront that they did not
 * create must be attributable and must not be silent — see `lib/provenance.ts`.
 *
 * Deliberately NOT applying the `core_channel_listing` proposal override: that
 * gate exists to make an artisan's product wait for admin review, and an admin
 * is already the reviewer. Forcing `proposed` here would mean an admin creating
 * a product and then having to approve their own work.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest & { params: { id: string } },
  res: MedusaResponse
) => {
  const storeId = req.params.id
  const query: any = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const storeService: any = req.scope.resolve(Modules.STORE)
  const [store] = await storeService.listStores({ id: storeId })
  if (!store) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Store ${storeId} not found`
    )
  }

  // Without a sales channel the product exists and is invisible — a silent
  // half-success, so refuse instead.
  if (!store.default_sales_channel_id) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Store ${storeId} has no default sales channel configured, so a product created in it would not appear on any storefront`
    )
  }

  // The owning partner is what makes this "on behalf of" someone rather than
  // just an admin write. Resolved BEFORE the create: a product we could not
  // attribute is exactly what this route exists to prevent, so refuse rather
  // than create an unattributable product in someone's shop.
  const { data: partnerRows } = await query.graph({
    entity: "partner",
    fields: ["id", "name"],
    filters: { stores: { id: storeId } },
  })
  const ownerPartner = partnerRows?.[0]
  if (!ownerPartner?.id) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Store ${storeId} is not linked to a partner, so a product created in it could not be attributed to an owner`
    )
  }

  const body = { ...((req.body as Record<string, any>) || {}) }
  if (!body.title) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "title is required to create a product"
    )
  }

  body.sales_channels = [{ id: store.default_sales_channel_id }]

  const { result } = await createProductsWorkflow(req.scope).run({
    input: { products: [body] as any },
  })

  const product = result?.[0]

  // Ownership + provenance + the partner-facing announcement. Never throws;
  // returns what it managed so the response can be honest about it.
  const provenance = await recordProductProvenance(req.scope, {
    owner_partner_id: ownerPartner.id,
    product_id: product?.id,
    store_id: store.id,
    actor_type: "admin",
    actor_id: req.auth_context?.actor_id ?? null,
    source: "admin_store_products",
  })

  // Without location levels the variant reads 0 stock everywhere and
  // partner-ui 404s on the item. Idempotent + never throws.
  const variantIds = (product?.variants || []).map((v: any) => v.id)
  await ensureInventoryLevelsForVariants(req.scope, store, variantIds)

  // Materialise auto-converted prices in the store's other supported
  // currencies, or the product reads "not available" outside its native
  // region. Idempotent + never throws.
  await requestVariantPriceFanout(req.scope, { storeId: store.id, variantIds })

  res.status(201).json({
    product,
    partner_id: ownerPartner.id,
    store_id: store.id,
    created_on_behalf: true,
    // Surfaced rather than swallowed: if the audit link or the partner
    // announcement failed, the caller should know the product exists WITHOUT
    // its provenance, not be told everything went fine.
    provenance,
  })
}

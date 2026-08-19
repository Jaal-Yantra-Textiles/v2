import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { PARTNER_MODULE } from "../../../../../../modules/partner"

/**
 * Who created a product into a partner's store, and on whose behalf.
 *
 * An admin can create a product directly into a partner's shop, where it goes
 * live on their public storefront. A product the owner did not make must not
 * have to be reconstructed later from a timestamp and a guess, so the fact is
 * written onto the ownership link itself (`links/partner-product.ts`) rather
 * than into product `metadata`, which is a shared junk drawer any writer may
 * overwrite.
 */

export type ProductProvenanceInput = {
  /** Partner who OWNS the product — the store's partner. */
  owner_partner_id: string
  product_id: string
  store_id: string
  actor_type: "admin" | "partner"
  actor_id?: string | null
  source: string
  /**
   * When a partner acts, the partner id behind the actor. Lets the builder
   * decide on-behalf-ness by comparing owner to actor rather than trusting
   * the caller to have worked it out.
   */
  actor_partner_id?: string | null
}

export type ProductProvenanceColumns = {
  created_by_actor_type: string
  created_by_actor_id: string | null
  created_on_behalf: boolean
  store_id: string
  source: string
}

/**
 * PURE: the provenance columns for one create. Exported for unit tests.
 *
 * `created_on_behalf` is DERIVED, never passed in. An admin acting on a
 * partner's store is always on-behalf; a partner acting on their own store
 * never is; a partner acting on someone else's store (a partner can serve
 * another partner's store — see links/partner-order.ts) is. Deriving it means
 * a caller cannot record a convenient answer, and the flag stays trustworthy
 * for the readers that branch on it.
 */
export const buildProductProvenance = (
  input: ProductProvenanceInput
): ProductProvenanceColumns => {
  const onBehalf =
    input.actor_type === "admin"
      ? true
      : // A partner actor is only "themselves" when the acting partner IS the
        // owner. An unknown acting partner cannot be assumed to be the owner.
        input.actor_partner_id !== input.owner_partner_id

  return {
    created_by_actor_type: input.actor_type,
    created_by_actor_id: input.actor_id ?? null,
    created_on_behalf: onBehalf,
    store_id: input.store_id,
    source: input.source,
  }
}

/**
 * Write the ownership link carrying its provenance, then announce it.
 *
 * The event is not decoration. A product appearing in someone's live shop that
 * they did not create should not be silent — `product.created_for_partner` is
 * the seam a visual flow uses to tell them (same pattern as
 * `partner_product.proposed`). Kept off the generic product firehose so flows
 * wake only on this.
 *
 * Never throws: the product already exists by this point, and losing the audit
 * row must not unwind a successful create. It DOES report failures — an audit
 * that fails silently is worse than none, because it reads as "nobody did this
 * on anyone's behalf".
 */
export const recordProductProvenance = async (
  scope: any,
  input: ProductProvenanceInput
): Promise<{ linked: boolean; announced: boolean }> => {
  const logger: any = scope.resolve(ContainerRegistrationKeys.LOGGER)
  const columns = buildProductProvenance(input)

  let linked = false
  try {
    const remoteLink = scope.resolve(ContainerRegistrationKeys.LINK) as any
    await remoteLink.create({
      [PARTNER_MODULE]: { partner_id: input.owner_partner_id },
      [Modules.PRODUCT]: { product_id: input.product_id },
      data: columns,
    })
    linked = true
  } catch (e: any) {
    logger?.warn?.(
      `[product-provenance] Could not link product ${input.product_id} to partner ${input.owner_partner_id}: ${e?.message ?? e}`
    )
  }

  let announced = false
  // Only announce the case worth announcing. A partner creating their own
  // product needs no notification about it.
  if (columns.created_on_behalf) {
    try {
      const eventBus = scope.resolve(Modules.EVENT_BUS) as any
      await eventBus.emit({
        name: "product.created_for_partner",
        data: {
          id: input.product_id,
          product_id: input.product_id,
          partner_id: input.owner_partner_id,
          store_id: input.store_id,
          actor_type: columns.created_by_actor_type,
          actor_id: columns.created_by_actor_id,
          source: columns.source,
        },
      })
      announced = true
    } catch (e: any) {
      logger?.warn?.(
        `[product-provenance] Could not announce product ${input.product_id} to partner ${input.owner_partner_id}: ${e?.message ?? e}`
      )
    }
  }

  return { linked, announced }
}

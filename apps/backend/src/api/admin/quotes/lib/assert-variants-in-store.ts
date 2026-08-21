import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

/**
 * Every quoted variant must belong to the partner whose quote this is (#1419).
 *
 * ## Why this only exists on the admin surface
 *
 * The partner surface is naturally scoped — a partner picks from their own
 * catalogue. An admin picks a partner from a dropdown and then a variant from
 * the whole platform, so the two can disagree with a single mis-click, and the
 * result is a quote that freezes one partner's prices onto another partner's
 * customer group.
 *
 * 🔴 Nothing downstream catches it. `mintQuoteWorkflow` prices whatever
 * variants it is handed, the price list is created successfully, its rule
 * assertion passes, and the buyer gets a working link to prices the partner
 * never agreed to sell at.
 *
 * ## The rule
 *
 * Ownership is the product being in the partner store's default sales channel —
 * the same rule `assertProductOwnership` applies on the partner side. It is
 * stated there for an authenticated partner and here for a named one; the
 * shared part is the sales-channel membership, not the way the actor is found.
 */
export const assertVariantsInStore = async (
  scope: any,
  input: { variantIds: string[]; salesChannelId?: string | null; partnerLabel: string }
) => {
  const variantIds = Array.from(new Set(input.variantIds.filter(Boolean)))
  if (!variantIds.length) return

  if (!input.salesChannelId) {
    // Refuse rather than skip. A missing sales channel means we cannot tell
    // whose catalogue this is, and "cannot check" must never read as "passed".
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `${input.partnerLabel} has no default sales channel, so it cannot be verified that these variants belong to them.`
    )
  }

  const query = scope.resolve(ContainerRegistrationKeys.QUERY) as any

  const { data: variants = [] } = await query.graph({
    entity: "variant",
    fields: ["id", "title", "product.id", "product.sales_channels.id"],
    filters: { id: variantIds },
  })

  const found = new Map<string, any>(
    (variants ?? []).map((v: any) => [v.id, v])
  )

  const missing = variantIds.filter((id) => !found.has(id))
  if (missing.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `These variants do not exist: ${missing.join(", ")}`
    )
  }

  const foreign: string[] = []
  for (const [id, variant] of found) {
    const channels = (variant?.product?.sales_channels ?? []) as any[]
    if (!channels.some((c) => c?.id === input.salesChannelId)) {
      foreign.push(variant?.title ? `${variant.title} (${id})` : id)
    }
  }

  if (foreign.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `These variants are not in ${input.partnerLabel}'s catalogue, so they cannot be quoted for them: ${foreign.join(", ")}.`
    )
  }
}

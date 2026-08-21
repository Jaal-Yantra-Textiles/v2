import { MedusaContainer } from "@medusajs/framework"
import { validatePartnerOwnsEntities } from "../helpers"

/**
 * 🔴 Validate BOTH ENDS of a price-list write.
 *
 * A price list's own ownership says nothing about the ids inside its `rules`.
 * `rules.customer_group_id` is precisely the field that decides whose customers
 * get these prices — so a partner who could name another partner's group would
 * be handing themselves someone else's buyers, or worse, quietly repricing
 * them. Same class as the two holes closed in #1404.
 *
 * Only `customer_group_id` is checked because it is the only rule key that
 * names a partner-scoped entity today; `region_id` and `currency_code` are
 * platform-wide by design.
 */
export const validatePriceListRules = async (
  authContext: { actor_id?: string | null } | undefined,
  rules: Record<string, string[]> | undefined | null,
  container: MedusaContainer,
): Promise<void> => {
  const groupIds = rules?.customer_group_id
  if (!groupIds?.length) {
    return
  }

  await validatePartnerOwnsEntities(
    authContext,
    "customer_groups",
    groupIds,
    container,
  )
}

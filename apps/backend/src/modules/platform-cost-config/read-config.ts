import { PLATFORM_COST_CONFIG_MODULE } from "./index"
import {
  readCostConfig,
  resolveCostConfig,
  type ResolvedCostConfig,
} from "./resolve-lib"

/**
 * The I/O half of cost-config reading (#1939): load the rows, hand them to the
 * pure resolver. Kept separate so the resolution rules stay unit-testable
 * without a container — the split `platform-tax-identity` uses.
 */

/** An all-null policy: what a caller gets when nothing is configured. */
export const EMPTY_COST_CONFIG: ResolvedCostConfig = {
  platform_fee_percent: null,
  production_overhead_percent: null,
  default_material_cost: null,
  default_material_cost_currency: null,
  custom_design_markup_percent: null,
  approval_markup_multiplier: null,
  source_config_id: null,
  effective_from: null,
}

/**
 * Read the cost policy in force at `at` (default now).
 *
 * 🔴 Never throws and never returns zeros. A container without the module
 * registered, a table that is empty, or a query that fails all resolve to
 * `EMPTY_COST_CONFIG` — every field null — so a caller falls through to its own
 * documented default instead of silently pricing at zero. That failure mode is
 * not hypothetical here: an estimator that reported "found nothing" as `0`
 * reached storefront checkout once already.
 *
 * The cost of that safety is that a genuine outage is indistinguishable from an
 * unconfigured platform. Both mean "I have no policy", both make the caller use
 * its compiled-in constant, and neither invents a number — which is the right
 * trade when the alternative is billing someone on a guess.
 */
export async function loadCostConfig(
  container: { resolve: (key: string) => any },
  at: Date = new Date()
): Promise<ResolvedCostConfig> {
  let service: any
  try {
    service = container.resolve(PLATFORM_COST_CONFIG_MODULE)
  } catch {
    return EMPTY_COST_CONFIG
  }
  if (!service?.listPlatformCostConfigs) {
    return EMPTY_COST_CONFIG
  }
  try {
    const rows = await service.listPlatformCostConfigs({}, { take: null })
    return readCostConfig(resolveCostConfig(rows, at))
  } catch {
    return EMPTY_COST_CONFIG
  }
}

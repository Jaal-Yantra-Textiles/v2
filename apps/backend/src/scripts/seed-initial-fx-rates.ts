import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { FX_RATES_MODULE } from "../modules/fx_rates"
import FxRatesService from "../modules/fx_rates/service"

/**
 * One-shot script that fetches the current FX rates from open.er-api.com
 * (the default provider) and seeds the `fx_rate` table.
 *
 * Idempotent — re-runs upsert by (base, quote) pair, just updating
 * `rate` + `fetched_at`. Safe to run any time.
 *
 * Run:
 *   npx medusa exec ./src/scripts/seed-initial-fx-rates.ts
 *
 * Dry run — fetches and logs what would be written, no DB writes:
 *   DRY_RUN=1 npx medusa exec ./src/scripts/seed-initial-fx-rates.ts
 *   npx medusa exec ./src/scripts/seed-initial-fx-rates.ts -- --dry-run
 */
export default async function seedInitialFxRates({ container, args }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const fxService = container.resolve(FX_RATES_MODULE) as FxRatesService

  const dryRun =
    (args ?? []).includes("--dry-run") || process.env.DRY_RUN === "1"

  if (dryRun) {
    logger.info("DRY RUN — fetching rates, not writing to DB.")
    // Bypass the service's apply step; just fetch + log.
    const provider = (fxService as any).provider
    const result = await provider.fetchRates()
    const codes = Object.keys(result.rates).sort()
    logger.info(
      `Provider: ${result.source}, base: ${result.base_currency}, fetched_at: ${result.fetched_at.toISOString()}, currency_count: ${codes.length}`
    )
    logger.info(`Currencies: ${codes.join(", ")}`)
    return
  }

  const summary = await fxService.refreshRatesFromProvider()
  logger.info(
    `Seeded fx_rates: base=${summary.base_currency}, upserted=${summary.upserted}, source=${summary.source}, fetched_at=${summary.fetched_at.toISOString()}`
  )
}

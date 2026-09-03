import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * Does the DTDC provider Medusa actually RESOLVES refuse to price a calculated
 * shipping option? (#1422)
 *
 * The unit spec in the plugin calls `DtdcFulfillmentService` directly, which
 * proves the class is right and nothing about the wiring. Three things sit
 * between that class and a buyer, and each has broken something here before:
 *
 *   1. the registration gate — both configs register dtdc only when
 *      `DTDC_API_KEY` is set, so with no token the provider does not exist;
 *   2. `ENABLE_CARRIER_FULFILLMENT=1`, without which the whole fulfillment
 *      provider block is skipped in dev;
 *   3. **which build is installed** — `apps/backend/package.json` takes the
 *      plugin from npm (`"latest"`) and the lockfile pins an exact version, so
 *      the class Medusa loads is whatever `pnpm-lock.yaml` says, NOT the source
 *      in `packages/`. A fix merged to the repo and absent from the lockfile is
 *      a fix that does not run.
 *
 * So this asks the container, not the source tree. It prints the version it
 * actually loaded and calls the two methods through Medusa's own
 * `fp_<provider_id>` registration.
 *
 * Read-only: it books nothing and writes nothing. Run it with the DTDC DEMO
 * credentials (GL018) and `DTDC_SANDBOX=true`; do NOT set
 * `DELHIVERY_API_TOKEN`, or you register a carrier with no sandbox.
 *
 *   ENABLE_CARRIER_FULFILLMENT=1 DTDC_SANDBOX=true \
 *   DTDC_CUSTOMER_CODE=GL018 DTDC_API_KEY=<demo key> \
 *   npx medusa exec ./src/scripts/check-dtdc-calculated-refusal.ts
 */
export default async function checkDtdcCalculatedRefusal({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  let installed = "(not resolvable)"
  try {
    installed = require("@jytextiles/medusa-plugin-dtdc-shipping/package.json").version
  } catch {
    /* the plugin is not installed at all — reported below */
  }
  logger.info(`[dtdc-check] plugin build Medusa will load: ${installed}`)
  logger.info(
    `[dtdc-check] env: ENABLE_CARRIER_FULFILLMENT=${process.env.ENABLE_CARRIER_FULFILLMENT ?? "(unset)"} ` +
      `DTDC_API_KEY=${process.env.DTDC_API_KEY ? "set" : "(unset)"} ` +
      `DTDC_SANDBOX=${process.env.DTDC_SANDBOX ?? "(unset)"}`
  )

  const fulfillment: any = container.resolve(Modules.FULFILLMENT)
  const providers = await fulfillment.listFulfillmentProviders({}, { take: 100 })
  const dtdc = providers.find((p: any) => String(p.id).includes("dtdc"))

  logger.info(
    `[dtdc-check] registered providers: ${providers.map((p: any) => p.id).join(", ") || "(none)"}`
  )
  if (!dtdc) {
    logger.warn(
      "[dtdc-check] NO dtdc provider registered — nothing to check. That is the " +
        "correct state with no DTDC token, and it is also why this defect is latent " +
        "in production rather than live."
    )
    return
  }

  /**
   * Through the module's OWN entry points, not a hand-resolved class: these two
   * are what core calls when it prices a calculated shipping option, so a pass
   * here is a statement about the path a cart takes rather than about a class
   * that happens to be importable. (Provider registrations live in the
   * fulfillment module's private container as `fp_<provider_id>` — the app
   * container cannot resolve them, which is itself worth knowing.)
   */
  let canCalculate: boolean | string
  try {
    const [answer] = await fulfillment.validateShippingOptionsForPriceCalculation([
      { provider_id: dtdc.id, price_type: "calculated", name: "dtdc probe" },
    ])
    canCalculate = answer
  } catch (e: any) {
    canCalculate = `THREW "${e?.message ?? String(e)}"`
  }
  logger.info(`[dtdc-check] canCalculate -> ${canCalculate}`)

  let priceOutcome: string
  try {
    const prices = await fulfillment.calculateShippingOptionsPrices([
      { provider_id: dtdc.id, optionData: {}, data: {}, context: {} },
    ])
    // 🔴 The defect. Whatever comes back here is the buyer's shipping charge,
    // and a zero is indistinguishable from a genuinely free lane.
    priceOutcome = `RESOLVED ${JSON.stringify(prices)}`
  } catch (e: any) {
    priceOutcome = `THREW "${e?.message ?? String(e)}"`
  }
  logger.info(`[dtdc-check] calculatePrice -> ${priceOutcome}`)

  const fixed = canCalculate === false && priceOutcome.startsWith("THREW")
  logger.info(
    fixed
      ? `[dtdc-check] ✅ PASS — build ${installed} refuses to price a calculated dtdc option.`
      : `[dtdc-check] 🔴 FAIL — build ${installed} still quotes a calculated dtdc option. ` +
          `If canCalculate is true and calculatePrice resolved 0, this is the #1422 free-shipping build.`
  )
}

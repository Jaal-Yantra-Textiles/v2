import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { FX_RATES_MODULE } from "../../modules/fx_rates"
import FxRatesService from "../../modules/fx_rates/service"

/**
 * Workflow: refresh-fx-rates
 *
 * Thin wrapper around FxRatesService.refreshRatesFromProvider() so the
 * visual flow (`seed-fx-refresh-flow.ts`) can call it via a
 * trigger_workflow operation. Keeping the logic on the service means
 * tests don't need the workflow harness — they exercise the service
 * directly. The workflow exists purely to give the visual flow a
 * stable name to bind to.
 *
 * No compensation step — refresh is non-destructive (upserts, never
 * deletes). A partial failure on the provider side leaves the cache
 * in a valid state with whatever rates were written before the throw.
 */

export type RefreshFxRatesInput = Record<string, unknown> | undefined

export const refreshFxRatesStep = createStep(
  "refresh-fx-rates-step",
  async (_input: RefreshFxRatesInput, { container }) => {
    const fxService: FxRatesService = container.resolve(FX_RATES_MODULE)
    const summary = await fxService.refreshRatesFromProvider()
    return new StepResponse({
      base_currency: summary.base_currency,
      upserted: summary.upserted,
      source: summary.source,
      fetched_at: summary.fetched_at.toISOString(),
    })
  }
)

export const refreshFxRatesWorkflow = createWorkflow(
  "refresh-fx-rates",
  (input: RefreshFxRatesInput) => {
    const summary = refreshFxRatesStep(input)
    return new WorkflowResponse(summary)
  }
)

export default refreshFxRatesWorkflow

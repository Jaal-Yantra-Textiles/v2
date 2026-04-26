import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import type { FetchOverviewInput, FetchOverviewOutput } from "./types"
import {
  checkCacheStep,
  fetchFromMetaStep,
  persistInsightsStep,
  aggregateResponseStep,
} from "./steps"

export const fetchMetaAdsOverviewWorkflow = createWorkflow(
  "fetch-meta-ads-overview",
  (input: FetchOverviewInput) => {
    const cache = checkCacheStep(input)

    const fetched = fetchFromMetaStep({ input, useDb: cache.useDb })

    const persistStats = persistInsightsStep({ input, useDb: cache.useDb, fetched })

    const result = aggregateResponseStep({
      input,
      useDb: cache.useDb,
      scopedInsights: cache.scopedInsights,
      lastSyncedAt: cache.lastSyncedAt,
      fetched,
      persistStats,
    })

    return new WorkflowResponse(result as unknown as FetchOverviewOutput)
  }
)

export type { FetchOverviewInput, FetchOverviewOutput } from "./types"

import { useQuery, keepPreviousData } from "@tanstack/react-query"
import { sdk } from "../../lib/config"

// Response shape of GET /admin/marketing/headline — mirrors the
// HeadlineResponse / HeadlineMetric types in marketing-read-lib.ts.
export interface MarketingHeadlineMetric {
  metric_key: string
  value: number
  unit: string | null
  dod_delta: number | null
  as_of_date: string | null
}

export interface MarketingHeadlineResponse {
  headline: MarketingHeadlineMetric | null
  strip: MarketingHeadlineMetric[]
  trend: { as_of_date: string; value: number }[]
  stale: boolean
  generated_at: string
}

const MARKETING_QUERY_KEY = "marketing" as const

export const useMarketingHeadline = () => {
  return useQuery({
    queryKey: [MARKETING_QUERY_KEY, "headline"],
    queryFn: async () => {
      const res = await sdk.client.fetch<MarketingHeadlineResponse>(
        "/admin/marketing/headline"
      )
      return res as MarketingHeadlineResponse
    },
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
  })
}

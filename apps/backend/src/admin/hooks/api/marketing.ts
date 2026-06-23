import { useQuery, useMutation, keepPreviousData } from "@tanstack/react-query"
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

// Shape of POST /admin/marketing/newsletter/generate — AI-generated newsletter
// copy mapped to editor fields. Generated on demand via the admin-configured
// `ai_newsletter_drafter` provider (env OpenRouter fallback); not persisted.
export interface NewsletterAiWriteResponse {
  title: string
  content: string
  payload?: unknown
  source?: "platform" | "env" | "none"
}

/**
 * In-editor "Write with AI" for newsletters. Calls the generate endpoint and
 * returns { title, content } for the form to drop in. Exposes mutateAsync +
 * isPending for the button's loading state. Optional `{ topic }` angle and
 * `{ context }` (existing draft/notes to IMPROVE + EXPAND instead of starting fresh).
 */
export const useNewsletterAiWrite = () => {
  return useMutation<
    NewsletterAiWriteResponse,
    Error,
    { topic?: string; context?: string } | void
  >({
    mutationFn: async (vars) => {
      const v = (vars || {}) as { topic?: string; context?: string }
      const body: Record<string, string> = {}
      if (v.topic) body.topic = v.topic
      if (v.context) body.context = v.context
      return sdk.client.fetch<NewsletterAiWriteResponse>(
        "/admin/marketing/newsletter/generate",
        {
          method: "POST",
          body,
        }
      )
    },
  })
}

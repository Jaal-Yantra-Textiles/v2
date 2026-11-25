import { FetchError } from "@medusajs/js-sdk"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { sdk } from "../../lib/config"
import { queryKeysFactory } from "../../lib/query-key-factory"

/** #2608 — quote briefs: the multi-partner, pre-price conversation with a buyer. */
export const briefQueryKeys = queryKeysFactory("quote_briefs" as const)

export type AdminBriefListRow = {
  id: string
  title: string
  status: "draft" | "open" | "submitted" | "sampling" | "quoted" | "closed"
  partner_id: string
  recipient_name: string | null
  buyer_email: string | null
  destination_country_code: string
  sample_quantity: number | null
  submitted_at: string | null
  view_count: number
  last_viewed_at: string | null
  created_at: string
}

export type AdminBrief = Record<string, any> & {
  id: string
  title: string
  status: AdminBriefListRow["status"]
  has_link: boolean
  options: any[]
  questions: any[]
  updates: any[]
}

export type CapabilityMatch = {
  partner: { id: string; name: string; handle?: string }
  evidence: { id: string; title: string; technique: string | null; material: string | null }[]
  rates: { id: string; unit: string; price_low: number; price_high: number | null; currency_code: string; status: string; stale: boolean }[]
  needs_rate: boolean
}

export type Technique = { slug: string; label: string; action: string; default_unit: string }

export const useQuoteBriefs = (query: { limit?: number; offset?: number; status?: string } = {}) =>
  useQuery({
    queryKey: briefQueryKeys.list(query),
    queryFn: () => sdk.client.fetch<{ briefs: AdminBriefListRow[]; count: number }>("/admin/quote-briefs", { query }),
  })

export const useQuoteBrief = (id: string) =>
  useQuery({
    queryKey: briefQueryKeys.detail(id),
    queryFn: () => sdk.client.fetch<{ brief: AdminBrief }>(`/admin/quote-briefs/${id}`),
    enabled: !!id,
  })

export const useCreateQuoteBrief = () => {
  const qc = useQueryClient()
  return useMutation<{ brief: AdminBrief }, FetchError, Record<string, unknown>>({
    mutationFn: (body) => sdk.client.fetch("/admin/quote-briefs", { method: "POST", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: briefQueryKeys.lists() }),
  })
}

export const useUpdateQuoteBrief = (id: string) => {
  const qc = useQueryClient()
  return useMutation<{ brief: AdminBrief }, FetchError, Record<string, unknown>>({
    mutationFn: (body) => sdk.client.fetch(`/admin/quote-briefs/${id}`, { method: "POST", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: briefQueryKeys.all }),
  })
}

export const useOpenQuoteBrief = (id: string) => {
  const qc = useQueryClient()
  return useMutation<
    { url: string; replaced_previous_link: boolean; email: { sent: boolean; to: string | null; reason: string | null } },
    FetchError,
    { ttl_days?: number; email_buyer?: boolean }
  >({
    mutationFn: (body) => sdk.client.fetch(`/admin/quote-briefs/${id}/open`, { method: "POST", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: briefQueryKeys.all }),
  })
}

export const usePostBriefUpdate = (id: string) => {
  const qc = useQueryClient()
  return useMutation<{ brief: AdminBrief }, FetchError, { kind?: string; message: string; media_urls?: string[] }>({
    mutationFn: (body) => sdk.client.fetch(`/admin/quote-briefs/${id}/updates`, { method: "POST", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: briefQueryKeys.detail(id) }),
  })
}

export const useTechniques = () =>
  useQuery({
    queryKey: ["capability_techniques"],
    queryFn: () => sdk.client.fetch<{ techniques: Technique[] }>("/admin/capabilities/techniques"),
    staleTime: Infinity,
  })

/** Partners who can do a technique, with evidence and live rates. */
export const useCapabilityMatches = (technique: string | null) =>
  useQuery({
    queryKey: ["capability_search", technique],
    queryFn: () =>
      sdk.client.fetch<{ partners: CapabilityMatch[] }>("/admin/capabilities/search", {
        query: { technique: technique!, limit: 30 },
      }),
    enabled: !!technique,
  })

export type PartnerRate = {
  id: string
  technique: string
  unit: string
  price_low: number
  price_high: number | null
  currency_code: string
  status: string
}

/** One partner's rates (to attach to a brief choice). */
export const usePartnerRates = (partnerId: string | null, enabled = true) =>
  useQuery({
    queryKey: ["partner_capability_rates", partnerId],
    queryFn: () => sdk.client.fetch<{ rates: PartnerRate[] }>(`/admin/partners/${partnerId}/capability-rates`),
    enabled: !!partnerId && enabled,
  })

/** Attach / swap / clear the rate on one choice (null = "we'll confirm"). */
export const useUpdateBriefChoice = (briefId: string) => {
  const qc = useQueryClient()
  return useMutation<
    { brief: AdminBrief },
    FetchError,
    { choiceId: string; rate_id?: string | null; sample_ids?: string[]; note?: string | null }
  >({
    mutationFn: ({ choiceId, ...body }) =>
      sdk.client.fetch(`/admin/quote-briefs/${briefId}/choices/${choiceId}`, { method: "POST", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: briefQueryKeys.detail(briefId) }),
  })
}

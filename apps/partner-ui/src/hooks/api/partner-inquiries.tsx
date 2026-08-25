import { FetchError } from "@medusajs/js-sdk"
import {
  QueryKey,
  UseMutationOptions,
  UseQueryOptions,
  useMutation,
  useQuery,
} from "@tanstack/react-query"
import qs from "qs"

import { sdk } from "../../lib/client"
import { queryClient } from "../../lib/query-client"
import { queryKeysFactory } from "../../lib/query-key-factory"

/**
 * #1531 slice 2 — the partner's half of a design inquiry.
 *
 * A design is shown to several partners before anything is ordered: "do you
 * have these colours?", "can you do this GSM?". Until now that lived in
 * WhatsApp threads, so what was asked was unrecoverable a week later.
 */

const PARTNER_INQUIRIES_QUERY_KEY = "partner-inquiries" as const
export const partnerInquiriesQueryKeys = queryKeysFactory(
  PARTNER_INQUIRIES_QUERY_KEY
)

const PARTNER_CAPABILITIES_QUERY_KEY = "partner-capabilities" as const
export const partnerCapabilitiesQueryKeys = queryKeysFactory(
  PARTNER_CAPABILITIES_QUERY_KEY
)

export type InquiryQuestionKind =
  | "yes_no"
  | "colour_select"
  | "number"
  | "text"
  | "photo"

export type InquiryQuestion = {
  id: string
  inquiry_id: string
  /** A spec category — the wizard's steps ARE these. */
  step: string
  order: number
  kind: InquiryQuestionKind
  prompt: string
  /** Swatches for `colour_select`: `{ id, value, hex }`. */
  options?: Array<{ id?: string | null; value: string; hex?: string | null }> | null
  spec_field_ref?: string | null
}

export type InquiryAnswer = {
  id: string
  question_id: string
  value?: unknown
  note?: string | null
  capability_sample_ids?: string[] | null
}

export type InquiryVerdict = "can_make" | "cannot_make" | "with_changes"

export type InquiryResponse = {
  id: string
  verdict?: InquiryVerdict | null
  lead_time_days?: number | null
  indicative_price?: number | null
  currency_code?: string | null
  notes?: string | null
  channel?: string
  invited_at?: string | null
  submitted_at?: string | null
}

export type PartnerInquiryListRow = {
  id: string
  design_id: string
  design_name?: string | null
  design_thumbnail?: string | null
  title: string
  brief_note?: string | null
  status: "open" | "closed"
  spec_version?: string | null
  question_count: number
  created_at?: string
  closed_at?: string | null
  response: InquiryResponse
}

export type PartnerInquiryDetail = {
  inquiry: {
    id: string
    design_id: string
    title: string
    brief_note?: string | null
    reference_media_ids?: string[]
    spec_version?: string | null
    status: "open" | "closed"
    created_at?: string
    closed_at?: string | null
  }
  design?: {
    id: string
    name?: string | null
    description?: string | null
    thumbnail_url?: string | null
  } | null
  questions: InquiryQuestion[]
  response: InquiryResponse
  answers: InquiryAnswer[]
}

export type IncomingAnswer = {
  question_id: string
  value?: unknown
  note?: string | null
  capability_sample_ids?: string[]
}

export type CapabilitySample = {
  id: string
  partner_id: string
  title: string
  technique?: string | null
  material?: string | null
  media_file_ids?: string[] | null
  notes?: string | null
  source?: string
  captured_at?: string
}

export const usePartnerInquiries = (
  params?: { status?: "open" | "closed"; limit?: number; offset?: number },
  options?: Omit<
    UseQueryOptions<
      { inquiries: PartnerInquiryListRow[]; count: number },
      FetchError,
      { inquiries: PartnerInquiryListRow[]; count: number },
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: partnerInquiriesQueryKeys.list(params),
    queryFn: async () => {
      const q = qs.stringify(params || {}, { skipNulls: true })
      return await sdk.client.fetch<{
        inquiries: PartnerInquiryListRow[]
        count: number
      }>(`/partners/inquiries${q ? `?${q}` : ""}`, { method: "GET" })
    },
    ...options,
  })

  return {
    ...data,
    inquiries: data?.inquiries ?? [],
    count: data?.count ?? 0,
    ...rest,
  }
}

export const usePartnerInquiry = (
  inquiryId: string,
  options?: Omit<
    UseQueryOptions<
      PartnerInquiryDetail,
      FetchError,
      PartnerInquiryDetail,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: partnerInquiriesQueryKeys.detail(inquiryId),
    queryFn: async () =>
      await sdk.client.fetch<PartnerInquiryDetail>(
        `/partners/inquiries/${inquiryId}`,
        { method: "GET" }
      ),
    enabled: !!inquiryId,
    ...options,
  })

  return { ...data, ...rest }
}

/**
 * Autosave one step.
 *
 * 🔑 The server returns the FULL answer set, and it is written straight into
 * the cache rather than merged. A client that merges a partial write into its
 * own copy is a client that can end up disagreeing with the server about what
 * the partner said — and the partner would have no way to see which one is
 * showing.
 */
export const useSavePartnerInquiryAnswers = (
  inquiryId: string,
  options?: UseMutationOptions<
    { answers: InquiryAnswer[]; saved: number },
    FetchError,
    { answers: IncomingAnswer[] }
  >
) => {
  return useMutation({
    mutationFn: async (payload) =>
      await sdk.client.fetch<{ answers: InquiryAnswer[]; saved: number }>(
        `/partners/inquiries/${inquiryId}/answers`,
        { method: "POST", body: payload }
      ),
    onSuccess: async (data, variables, context) => {
      await queryClient.invalidateQueries({
        queryKey: partnerInquiriesQueryKeys.detail(inquiryId),
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useSubmitPartnerInquiry = (
  inquiryId: string,
  options?: UseMutationOptions<
    { response: InquiryResponse; answers: InquiryAnswer[] },
    FetchError,
    {
      verdict: InquiryVerdict
      lead_time_days?: number | null
      indicative_price?: number | null
      currency_code?: string | null
      notes?: string | null
      answers?: IncomingAnswer[]
    }
  >
) => {
  return useMutation({
    mutationFn: async (payload) =>
      await sdk.client.fetch<{
        response: InquiryResponse
        answers: InquiryAnswer[]
      }>(`/partners/inquiries/${inquiryId}/submit`, {
        method: "POST",
        body: payload,
      }),
    onSuccess: async (data, variables, context) => {
      await queryClient.invalidateQueries({
        queryKey: partnerInquiriesQueryKeys.detail(inquiryId),
      })
      await queryClient.invalidateQueries({
        queryKey: partnerInquiriesQueryKeys.lists(),
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const usePartnerCapabilities = (
  params?: { technique?: string; material?: string; limit?: number },
  options?: Omit<
    UseQueryOptions<
      { samples: CapabilitySample[]; count: number },
      FetchError,
      { samples: CapabilitySample[]; count: number },
      QueryKey
    >,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryKey: partnerCapabilitiesQueryKeys.list(params),
    queryFn: async () => {
      const q = qs.stringify(params || {}, { skipNulls: true })
      return await sdk.client.fetch<{
        samples: CapabilitySample[]
        count: number
      }>(`/partners/capabilities${q ? `?${q}` : ""}`, { method: "GET" })
    },
    ...options,
  })

  return {
    ...data,
    samples: data?.samples ?? [],
    count: data?.count ?? 0,
    ...rest,
  }
}

export const useCreatePartnerCapability = (
  options?: UseMutationOptions<
    { sample: CapabilitySample },
    FetchError,
    {
      title: string
      technique?: string | null
      material?: string | null
      media_file_ids?: string[]
      notes?: string | null
      captured_at?: string | null
    }
  >
) => {
  return useMutation({
    mutationFn: async (payload) =>
      await sdk.client.fetch<{ sample: CapabilitySample }>(
        `/partners/capabilities`,
        { method: "POST", body: payload }
      ),
    onSuccess: async (data, variables, context) => {
      await queryClient.invalidateQueries({
        queryKey: partnerCapabilitiesQueryKeys.lists(),
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

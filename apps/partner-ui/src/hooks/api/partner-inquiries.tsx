import { FetchError } from "@medusajs/js-sdk"
import {
  QueryKey,
  UseMutationOptions,
  UseQueryOptions,
  useMutation,
  useQuery,
} from "@tanstack/react-query"
import qs from "qs"

import { sdk, backendUrl } from "../../lib/client/client"
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
    /**
     * The moodboard, resolved to something renderable (#1543).
     *
     * 🔑 Render from THIS, never from `reference_media_ids`. The ids are what
     * is stored; they were returned by the route from the day it was written
     * and nothing could show them, so the partner was asked "can you make
     * this?" while being shown nothing at all.
     */
    reference_media?: CapabilityMedia[] | null
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

/** A photograph on a sample, resolved to something renderable by the route. */
export type CapabilityMedia = {
  id: string
  url: string
  name?: string | null
  type?: string | null
}

export type CapabilitySample = {
  id: string
  partner_id: string
  title: string
  technique?: string | null
  material?: string | null
  media_file_ids?: string[] | null
  /**
   * 🔑 Render from THIS, never from `media_file_ids`. An id is not a URL —
   * the ids are what is stored, `media` is what the read path resolves them
   * to, and a component that reached for the ids would show empty squares
   * after every reload while looking perfectly correct on the upload itself.
   */
  media?: CapabilityMedia[] | null
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

/**
 * Upload photographs for a capability sample (#1543).
 *
 * Two steps, not one: this returns `media` ids and URLs, and the caller then
 * creates the SAMPLE with those ids. They are separate because a sample
 * outlives the inquiry that produced it — a partner may attach one they
 * already have rather than take a new photograph — so "upload a file" and
 * "record what this proves" are genuinely different acts.
 *
 * 🔑 `content-type: null` is deliberate. The SDK sets `application/json` by
 * default and the browser must be left to write its own multipart boundary;
 * with the default header the request arrives as a body multer cannot parse
 * and the route reports "No files were uploaded" about files that were
 * definitely sent.
 *
 * The native-fetch fallback mirrors `usePartnerUpload` — mobile browsers have
 * failed the SDK path with an opaque "fetch failed", and a weaver on a phone
 * is exactly who this feature is for.
 */
export const useUploadCapabilityMedia = (
  options?: UseMutationOptions<{ media: CapabilityMedia[] }, FetchError, File[]>
) => {
  return useMutation({
    mutationFn: async (files: File[]) => {
      const form = new FormData()
      files.forEach((file) => form.append("files", file))

      try {
        return await sdk.client.fetch<{ media: CapabilityMedia[] }>(
          "/partners/capabilities/uploads",
          {
            method: "POST",
            body: form,
            headers: { "content-type": null } as any,
          }
        )
      } catch (sdkError: any) {
        const isNetworkError =
          sdkError?.message === "fetch failed" ||
          sdkError?.message === "Failed to fetch" ||
          sdkError?.message?.includes("network")
        if (!isNetworkError) throw sdkError

        const token = (sdk as any).client?.token || null
        const headers: Record<string, string> = {}
        if (token) headers["Authorization"] = `Bearer ${token}`

        const res = await fetch(
          `${backendUrl.replace(/\/$/, "")}/partners/capabilities/uploads`,
          { method: "POST", headers, body: form, credentials: "include" }
        )
        if (!res.ok) {
          const body = await res.text().catch(() => "Upload failed")
          const err: any = new Error(body)
          err.status = res.status
          throw err
        }
        return res.json() as Promise<{ media: CapabilityMedia[] }>
      }
    },
    ...options,
  })
}

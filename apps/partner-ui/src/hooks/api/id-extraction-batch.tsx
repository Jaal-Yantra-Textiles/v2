import { FetchError } from "@medusajs/js-sdk"
import { QueryKey, UseQueryOptions, useQuery } from "@tanstack/react-query"

import { sdk } from "../../lib/client"
import { queryKeysFactory } from "../../lib/query-key-factory"

const ID_EXTRACTION_BATCH_QUERY_KEY = "id_extraction_batch" as const
export const idExtractionBatchQueryKeys = queryKeysFactory(
  ID_EXTRACTION_BATCH_QUERY_KEY,
)

/** Mirrors the draft the reader produces per photograph (#1816). */
export type IdExtractionDraft = {
  first_name?: string | null
  last_name?: string | null
  gender?: string | null
  date_of_birth?: string | null
  id_type?: string | null
  id_last4?: string | null
  id_number_masked?: string | null
  confidence?: number | null
  creatable?: boolean | null
  /**
   * The reader's own doubts, in its words. These are the only signal that a
   * name was kept whole rather than split, or that a field was dropped — so
   * they are rendered, never summarised away.
   */
  warnings?: string[] | null
  address?: {
    street?: string | null
    city?: string | null
    state?: string | null
    postal_code?: string | null
    country?: string | null
  } | null
}

export type IdExtractionBatchItem = {
  id: string
  position: number
  image_url: string
  status: "pending" | "processing" | "completed" | "failed" | "approved"
  draft?: IdExtractionDraft | null
  person_id?: string | null
  error?: string | null
  attempts: number
  attempted_at?: string | null
}

export type IdExtractionBatch = {
  id: string
  partner_id?: string | null
  status: "pending_confirmation" | "running" | "completed" | "failed"
  interval_ms: number
  transaction_id?: string | null
  notes?: string | null
  started_at?: string | null
  finished_at?: string | null
  total: number
  completed: number
  failed: number
  approved: number
  pending: number
  /**
   * 🔴 Read this, not `status`.
   *
   * A deploy kills the in-process loop without warning and the row keeps
   * saying `running` (#1742). `outstanding` is derived from the item rows, so
   * it is the field that disagrees when that happens — and the one that tells
   * an operator a "finished" batch has work left in it.
   */
  outstanding: number
}

export type IdExtractionBatchResponse = {
  batch: IdExtractionBatch
  items: IdExtractionBatchItem[]
}

/** True once the server has stopped working on this batch, either way. */
export const isBatchSettled = (batch?: IdExtractionBatch | null): boolean =>
  batch?.status === "completed" || batch?.status === "failed"

export const useIdExtractionBatch = (
  id: string,
  options?: Omit<
    UseQueryOptions<
      IdExtractionBatchResponse,
      FetchError,
      IdExtractionBatchResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >,
) => {
  const { data, ...rest } = useQuery({
    queryKey: idExtractionBatchQueryKeys.detail(id),
    queryFn: () =>
      sdk.client.fetch<IdExtractionBatchResponse>(
        `/partners/people/id-extraction/batch/${id}`,
        { method: "GET" },
      ),
    enabled: Boolean(id),
    ...options,
  })
  return { ...data, ...rest }
}

/** One fetch, outside React — what the toast poller uses. */
export const fetchIdExtractionBatch = (id: string) =>
  sdk.client.fetch<IdExtractionBatchResponse>(
    `/partners/people/id-extraction/batch/${id}`,
    { method: "GET" },
  )

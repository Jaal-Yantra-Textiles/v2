import { FetchError } from "@medusajs/js-sdk"
import {
  QueryKey,
  UseMutationOptions,
  UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"

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

/**
 * A row from the list route.
 *
 * ⚠️ The counts are optional here and required on the detail response, and
 * that is not sloppiness: the list computes them per batch inside a try/catch
 * and returns the bare row if the item fetch throws. A type that promised them
 * would make `0 of 0 read` out of a failure.
 */
export type IdExtractionBatchSummary = Omit<
  IdExtractionBatch,
  "total" | "completed" | "failed" | "approved" | "pending" | "outstanding"
> &
  Partial<
    Pick<
      IdExtractionBatch,
      "total" | "completed" | "failed" | "approved" | "pending" | "outstanding"
    >
  > & {
    created_at?: string | null
  }

export type IdExtractionBatchListResponse = {
  batches: IdExtractionBatchSummary[]
  count: number
  limit: number
  offset: number
}

/** The partner's own batches, newest first. Never takes a partner id — the
 * route scopes on the authenticated actor and a body that could name another
 * partner is the cross-tenant read this platform guards against. */
export const useIdExtractionBatches = (
  query?: { limit?: number; offset?: number },
  options?: Omit<
    UseQueryOptions<
      IdExtractionBatchListResponse,
      FetchError,
      IdExtractionBatchListResponse,
      QueryKey
    >,
    "queryFn" | "queryKey"
  >,
) =>
  useQuery({
    queryKey: idExtractionBatchQueryKeys.list(query ?? {}),
    queryFn: () =>
      sdk.client.fetch<IdExtractionBatchListResponse>(
        "/partners/people/id-extraction/batch",
        { method: "GET", query: query as Record<string, unknown> },
      ),
    ...options,
  })

export type ApproveIdExtractionBatchPayload = {
  /** Omitted means "every item with a usable draft". */
  item_ids?: string[]
  /** Operator fixes, keyed by item id — the only place a corrected name lands. */
  corrections?: Record<string, Record<string, unknown>>
}

export type ApproveIdExtractionBatchResponse = {
  message: string
  batch_id: string
  approved: number
  skipped: number
  results: {
    item_id: string
    status: string
    person_id?: string | null
    reason?: string | null
  }[]
}

/**
 * 🔴 The only door from a draft to a person.
 *
 * ⚠️ `...options` goes BEFORE `onSuccess`, not after. Spread last it silently
 * replaces the invalidation and the screen keeps showing pre-approval drafts
 * until a hard refresh — the #1800 shape, which is still live in
 * `partner-goods-transfers.tsx` a few files over.
 */
export const useApproveIdExtractionBatch = (
  batchId: string,
  options?: UseMutationOptions<
    ApproveIdExtractionBatchResponse,
    FetchError,
    ApproveIdExtractionBatchPayload
  >,
) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: ApproveIdExtractionBatchPayload) =>
      sdk.client.fetch<ApproveIdExtractionBatchResponse>(
        `/partners/people/id-extraction/batch/${batchId}/approve`,
        { method: "POST", body: payload },
      ),
    ...options,
    onSuccess: (...args) => {
      queryClient.invalidateQueries({
        queryKey: idExtractionBatchQueryKeys.all,
      })
      options?.onSuccess?.(...args)
    },
  })
}

export type RetryIdExtractionBatchResponse = {
  success: boolean
  message: string
  batch_id: string
  /** Present only when there was nothing outstanding — a no-op, not a failure. */
  nothing_to_do?: boolean
  scope?: "failed" | "pending"
  outstanding?: number
}

/**
 * Re-run what is outstanding. `failed` re-reads only the failures; `pending`
 * also picks up photographs never attempted — the shape a batch is left in
 * when a deploy kills the background loop and the row keeps saying `running`
 * (#1742). It is a resume: already-read photographs are not paid for twice.
 */
export const useRetryIdExtractionBatch = (
  batchId: string,
  options?: UseMutationOptions<
    RetryIdExtractionBatchResponse,
    FetchError,
    { scope?: "failed" | "pending" } | void
  >,
) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vars) =>
      sdk.client.fetch<RetryIdExtractionBatchResponse>(
        `/partners/people/id-extraction/batch/${batchId}/retry`,
        { method: "POST", query: { scope: vars?.scope ?? "failed" } },
      ),
    ...options,
    onSuccess: (...args) => {
      queryClient.invalidateQueries({
        queryKey: idExtractionBatchQueryKeys.all,
      })
      options?.onSuccess?.(...args)
    },
  })
}

export type ConfirmIdExtractionBatchResponse = {
  success: boolean
  message: string
  batch_id: string
  /** Confirming twice is a double-click, not an error. */
  already?: boolean
}

/** Starts the read on a batch still waiting at `pending_confirmation`. */
export const useConfirmIdExtractionBatch = (
  batchId: string,
  options?: UseMutationOptions<
    ConfirmIdExtractionBatchResponse,
    FetchError,
    void
  >,
) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      sdk.client.fetch<ConfirmIdExtractionBatchResponse>(
        `/partners/people/id-extraction/batch/${batchId}/confirm`,
        { method: "POST" },
      ),
    ...options,
    onSuccess: (...args) => {
      queryClient.invalidateQueries({
        queryKey: idExtractionBatchQueryKeys.all,
      })
      options?.onSuccess?.(...args)
    },
  })
}

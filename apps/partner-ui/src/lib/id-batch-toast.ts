import { toast } from "@medusajs/ui"

import {
  fetchIdExtractionBatch,
  isBatchSettled,
  type IdExtractionBatch,
} from "../hooks/api/id-extraction-batch"

/**
 * The progress toast for a batch of ID cards (#1816).
 *
 * Reading ten cards takes about three and a half minutes — measured on prod
 * batch 01M1R4XVAEW82NBDY9TZ4SQY8N — because the photographs are paced one at a
 * time on a clamped interval so the vision provider is never hammered. That is
 * far too long to block on and long enough that the operator will walk away.
 *
 * 🔴 So this toast is the OPTIMISTIC path only. The durable one is the bell:
 * the workflow posts a partner notification with the final counts, which
 * survives a closed tab, a reload, and this toast being dismissed. Nothing here
 * is the record of what happened — if the two ever disagree, the bell is right.
 */

/** How often to ask the server. Cheap read; well under the 20s photo pace. */
const POLL_INTERVAL_MS = 8_000

/**
 * Stop polling well after the work should have finished rather than never.
 * A batch whose background loop was killed by a deploy (#1742) keeps saying
 * `running` forever, and a poller with no ceiling would too.
 */
const pollCeilingMs = (batch: IdExtractionBatch): number =>
  Math.min(batch.total * batch.interval_ms * 3 + 120_000, 45 * 60_000)

/** Consecutive failed polls tolerated before giving up on the toast. */
const MAX_CONSECUTIVE_ERRORS = 3

const toastId = (batchId: string) => `id-batch:${batchId}`

const progressText = (b: IdExtractionBatch): string => {
  const done = b.completed + b.failed + b.approved
  const parts = [`${done} of ${b.total} read`]
  if (b.failed > 0) parts.push(`${b.failed} failed`)
  return parts.join(" · ")
}

/**
 * The batch id from a `create_id_extraction_batch` result, or null.
 *
 * ⚠️ The tool result arrives in whatever envelope the dispatcher used — the
 * route's 202 body, or that body under `data`. Reading only one of the two
 * shapes is how a working feature silently does nothing, so both are tried and
 * anything else returns null rather than guessing.
 */
export function idExtractionBatchIdFrom(
  name: string,
  result: any
): string | null {
  if (name !== "create_id_extraction_batch") return null
  const body = result?.data ?? result
  const id = body?.batch_id
  return typeof id === "string" && id ? id : null
}

export type WatchIdBatchOptions = {
  /** Called once the batch settles, so a caller can refresh a list. */
  onSettled?: (batch: IdExtractionBatch) => void
  /** Called when the operator clicks through from the finished toast. */
  onReview?: (batchId: string) => void
}

/**
 * Show a progress toast for `batchId` and keep it current until the batch
 * settles. Returns a function that stops the polling (the toast is left alone —
 * dismissing someone's notification because a component unmounted is worse than
 * a stale one they can close).
 */
export function watchIdExtractionBatch(
  batchId: string,
  options: WatchIdBatchOptions = {},
): () => void {
  const id = toastId(batchId)
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let errors = 0
  const startedAt = Date.now()

  toast.loading("Reading ID cards", {
    id,
    description:
      "One photograph at a time so the reader is not overloaded. You can leave this page — the result will be in your notifications.",
    duration: Infinity,
    dismissable: true,
  })

  const settle = (batch: IdExtractionBatch) => {
    stopped = true
    const readable = batch.completed + batch.approved

    if (readable === 0) {
      toast.error("No ID cards could be read", {
        id,
        description: `${batch.failed} failed. Nothing was added to your people — retry the batch or re-photograph the cards.`,
        duration: 10_000,
      })
    } else {
      const parts = [`${readable} of ${batch.total} read`]
      if (batch.failed > 0) parts.push(`${batch.failed} failed`)
      if (batch.outstanding > 0) {
        parts.push(`${batch.outstanding} still outstanding`)
      }
      toast.success("ID cards read", {
        id,
        description: `${parts.join(", ")}. Nobody is added to your people until you approve the drafts.`,
        duration: 10_000,
        ...(options.onReview
          ? {
              action: {
                label: "Review drafts",
                altText: "Review the drafts read from these ID cards",
                onClick: () => options.onReview?.(batchId),
              },
            }
          : {}),
      })
    }

    options.onSettled?.(batch)
  }

  const tick = async () => {
    if (stopped) return

    try {
      const { batch } = await fetchIdExtractionBatch(batchId)
      errors = 0

      if (isBatchSettled(batch)) {
        settle(batch)
        return
      }

      /**
       * A batch that claims to be running long after it should have finished
       * is the #1742 shape: the loop is gone and the row was never updated.
       * Say so rather than spinning forever.
       */
      if (Date.now() - startedAt > pollCeilingMs(batch)) {
        stopped = true
        toast.warning("ID card batch has gone quiet", {
          id,
          description: `${progressText(batch)}. It has stopped making progress — ask the assistant to retry the outstanding cards.`,
          duration: 12_000,
        })
        return
      }

      toast.loading("Reading ID cards", {
        id,
        description: `${progressText(batch)}. You can leave this page.`,
        duration: Infinity,
        dismissable: true,
      })
    } catch {
      errors += 1
      if (errors >= MAX_CONSECUTIVE_ERRORS) {
        stopped = true
        toast.warning("Lost track of the ID card batch", {
          id,
          description:
            "It is still running on the server — the result will arrive in your notifications.",
          duration: 8_000,
        })
        return
      }
    }

    timer = setTimeout(() => void tick(), POLL_INTERVAL_MS)
  }

  timer = setTimeout(() => void tick(), POLL_INTERVAL_MS)

  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
  }
}

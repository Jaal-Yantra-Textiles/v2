/**
 * One acknowledgement per burst of files, not one per file.
 *
 * ## The problem
 *
 * #2138 made the QUESTION ("what are these photos for?") arrive once per burst,
 * because asking eight times for eight photos is worse than guessing. But the
 * acknowledgement beside it was left firing per message: every photo that
 * landed in a shared folder, attached to a run, or matched a live photo context
 * sent its own reply. A partner sending twelve swatches got twelve
 * near-identical messages, each one a push notification.
 *
 * That is not cosmetic. It buries anything we actually needed them to read, and
 * it is the same misreading the batch exists to correct: a burst of photos is
 * ONE event that happens to arrive as twelve webhooks.
 *
 * ## The rule
 *
 * A successful upload records itself here and sends nothing. The sweep
 * (`jobs/send-media-ack-batches.ts`) sends one reply once the partner has gone
 * quiet, naming the count.
 *
 * 🔑 The wait is measured from the LAST file, like the photo batch — a partner
 * still uploading at 20 seconds has not finished. And the ceiling is measured
 * from the FIRST, so a slow trickle still gets one acknowledgement rather than
 * none.
 *
 * ## What is deliberately NOT deferred
 *
 * Errors. "Couldn't attach to the run" is per-file information and rare; a
 * partner who needs to re-send one file should not learn that half a minute
 * later, batched with successes. Silence is the failure mode that matters here,
 * and an immediate error is never silence.
 *
 * ## Why the window is shorter than the question's
 *
 * The question waits 90 seconds because it is asking the partner to think. An
 * acknowledgement is only saying "received", and a partner who sends one file
 * and hears nothing for a minute and a half assumes it failed and sends it
 * again. 25 seconds is long enough to swallow a burst — WhatsApp uploads
 * arrive seconds apart — and short enough to still read as a reply.
 */

/** How long the partner must be quiet before a burst is acknowledged. */
export const MEDIA_ACK_QUIET_MS = 25_000

/**
 * How long a burst may stay open before it is acknowledged anyway.
 *
 * Without it a partner uploading one file every 20 seconds is never
 * acknowledged at all — each file pushes the quiet window out.
 */
export const MEDIA_ACK_MAX_AGE_MS = 3 * 60_000

/**
 * Where a file went. The acknowledgement has to say something true about the
 * destination, and one burst can legitimately contain more than one kind — a
 * partner may send two run photos and a fabric picture in the same thirty
 * seconds.
 */
export type MediaAckKind = "shared_folder" | "run" | "context"

export type MediaAckEntry = {
  kind: MediaAckKind
  /** The shared folder's name, the run id, or a context confirmation line. */
  label: string | null
}

export type MediaAckBatch = {
  /** `messaging_message` ids, in arrival order. Length is the file count. */
  message_ids: string[]
  /** Index-aligned with `message_ids` — where each file went. */
  entries: MediaAckEntry[]
  /** ISO — when the first file of this burst arrived. */
  first_at: string
  /** ISO — when the most recent file arrived. Resets the quiet window. */
  last_at: string
  /** ISO — when the acknowledgement was sent. Set once; never re-sent. */
  acked_at?: string | null
}

const ms = (v: string | null | undefined): number | null => {
  if (!v) return null
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : null
}

/**
 * PURE: add one delivered file to the burst.
 *
 * A batch that has already been acknowledged starts a fresh one — the partner
 * sending more files after we replied is a new event, not a continuation of a
 * conversation we already closed.
 */
export function recordMediaAck(
  batch: MediaAckBatch | null | undefined,
  messageId: string,
  entry: MediaAckEntry,
  now: Date = new Date()
): MediaAckBatch {
  const iso = now.toISOString()

  if (!batch || batch.acked_at) {
    return {
      message_ids: [messageId],
      entries: [entry],
      first_at: iso,
      last_at: iso,
      acked_at: null,
    }
  }

  /**
   * Idempotent on message id. Meta re-delivers a webhook when our response is
   * slow, and counting one file twice would tell the partner we received
   * thirteen swatches when they sent twelve — a number they can check, and
   * being wrong about it costs more than saying nothing.
   */
  const already = batch.message_ids.includes(messageId)
  const ids = already ? batch.message_ids : [...batch.message_ids, messageId]
  // Kept index-aligned with message_ids, including on the redelivery path.
  const entries = already ? batch.entries ?? [] : [...(batch.entries ?? []), entry]

  return {
    message_ids: ids,
    entries,
    first_at: batch.first_at || iso,
    last_at: iso,
    acked_at: null,
  }
}

export type MediaAckDecision =
  | { action: "skip"; reason: "no_batch" | "already_acked" }
  | { action: "wait"; reason: "still_sending"; files: number }
  | { action: "ack"; reason: "settled" | "max_age"; files: number }

/**
 * PURE: has the partner stopped sending?
 *
 * Has no opinion on what the acknowledgement should SAY — only on whether the
 * burst is over.
 */
export function decideMediaAckAction(
  batch: MediaAckBatch | null | undefined,
  now: Date = new Date(),
  quietMs: number = MEDIA_ACK_QUIET_MS,
  maxAgeMs: number = MEDIA_ACK_MAX_AGE_MS
): MediaAckDecision {
  if (!batch || !batch.message_ids?.length) {
    return { action: "skip", reason: "no_batch" }
  }
  if (batch.acked_at) {
    return { action: "skip", reason: "already_acked" }
  }

  const files = batch.message_ids.length
  const nowMs = now.getTime()
  const last = ms(batch.last_at)
  const first = ms(batch.first_at)

  /**
   * An undateable batch is acknowledged rather than held forever. The files
   * exist and the partner is waiting; leaving them unanswered is the worse
   * half of the choice.
   */
  if (last == null) {
    return { action: "ack", reason: "settled", files }
  }

  if (first != null && nowMs - first >= maxAgeMs) {
    return { action: "ack", reason: "max_age", files }
  }

  if (nowMs - last >= quietMs) {
    return { action: "ack", reason: "settled", files }
  }

  return { action: "wait", reason: "still_sending", files }
}

/**
 * PURE: the acknowledgement for a settled burst.
 *
 * Names the count, because a partner who sent twelve files and is told
 * "received your file" cannot tell whether the other eleven arrived. The count
 * is the only part of this message they can actually check us on.
 *
 * A mixed burst is described by destination rather than flattened, so "two on
 * the run, one in the folder" does not become a single wrong sentence.
 */
export function buildMediaAckText(batch: MediaAckBatch): string {
  const entries = batch.entries ?? []
  const total = batch.message_ids.length
  const files = total === 1 ? "1 file" : `${total} files`

  const runIds = Array.from(
    new Set(
      entries.filter((e) => e?.kind === "run" && e.label).map((e) => e.label as string)
    )
  )
  const folders = Array.from(
    new Set(
      entries
        .filter((e) => e?.kind === "shared_folder" && e.label)
        .map((e) => e.label as string)
    )
  )
  const contextLines = Array.from(
    new Set(
      entries
        .filter((e) => e?.kind === "context" && e.label)
        .map((e) => e.label as string)
    )
  )

  const parts: string[] = []
  if (runIds.length === 1) {
    parts.push(`attached to run ${runIds[0]}`)
  } else if (runIds.length > 1) {
    parts.push(`attached to runs ${runIds.join(", ")}`)
  }
  if (folders.length === 1) {
    parts.push(`saved to *${folders[0]}*`)
  } else if (folders.length > 1) {
    parts.push(`saved to ${folders.map((f) => `*${f}*`).join(" and ")}`)
  }

  const where = parts.length ? ` — ${parts.join(", ")}` : ""
  const head = `✅ Got ${files}${where}.`

  // A context confirmation is something an admin chose to say; it is appended
  // verbatim rather than summarised, because rewording it would change what
  // was promised.
  return contextLines.length ? `${head}\n\n${contextLines.join("\n")}` : head
}

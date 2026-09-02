/**
 * What a folder-wide textile extraction still owes, and whether the run that
 * was supposed to deliver it is still alive (#1742).
 *
 * ## Why this file exists
 *
 * `processFolderMediaSequentiallyStep` is ONE step containing a `for` loop with
 * `await sleep()` inside it. The loop lives in the Node process, so an ECS task
 * replacement — a deploy — takes it with it. Medusa cannot recover from that:
 * the step is `async: true, backgroundExecution: true`, so the engine sits
 * waiting for a callback from a process that no longer exists. Measured on
 * production 2026-09-02: folder `01KZTFAA2TFN5RXFVDMD2RAWZG` stopped at 18 of
 * 62 when the 02:29→03:06 deploy replaced the task mid-run, and every one of
 * the five `textile-folder-extraction` executions ever started is still sitting
 * in `invoking`.
 *
 * Two things were missing, and both are here:
 *
 * 1. **A way to know.** `status` stays the string `"running"` forever, because
 *    a process that dies writes nothing — least of all "I died". The status is
 *    a claim about the past, and the only evidence of liveness is how long ago
 *    it was written. {@link folderExtractionLiveness} turns that into an answer.
 *
 * 2. **A work-list derived from STATE, not from a fixed list.** This is the
 *    shape `backfillAllGeocodesWorkflow` already uses: its
 *    `getAllUngeocodedAddressesStep` asks which addresses still lack a geocode,
 *    so re-running it is automatically a resume and running it twice is
 *    harmless. Folder extraction asked for "every image in the folder" instead,
 *    which makes a re-run a full re-do — 62 vision calls to recover 44, and a
 *    duplicate `textile_analysis` row for each of the 18 already done.
 *    {@link pendingFolderExtractionMedia} is the geocode question, asked about
 *    images.
 *
 * 🔴 "Pending" is deliberately defined as *has no `textile_analysis` row*, NOT
 * as *appears in `folder_extraction.errors`*. The retry route used the second
 * definition and could therefore only ever see the 1 file that failed loudly —
 * the 43 that were never attempted at all are not errors, and no route in the
 * system could reach them. A file the run never got to and a file the run
 * failed on are the same thing to the work that remains.
 */

import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"

import { MEDIA_MODULE } from "../../../modules/media"
import MediaTextileAnalysisLink from "../../../links/media-textile-analysis-link"

/** Never call a run stalled sooner than this, however tight the pacing. */
export const MIN_STALL_THRESHOLD_MS = 10 * 60 * 1000

/**
 * How many intervals of silence before a run is presumed dead.
 *
 * Progress is written after EVERY item, so one missed write is already odd.
 * Three is slack for a slow vision call — measured pace on production is ~3.2
 * min per photo against a 60 s `interval_ms`, because the extraction itself
 * costs ~2.2 min on top of the sleep.
 */
export const STALL_INTERVAL_MULTIPLIER = 3

export type LivenessInput = {
  status?: string | null
  updated_at?: string | null
  interval_ms?: number | null
}

export type Liveness = {
  /** True only for a run that CLAIMS to be running and has gone quiet. */
  stalled: boolean
  /** Milliseconds since the last progress write, or null if never written. */
  silent_for_ms: number | null
  /** The silence this run was judged against. */
  threshold_ms: number
}

/**
 * Whether a run claiming to be `running` has actually stopped.
 *
 * ⚠️ Only `running` can stall. A `completed` or `failed` run is finished and
 * silence is expected — reporting those as stalled would put a Resume button on
 * every folder that has ever been extracted.
 *
 * ⚠️ An unparseable or missing `updated_at` is NOT stalled. A missing timestamp
 * is an absence of evidence, and killing a live run on the strength of one
 * would be worse than leaving a dead one alone for a human to notice.
 */
export const folderExtractionLiveness = (
  progress: LivenessInput | null | undefined,
  now: Date = new Date()
): Liveness => {
  const interval = Number(progress?.interval_ms ?? 0) || 0
  const threshold_ms = Math.max(
    MIN_STALL_THRESHOLD_MS,
    interval * STALL_INTERVAL_MULTIPLIER
  )

  if (!progress || String(progress.status ?? "") !== "running") {
    return { stalled: false, silent_for_ms: null, threshold_ms }
  }

  const updatedAt = progress.updated_at ? Date.parse(progress.updated_at) : NaN
  if (!Number.isFinite(updatedAt)) {
    return { stalled: false, silent_for_ms: null, threshold_ms }
  }

  const silent_for_ms = Math.max(0, now.getTime() - updatedAt)

  return {
    stalled: silent_for_ms > threshold_ms,
    silent_for_ms,
    threshold_ms,
  }
}

export type PendingFolderMedia = {
  /** Every image in the folder, in the order the run would process them. */
  all_media_ids: string[]
  /** Those with no `textile_analysis` row yet — the work that remains. */
  pending_media_ids: string[]
  /** Those that already have one. */
  done_media_ids: string[]
}

/**
 * Which images in a folder have never been successfully analysed.
 *
 * 🔴 The link is read through `MediaTextileAnalysisLink.entryPoint`, not by
 * asking the media entity for a linked field. `query.graph` from an ENTITY to a
 * linked field returns no key at all — silently — and a folder whose images
 * were all analysed would come back looking entirely pending, which here means
 * re-billing every vision call in it.
 *
 * ⚠️ Ordered by `created_at ASC`, the same order `listFolderMediaStep` uses, so
 * a resumed run continues through the folder rather than restarting the
 * sequence somewhere arbitrary.
 */
export const pendingFolderExtractionMedia = async (
  container: MedusaContainer,
  folder_id: string
): Promise<PendingFolderMedia> => {
  const mediaService: any = container.resolve(MEDIA_MODULE)
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

  const mediaFiles = await mediaService.listMediaFiles(
    { folder_id },
    { select: ["id", "file_path", "file_type"], order: { created_at: "ASC" } }
  )

  const all_media_ids: string[] = (mediaFiles || [])
    .filter((f: any) => f.file_type === "image" && f.file_path)
    .map((f: any) => String(f.id))

  if (!all_media_ids.length) {
    return { all_media_ids: [], pending_media_ids: [], done_media_ids: [] }
  }

  /**
   * 🔴 Deliberately NOT wrapped in a try/catch. An unreachable link would
   * report every image as pending, and the caller would then pay for a full
   * re-extraction believing it was resuming. Letting the error out is the
   * recoverable outcome; swallowing it spends money and overwrites good
   * results. This is the opposite of `writeProgress`, where a failure must
   * never take the run down — there, losing a progress write costs a stale
   * number; here, losing the answer costs 62 vision calls.
   */
  const { data } = await query.graph({
    entity: MediaTextileAnalysisLink.entryPoint,
    fields: ["media_file_id", "textile_analysis_id"],
    filters: { media_file_id: all_media_ids },
  })

  const analysed = new Set<string>()
  for (const row of (data || []) as any[]) {
    const id = row?.media_file_id
    if (id) analysed.add(String(id))
  }

  return {
    all_media_ids,
    pending_media_ids: all_media_ids.filter((id) => !analysed.has(id)),
    done_media_ids: all_media_ids.filter((id) => analysed.has(id)),
  }
}

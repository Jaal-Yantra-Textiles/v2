import type InstagramService from "./instagram-service"

/** A Reel still processing this long after it was started is given up on. */
export const PENDING_REEL_MAX_AGE_MS = 60 * 60 * 1000

export type PendingReel = {
  container_id: string
  ig_user_id: string
  started_at: string
}

/** What to write back to the post after one check. `null` = leave it alone. */
export type PendingReelOutcome =
  | { kind: "still-processing" }
  | {
      kind: "posted"
      media_id: string
      permalink?: string
    }
  | { kind: "failed"; error: string }

/**
 * One check of a pending Instagram Reel: still processing, now published, or
 * failed. Pure apart from the Graph calls on `ig`, so it can be tested with a
 * fake. The job (jobs/finish-instagram-reels.ts) applies the outcome.
 */
export async function checkPendingReel(
  pending: PendingReel,
  accessToken: string,
  ig: Pick<InstagramService, "checkContainerStatus" | "publishReadyContainer" | "getMediaPermalink">,
  now: Date = new Date()
): Promise<PendingReelOutcome> {
  const status = await ig.checkContainerStatus(pending.container_id, accessToken)

  if (status.status_code === "FINISHED") {
    const published = await ig.publishReadyContainer(pending.ig_user_id, pending.container_id, accessToken)
    let permalink: string | undefined
    try {
      permalink = await ig.getMediaPermalink(published.id, accessToken)
    } catch {
      // best effort, as on the in-request path
    }
    return { kind: "posted", media_id: published.id, permalink }
  }

  if (status.status_code === "ERROR" || status.status_code === "EXPIRED") {
    return {
      kind: "failed",
      error: `instagram: Instagram could not process the Reel video (${status.status_code}${status.status ? `: ${status.status}` : ""})`,
    }
  }

  const age = now.getTime() - new Date(pending.started_at).getTime()
  if (Number.isFinite(age) && age > PENDING_REEL_MAX_AGE_MS) {
    return {
      kind: "failed",
      error: `instagram: the Reel was still processing after ${Math.round(PENDING_REEL_MAX_AGE_MS / 60000)} minutes; publish it again`,
    }
  }

  return { kind: "still-processing" }
}

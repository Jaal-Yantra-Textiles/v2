/**
 * A rollback this long after the assignment is the WAIT expiring, not the send
 * failing. Kickoff (claim → link → tasks → notify) finishes in seconds; the
 * only thing that rolls back an hour later is `awaitOrderStart` /
 * `awaitOrderCompletion` hitting AWAIT_TIMEOUT_SECONDS (23 days).
 */
export const KICKOFF_GRACE_MS = 60 * 60 * 1000

/**
 * True when a rollback happened long after the partner was assigned, i.e.
 * the 23-day wait ran out.
 */
export const isWaitExpiry = (
    assignedAtIso: string | null | undefined,
    nowMs: number = Date.now()
): boolean => {
    if (!assignedAtIso) {
        return false
    }
    const at = Date.parse(assignedAtIso)
    return Number.isFinite(at) && nowMs - at > KICKOFF_GRACE_MS
}

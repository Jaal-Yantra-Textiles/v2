/**
 * The tasks a partner should see on a production run.
 *
 * A run that is re-dispatched (taken off a partner who never accepted, then
 * handed back) keeps its first dispatch's tasks, cancelled, beside the new
 * ones. Every partner client rendered `run.tasks` unfiltered, so the partner
 * saw "Stitching" twice — one cancelled, one pending — with only a small grey
 * caption telling them apart, and progress counted the dead rows ("0/7 tasks").
 *
 * On a live run, a cancelled task is history, not work: drop it. On a cancelled
 * run every task is cancelled and that IS the story, so keep them all.
 */
export const partnerVisibleRunTasks = <T extends { status?: unknown }>(
  tasks: T[] | null | undefined,
  runStatus: unknown
): T[] => {
  const list = Array.isArray(tasks) ? tasks : []
  if (String(runStatus) === "cancelled") return list
  return list.filter((t) => String(t?.status) !== "cancelled")
}

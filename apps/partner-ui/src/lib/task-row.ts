/**
 * Pure derivation for a compact run-task row (#2019).
 *
 * The run card used to render a full `InlineTaskCard` per task — accept/finish
 * buttons, a cost input and every subtask checkbox, stacked. With three tasks
 * that is most of a screen, and #2018 had just finished pulling the page's
 * primary action to the top; the task column pushed everything back down.
 *
 * A row shows state and the ONE button that matters, and the detail opens in
 * the drawer that already exists at `/orders/:id/tasks/:task_id`. The button
 * stays on the row on purpose: the tasks ARE the work, and putting the work
 * itself behind a click is the mistake that would undo #2018.
 */

export type TaskRowAction = "accept" | "finish" | null

export type TaskRow = {
  id: string
  title: string
  status: string
  isCompleted: boolean
  /** The single primary action available, or null when there is nothing to do. */
  action: TaskRowAction
  subtasksDone: number
  subtasksTotal: number
  /** Does finishing need a cost? Drives whether the row defers to the drawer. */
  needsCost: boolean
}

const ACCEPTABLE = new Set(["pending", "assigned"])
const FINISHABLE = new Set(["accepted", "in_progress"])

/**
 * The status strings come straight from the task row and are matched by the
 * same sets `InlineTaskCard` uses, so a row and its drawer cannot disagree
 * about whether a task is actionable.
 */
export const deriveTaskRow = (task: Record<string, any> | null | undefined): TaskRow => {
  const t = task ?? {}
  const status = String(t.status || "pending")
  const subtasks = Array.isArray(t.subtasks) ? t.subtasks : []

  const isCompleted = status === "completed"
  let action: TaskRowAction = null
  if (ACCEPTABLE.has(status)) {
    action = "accept"
  } else if (FINISHABLE.has(status)) {
    action = "finish"
  }

  return {
    id: String(t.id ?? ""),
    title: String(t.title ?? ""),
    status,
    isCompleted,
    action,
    subtasksDone: subtasks.filter(
      (s: any) => String(s?.status) === "completed"
    ).length,
    subtasksTotal: subtasks.length,
    /**
     * `estimated_cost` of 0 still means "this task is costed" — the finish
     * flow prompts for an actual. `Number(null)` is 0, so a truthiness check
     * would read an uncosted task as costed-at-zero and vice versa; only the
     * presence of the field answers it.
     */
    needsCost: t.estimated_cost !== null && t.estimated_cost !== undefined,
  }
}

/** Progress across a run's tasks, for the section header. */
export const summarizeTaskRows = (
  tasks: ReadonlyArray<Record<string, any>> | null | undefined
): { total: number; completed: number; actionable: number } => {
  const rows = (Array.isArray(tasks) ? tasks : []).map(deriveTaskRow)
  return {
    total: rows.length,
    completed: rows.filter((r) => r.isCompleted).length,
    actionable: rows.filter((r) => r.action !== null).length,
  }
}

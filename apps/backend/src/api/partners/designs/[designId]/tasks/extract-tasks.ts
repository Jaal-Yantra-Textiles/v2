/**
 * @file Pure task-extraction helper for the partner design "tasks" read.
 * @module API/Partners/Designs/Tasks
 *
 * Roadmap #6 — promote admin Designs to partner-ui. Mirrors
 * `GET /admin/designs/:id/tasks`. Tasks are direct children of the
 * design, so the security boundary is the design-ownership guard
 * (`assertPartnerOwnsDesign`) — once a partner owns the design, every
 * task on it is theirs; there is no cross-design / cross-tenant relation
 * to leak through here.
 *
 * The admin route reads `tasks[0].tasks` directly, which throws when the
 * `query.graph` result is empty (no row for the id). This pure helper
 * normalizes that access so the partner route always returns a clean
 * array, never a runtime crash.
 */

export type DesignTasksRow = {
  id?: string
  tasks?: unknown[] | null
  [key: string]: unknown
}

/**
 * Safely pull the `tasks` array out of a `query.graph({ entity: "design",
 * fields: ["tasks.*"] })` result.
 *
 * @param rows The `data` array returned by query.graph (design rows).
 * @returns The design's tasks, or an empty array when the design row or
 *          its tasks are missing/unresolved.
 */
export function extractDesignTasks(
  rows: DesignTasksRow[] | null | undefined
): unknown[] {
  const tasks = (rows || [])[0]?.tasks
  return Array.isArray(tasks) ? tasks : []
}

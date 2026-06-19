/**
 * Pure helper — selects the IDs of the tasks created by
 * `createTasksFromTemplatesWorkflow`, mirroring the admin route's branching on
 * the workflow-response flags (`withTemplates` / `withParent` / `withoutTemplates`).
 *
 * Extracted so it is unit-testable without booting Medusa (no partner-design
 * integration harness exists). Unlike the admin route — which indexes
 * `taskLinks[0].id` directly and would throw on an empty array — this helper is
 * defensive: it never throws on missing/empty input.
 */

export type TaskCreationFlags = {
  withTemplates?: boolean
  withParent?: boolean
  withoutTemplates?: boolean
}

export type CreatedTaskLink = { id?: string | null }

export function selectCreatedTaskIds(
  flags: TaskCreationFlags | null | undefined,
  taskLinks: CreatedTaskLink[] | null | undefined
): string[] {
  if (!Array.isArray(taskLinks) || taskLinks.length === 0) {
    return []
  }

  const ids = (links: CreatedTaskLink[]): string[] =>
    links.map((t) => t?.id).filter((id): id is string => Boolean(id))

  if (flags?.withTemplates) {
    return ids(taskLinks)
  }
  if (flags?.withParent) {
    return ids(taskLinks)
  }
  if (flags?.withoutTemplates) {
    return ids(taskLinks.slice(0, 1))
  }

  return []
}

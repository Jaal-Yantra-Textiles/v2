import { Button, Text, clx, toast } from "@medusajs/ui"
import { Link } from "react-router-dom"

import {
  useAcceptPartnerAssignedTask,
} from "../../hooks/api/partner-assigned-tasks"
import { extractErrorMessage } from "../../lib/extract-error-message"
import { deriveTaskRow } from "../../lib/task-row"

/**
 * One run task, as a row (#2019).
 *
 * Replaces a full `InlineTaskCard` per task inside the run card. Three tasks
 * rendered as cards — accept/finish buttons, a cost input and every subtask
 * checkbox each — was most of a screen, and it sat directly under the primary
 * action #2018 had just pulled to the top.
 *
 * 🔑 The primary button STAYS on the row. The tasks are the work; putting the
 * work itself behind a click is the mistake that would undo #2018. What moves
 * to the drawer is the detail — subtasks, notes, the cost entry.
 *
 * Accept is safe to do inline: it takes no input. FINISH is not — it prompts
 * for an actual cost whenever the task is costed — so a costed task links to
 * the drawer instead of pretending one tap will finish it.
 */
export const TaskRow = ({
  task,
  linkBase,
}: {
  task: Record<string, any>
  /**
   * Where the task drawer lives, relative to the current route — `tasks` on
   * the order detail, resolving to `/orders/:id/tasks/:task_id`. Omitted on
   * the design page, which has no such drawer; the row then shows state only.
   */
  linkBase?: string
}) => {
  const row = deriveTaskRow(task)
  const acceptTask = useAcceptPartnerAssignedTask(row.id)

  const handleAccept = async () => {
    try {
      await acceptTask.mutateAsync()
      toast.success(`Task "${row.title}" accepted`)
    } catch (e) {
      toast.error(extractErrorMessage(e))
    }
  }

  const to = linkBase ? `${linkBase}/${row.id}` : undefined

  const dot = row.isCompleted
    ? "bg-ui-tag-green-icon"
    : row.action
      ? "bg-ui-tag-orange-icon"
      : "bg-ui-border-base"

  return (
    <div className="flex items-center gap-x-3 py-1.5">
      <span
        className={clx("size-1.5 shrink-0 rounded-full", dot)}
        role="img"
        aria-label={
          row.isCompleted ? "Completed" : row.action ? "Needs action" : "Waiting"
        }
      />

      {to ? (
        <Link
          to={to}
          className="min-w-0 flex-1 truncate text-left text-sm hover:text-ui-fg-base"
        >
          <span className={row.isCompleted ? "text-ui-fg-muted" : ""}>
            {row.title}
          </span>
        </Link>
      ) : (
        <span className="min-w-0 flex-1 truncate text-sm">{row.title}</span>
      )}

      {row.subtasksTotal > 0 && (
        <Text size="xsmall" className="text-ui-fg-muted shrink-0 tabular-nums">
          {row.subtasksDone}/{row.subtasksTotal}
        </Text>
      )}

      <div className="shrink-0">
        {row.action === "accept" && (
          <Button
            size="small"
            variant="secondary"
            onClick={handleAccept}
            isLoading={acceptTask.isPending}
          >
            Accept
          </Button>
        )}
        {row.action === "finish" && to && (
          /**
           * Finish always goes to the drawer, never fires from the row: the
           * flow asks for an actual cost. A row button that navigated instead
           * of finishing would be a button that does not do what it says.
           *
           * The ellipsis is the difference the partner can see — conventionally
           * "this opens something" — and it is driven by whether the task is
           * actually costed, so an uncosted task does not promise a form it
           * will not show.
           */
          <Button size="small" variant="secondary" asChild>
            <Link to={to}>{row.needsCost ? "Finish…" : "Finish"}</Link>
          </Button>
        )}
      </div>
    </div>
  )
}

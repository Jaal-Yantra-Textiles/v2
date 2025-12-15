import { Badge, Button, Heading, Text, toast } from "@medusajs/ui"
import { useMemo, useState } from "react"
import { useParams } from "react-router-dom"

import { SectionRow } from "../../../components/common/section"
import { RouteDrawer, useRouteModal } from "../../../components/modals"
import {
  useAddPartnerAssignedTaskComment,
  useCompletePartnerAssignedTaskSubtask,
  usePartnerAssignedTask,
  usePartnerAssignedTaskComments,
  usePartnerAssignedTaskSubtasks,
} from "../../../hooks/api/partner-assigned-tasks"
import { getStatusBadgeColor } from "../../../lib/status-badge"

export const TaskSubtask = () => {
  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <RouteDrawer.Title asChild>
          <Heading>Subtask</Heading>
        </RouteDrawer.Title>
        <RouteDrawer.Description className="sr-only">
          View and complete a subtask
        </RouteDrawer.Description>
      </RouteDrawer.Header>
      <TaskSubtaskContent />
    </RouteDrawer>
  )
}

const TaskSubtaskContent = () => {
  const { id: taskId, subtaskId } = useParams()
  const { handleSuccess } = useRouteModal()

  const [comment, setComment] = useState("")

  const { task: parentTask } = usePartnerAssignedTask(taskId || "", {
    enabled: !!taskId,
  })

  const {
    subtasks,
    isError: isSubtasksError,
    error: subtasksError,
  } = usePartnerAssignedTaskSubtasks(taskId || "", {
    enabled: !!taskId,
  })

  const subtask = useMemo(() => {
    if (!subtaskId) {
      return undefined
    }

    return (subtasks || []).find((s) => String(s.id) === String(subtaskId))
  }, [subtaskId, subtasks])

  const workflowType = (parentTask?.metadata as any)?.workflow_config?.type
  const isSequential = workflowType === "sequential"

  const nextIncompleteSubtaskId = useMemo(() => {
    const next = (subtasks || []).find((s: any) => s.status !== "completed")
    return next ? String(next.id) : undefined
  }, [subtasks])

  const parentStatus = String(parentTask?.status || "")
  const parentStatusAllowsCompletion =
    parentStatus === "accepted" || parentStatus === "in_progress"

  const isCompleted = String(subtask?.status || "") === "completed"

  const isSequentiallyAllowed =
    !isSequential ||
    (nextIncompleteSubtaskId && String(subtaskId) === nextIncompleteSubtaskId)

  const canComplete =
    !!taskId &&
    !!subtaskId &&
    !!subtask &&
    !isCompleted &&
    parentStatusAllowsCompletion &&
    isSequentiallyAllowed

  const { mutateAsync: completeSubtask, isPending: isCompleting } =
    useCompletePartnerAssignedTaskSubtask(taskId || "", subtaskId || "")

  const {
    comments,
    isPending: isCommentsPending,
    isError: isCommentsError,
    error: commentsError,
  } = usePartnerAssignedTaskComments(subtaskId || "", {
    enabled: !!subtaskId,
  })

  const { mutateAsync: addComment, isPending: isAddingComment } =
    useAddPartnerAssignedTaskComment(subtaskId || "")

  if (!taskId || !subtaskId) {
    return (
      <RouteDrawer.Body className="flex-1 overflow-auto">
        <Text size="small" className="text-ui-fg-subtle">
          Missing task id or subtask id.
        </Text>
      </RouteDrawer.Body>
    )
  }

  if (isSubtasksError) {
    throw subtasksError
  }

  if (isCommentsError) {
    throw commentsError
  }

  if (!subtask) {
    return (
      <>
        <RouteDrawer.Body className="flex-1 overflow-auto">
          <Text size="small" className="text-ui-fg-subtle">
            Subtask not found.
          </Text>
        </RouteDrawer.Body>
        <RouteDrawer.Footer>
          <div className="flex items-center gap-x-2">
            <RouteDrawer.Close asChild>
              <Button size="small" variant="secondary">
                Close
              </Button>
            </RouteDrawer.Close>
          </div>
        </RouteDrawer.Footer>
      </>
    )
  }

  const handleComplete = async () => {
    if (!canComplete) {
      return
    }

    await completeSubtask(undefined, {
      onSuccess: (data) => {
        toast.success(data.message || "Subtask completed")
        handleSuccess()
      },
      onError: (e) => {
        toast.error(e.message)
      },
    })
  }

  const handleAddComment = async () => {
    const value = comment.trim()

    if (!value) {
      return
    }

    await addComment(
      { comment: value },
      {
        onSuccess: () => {
          setComment("")
          toast.success("Comment added")
        },
        onError: (e) => {
          toast.error(e.message)
        },
      }
    )
  }

  return (
    <>
      <RouteDrawer.Body className="flex-1 overflow-auto">
        <div className="flex flex-col gap-y-3">
          <div>
            <Heading level="h2">{String(subtask?.title || "Subtask")}</Heading>
            <div className="mt-2 flex items-center gap-2">
              <Text size="small" className="text-ui-fg-subtle">
                Status
              </Text>
              {subtask?.status ? (
                <Badge
                  size="2xsmall"
                  color={getStatusBadgeColor(String(subtask.status))}
                >
                  {String(subtask.status)}
                </Badge>
              ) : (
                <Text size="small" className="text-ui-fg-subtle">
                  -
                </Text>
              )}
            </div>
            {isSequential && (
              <Text size="small" className="text-ui-fg-subtle">
                Workflow: sequential
              </Text>
            )}
          </div>

          <div className="rounded-lg border">
            <SectionRow title="Subtask ID" value={String(subtask?.id || "-")} />
            <SectionRow title="Parent Task ID" value={String(taskId)} />
            <SectionRow
              title="Order"
              value={String((subtask?.metadata as any)?.order ?? "-")}
            />
            <SectionRow
              title="Parent Status"
              value={String(parentTask?.status || "-")}
            />
          </div>

          <div className="rounded-lg border p-4">
            <Heading level="h2">Description</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              {String(subtask?.description || "-")}
            </Text>
          </div>

          {isSequential && !isSequentiallyAllowed && (
            <Text size="small" className="text-ui-fg-subtle">
              Complete previous steps before completing this one.
            </Text>
          )}

          {!parentStatusAllowsCompletion && (
            <Text size="small" className="text-ui-fg-subtle">
              Parent task must be accepted before completing subtasks.
            </Text>
          )}

          <div className="rounded-lg border p-4">
            <Heading level="h2">Comments</Heading>

            {isCommentsPending ? (
              <Text size="small" className="text-ui-fg-subtle">
                Loading comments...
              </Text>
            ) : comments?.length ? (
              <div className="mt-3 flex flex-col gap-y-3">
                {comments.map((c) => (
                  <div
                    key={String(c.id)}
                    className="rounded-md bg-ui-bg-subtle p-3"
                  >
                    <div className="flex items-center justify-between gap-x-4">
                      <Text size="small" weight="plus">
                        {String(c.author_name || c.author_type || "")}
                      </Text>
                      <Text size="xsmall" className="text-ui-fg-subtle">
                        {String(c.created_at || "")}
                      </Text>
                    </div>
                    <Text size="small" className="text-ui-fg-subtle">
                      {String(c.comment || "")}
                    </Text>
                  </div>
                ))}
              </div>
            ) : (
              <Text size="small" className="text-ui-fg-subtle">
                No comments
              </Text>
            )}

            <div className="mt-4 flex flex-col gap-y-2">
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                className="txt-small text-ui-fg-base placeholder:text-ui-fg-muted resize-none overflow-hidden bg-transparent outline-none border rounded-md px-3 py-2"
                placeholder="Add a comment"
                rows={2}
              />
              <div className="flex justify-end">
                <Button
                  size="small"
                  onClick={handleAddComment}
                  isLoading={isAddingComment}
                  disabled={!comment.trim()}
                >
                  Add comment
                </Button>
              </div>
            </div>
          </div>
        </div>
      </RouteDrawer.Body>

      <RouteDrawer.Footer>
        <div className="flex items-center gap-x-2">
          <RouteDrawer.Close asChild>
            <Button size="small" variant="secondary">
              Close
            </Button>
          </RouteDrawer.Close>
          <Button
            size="small"
            onClick={handleComplete}
            isLoading={isCompleting}
            disabled={!canComplete}
          >
            Complete subtask
          </Button>
        </div>
      </RouteDrawer.Footer>
    </>
  )
}

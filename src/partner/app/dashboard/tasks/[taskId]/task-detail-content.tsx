"use client"

import { Badge, Button, Heading, Text, Textarea, toast } from "@medusajs/ui"
import { useState, useTransition, useEffect } from "react"
import { acceptTask, finishTask, addTaskComment, type TaskComment, getTaskSubtasks, completeSubtask, type Subtask } from "../../actions"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import { CheckCircle, Clock, MessageSquare } from "lucide-react"
import { TaskStep } from "../tasks-table"

type PartnerTask = {
  id: string
  title: string
  description?: string
  priority: string
  status: string
  end_date?: string | Date
  start_date?: string | Date
  created_at: string | Date
  updated_at: string | Date
  metadata?: {
    workflow_config?: {
      type: string
      description?: string
      steps?: TaskStep[]
    }
  }
}

type TaskDetailContentProps = {
  task: PartnerTask
  initialComments: TaskComment[]
}

export default function TaskDetailContent({ task, initialComments }: TaskDetailContentProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [comments, setComments] = useState<TaskComment[]>(initialComments)
  const [newComment, setNewComment] = useState("")
  const [isAddingComment, setIsAddingComment] = useState(false)
  const [subtasks, setSubtasks] = useState<Subtask[]>([])
  const [isLoadingSubtasks, setIsLoadingSubtasks] = useState(true)

  const canAccept = task.status === "pending"
  const canFinish = task.status === "accepted" || task.status === "in_progress"
  const isCompleted = task.status === "completed"

  // Fetch subtasks on mount
  useEffect(() => {
    async function fetchSubtasks() {
      try {
        const result = await getTaskSubtasks(task.id)
        setSubtasks(result.subtasks || [])
      } catch (error) {
        console.error("Failed to fetch subtasks:", error)
      } finally {
        setIsLoadingSubtasks(false)
      }
    }
    fetchSubtasks()
  }, [task.id])

  const handleAccept = () => {
    startTransition(async () => {
      const result = await acceptTask(task.id)
      
      if (result.error) {
        toast.error(result.error)
        return
      }
      
      toast.success("Task accepted successfully")
      router.refresh()
    })
  }

  const handleFinish = () => {
    startTransition(async () => {
      const result = await finishTask(task.id)
      
      if (result.error) {
        toast.error(result.error)
        return
      }
      
      toast.success("Task completed successfully")
      router.refresh()
    })
  }

  const handleAddComment = async () => {
    if (!newComment.trim()) return

    setIsAddingComment(true)
    try {
      const result = await addTaskComment(task.id, newComment.trim())
      if (result.comment) {
        setComments([...comments, result.comment])
        setNewComment("")
      }
    } catch (error) {
      console.error("Failed to add comment:", error)
    } finally {
      setIsAddingComment(false)
    }
  }

  const handleCompleteSubtask = async (subtaskId: string) => {
    startTransition(async () => {
      const result = await completeSubtask(task.id, subtaskId)
      
      if (result.error) {
        toast.error(result.error)
        return
      }
      
      // Refresh subtasks
      const updatedSubtasks = await getTaskSubtasks(task.id)
      setSubtasks(updatedSubtasks.subtasks || [])
      
      toast.success("Subtask completed successfully")
      
      // If parent was completed, refresh the page
      if (result.data?.parent_completed) {
        toast.success("All subtasks completed! Parent task marked as complete.")
        router.refresh()
      }
    })
  }

  return (
    <div className="flex flex-col h-full">
      {/* Main Content Area */}
      <div className="flex-1 space-y-6 pb-24">
        {/* Subtasks Section */}
        {isLoadingSubtasks ? (
          <div className="rounded-lg border border-ui-border-base p-6">
            <Text className="text-ui-fg-muted">Loading subtasks...</Text>
          </div>
        ) : subtasks.length > 0 ? (
          <div className="rounded-lg border border-ui-border-base p-6">
            <Heading level="h3" className="mb-4 flex items-center gap-2">
              <Clock className="w-5 h-5" />
              Task Steps ({subtasks.filter(st => st.status === "completed").length}/{subtasks.length} completed)
            </Heading>
            <div className="space-y-3">
              {subtasks.map((subtask) => (
                <div
                  key={subtask.id}
                  className="flex items-start gap-3 p-4 rounded-md bg-ui-bg-subtle border border-ui-border-base"
                >
                  <div className="flex-shrink-0 mt-1">
                    {subtask.status === "completed" ? (
                      <CheckCircle className="w-5 h-5 text-green-600" />
                    ) : (
                      <div className="w-5 h-5 rounded-full border-2 border-ui-border-base" />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Text weight="plus">{subtask.title}</Text>
                      <Badge
                        size="xsmall"
                        color={subtask.status === "completed" ? "green" : subtask.status === "in_progress" ? "orange" : "grey"}
                      >
                        {subtask.status.replace("_", " ")}
                      </Badge>
                      <Badge size="xsmall" color={subtask.priority === "high" ? "red" : subtask.priority === "medium" ? "orange" : "green"}>
                        {subtask.priority}
                      </Badge>
                    </div>
                    {subtask.description && (
                      <Text size="small" className="text-ui-fg-subtle mb-2">
                        {subtask.description}
                      </Text>
                    )}
                    {subtask.status !== "completed" && !isCompleted && (
                      <Button
                        size="small"
                        variant="secondary"
                        onClick={() => handleCompleteSubtask(subtask.id)}
                        disabled={isPending}
                        className="mt-2"
                      >
                        Mark as Complete
                      </Button>
                    )}
                    {subtask.completed_at && (
                      <Text size="xsmall" className="text-ui-fg-muted mt-2">
                        Completed {format(new Date(subtask.completed_at), "MMM dd, yyyy 'at' h:mm a")}
                      </Text>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* Comments Section */}
        <div className="rounded-lg border border-ui-border-base p-6">
          <Heading level="h3" className="mb-4 flex items-center gap-2">
            <MessageSquare className="w-5 h-5" />
            Comments ({comments.length})
          </Heading>

          {/* Add Comment */}
          {!isCompleted && (
            <div className="mb-6">
              <Textarea
                placeholder="Add a comment..."
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                rows={3}
                className="mb-2"
              />
              <div className="flex justify-end">
                <Button
                  size="small"
                  onClick={handleAddComment}
                  disabled={!newComment.trim() || isAddingComment}
                  isLoading={isAddingComment}
                >
                  Add Comment
                </Button>
              </div>
            </div>
          )}

          {/* Comments List */}
          <div className="space-y-4">
            {comments.length === 0 ? (
              <Text className="text-ui-fg-muted text-center py-8">
                No comments yet
              </Text>
            ) : (
              comments.map((comment) => (
                <div
                  key={comment.id}
                  className="p-4 rounded-md bg-ui-bg-subtle border border-ui-border-base"
                >
                  <div className="flex items-center justify-between mb-2">
                    <Text size="small" weight="plus">
                      {comment.author_name || "Partner"}
                    </Text>
                    <Text size="xsmall" className="text-ui-fg-muted">
                      {format(new Date(comment.created_at), "MMM dd, yyyy 'at' h:mm a")}
                    </Text>
                  </div>
                  <Text size="small">{comment.comment}</Text>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Fixed Action Footer */}
      {!isCompleted && (
        <div 
          className="fixed bottom-0 right-0 bg-ui-bg-base border-t border-ui-border-base shadow-lg z-50"
          style={{ left: "var(--sidebar-width, 0px)" }}
        >
          <div className="max-w-4xl mx-auto px-6 py-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1">
                <Text size="small" className="text-ui-fg-subtle">
                  {canAccept && "Accept this task to start working on it"}
                  {canFinish && "Mark this task as complete when finished"}
                </Text>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  onClick={() => router.push("/dashboard/tasks")}
                >
                  Back to Tasks
                </Button>
                {canAccept && (
                  <Button
                    onClick={handleAccept}
                    disabled={isPending}
                    isLoading={isPending}
                  >
                    Accept Task
                  </Button>
                )}
                {canFinish && (
                  <Button
                    onClick={handleFinish}
                    disabled={isPending}
                    isLoading={isPending}
                  >
                    Mark as Complete
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

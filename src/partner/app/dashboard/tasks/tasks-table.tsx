"use client"

import { Badge, Button, Drawer, Heading, Table, Text, Textarea } from "@medusajs/ui"
import { format } from "date-fns"
import { useState, useEffect } from "react"
import { acceptTask, finishTask, getTaskComments, addTaskComment, type TaskComment } from "../actions"
import { useRouter } from "next/navigation"

export type TaskStep = {
  title: string
  description: string
  priority: string
  status: string
  order: number
}

export type PartnerTaskRow = {
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

type TasksTableProps = {
  data: PartnerTaskRow[]
}

const priorityColors = {
  low: "green",
  medium: "orange",
  high: "red",
} as const

const statusColors = {
  pending: "grey",
  accepted: "blue",
  in_progress: "orange",
  completed: "green",
  blocked: "red",
} as const

const TaskDetailDrawer = ({ task, onClose }: { task: PartnerTaskRow; onClose: () => void }) => {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [comments, setComments] = useState<TaskComment[]>([])
  const [newComment, setNewComment] = useState("")
  const [isLoadingComments, setIsLoadingComments] = useState(true)
  const [isAddingComment, setIsAddingComment] = useState(false)

  const canAccept = task.status === "pending"
  const canFinish = task.status === "accepted" || task.status === "in_progress"
  const isCompleted = task.status === "completed"

  const steps = task.metadata?.workflow_config?.steps || []
  const workflowType = task.metadata?.workflow_config?.type
  const workflowDescription = task.metadata?.workflow_config?.description

  // Load comments when drawer opens
  useEffect(() => {
    const loadComments = async () => {
      setIsLoadingComments(true)
      try {
        const { comments: fetchedComments } = await getTaskComments(task.id)
        setComments(fetchedComments)
      } catch (error) {
        console.error("Failed to load comments:", error)
      } finally {
        setIsLoadingComments(false)
      }
    }
    loadComments()
  }, [task.id])

  const handleAccept = async () => {
    setIsLoading(true)
    try {
      await acceptTask(task.id)
      router.refresh()
      onClose()
    } catch (error) {
      console.error("Failed to accept task:", error)
      alert("Failed to accept task")
    } finally {
      setIsLoading(false)
    }
  }

  const handleFinish = async () => {
    setIsLoading(true)
    try {
      await finishTask(task.id)
      router.refresh()
      onClose()
    } catch (error) {
      console.error("Failed to finish task:", error)
      alert("Failed to finish task")
    } finally {
      setIsLoading(false)
    }
  }

  const handleAddComment = async () => {
    if (!newComment.trim()) return

    setIsAddingComment(true)
    try {
      const result = await addTaskComment(task.id, newComment.trim())
      // Add the new comment to the list
      setComments([result.comment, ...comments])
      setNewComment("")
    } catch (error) {
      console.error("Failed to add comment:", error)
      alert("Failed to add comment")
    } finally {
      setIsAddingComment(false)
    }
  }

  return (
    <>
      <Drawer.Header>
        <Drawer.Title>{task.title}</Drawer.Title>
      </Drawer.Header>
      <Drawer.Body className="p-4 sm:p-6 overflow-y-auto">
        <div className="flex flex-col gap-6 pb-4">
          {/* Task Details */}
          <div className="flex flex-col gap-4">
            <div>
              <Text size="small" weight="plus" className="text-ui-fg-subtle mb-1">
                Description
              </Text>
              <Text className="text-sm sm:text-base">{task.description || "No description provided"}</Text>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Text size="small" weight="plus" className="text-ui-fg-subtle mb-1">
                  Priority
                </Text>
                <Badge
                  size="small"
                  color={priorityColors[task.priority as keyof typeof priorityColors] || "grey"}
                >
                  {task.priority}
                </Badge>
              </div>
              <div>
                <Text size="small" weight="plus" className="text-ui-fg-subtle mb-1">
                  Status
                </Text>
                <Badge
                  size="small"
                  color={statusColors[task.status as keyof typeof statusColors] || "grey"}
                >
                  {task.status.replace("_", " ")}
                </Badge>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {task.start_date && (
                <div>
                  <Text size="small" weight="plus" className="text-ui-fg-subtle mb-1">
                    Start Date
                  </Text>
                  <Text className="text-sm">{format(new Date(task.start_date), "MMM dd, yyyy")}</Text>
                </div>
              )}
              {task.end_date && (
                <div>
                  <Text size="small" weight="plus" className="text-ui-fg-subtle mb-1">
                    Due Date
                  </Text>
                  <Text className="text-sm">{format(new Date(task.end_date), "MMM dd, yyyy")}</Text>
                </div>
              )}
            </div>
          </div>

          {/* Workflow Information */}
          {workflowType && (
            <div className="border-t pt-4">
              <Heading level="h3" className="mb-3">
                Workflow Configuration
              </Heading>
              <div className="flex flex-col gap-3">
                <div>
                  <Text size="small" weight="plus" className="text-ui-fg-subtle mb-1">
                    Type
                  </Text>
                  <Badge size="small">{workflowType}</Badge>
                </div>
                {workflowDescription && (
                  <div>
                    <Text size="small" weight="plus" className="text-ui-fg-subtle mb-1">
                      Description
                    </Text>
                    <Text size="small">{workflowDescription}</Text>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Steps */}
          {steps.length > 0 && (
            <div className="border-t pt-4">
              <Heading level="h3" className="mb-3 text-base sm:text-lg">
                Task Steps ({steps.length})
              </Heading>
              <div className="flex flex-col gap-3">
                {steps
                  .sort((a, b) => a.order - b.order)
                  .map((step, index) => (
                    <div
                      key={index}
                      className="border rounded-lg p-3 sm:p-4 bg-ui-bg-subtle"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2">
                          <Badge size="2xsmall" className="bg-ui-bg-base">
                            {step.order}
                          </Badge>
                          <Text weight="plus" className="text-sm sm:text-base">{step.title}</Text>
                        </div>
                        <div className="flex gap-2 flex-wrap">
                          <Badge
                            size="2xsmall"
                            color={priorityColors[step.priority as keyof typeof priorityColors] || "grey"}
                          >
                            {step.priority}
                          </Badge>
                          <Badge
                            size="2xsmall"
                            color={statusColors[step.status as keyof typeof statusColors] || "grey"}
                          >
                            {step.status}
                          </Badge>
                        </div>
                      </div>
                      {step.description && (
                        <Text size="small" className="text-ui-fg-subtle">
                          {step.description}
                        </Text>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Comments Section */}
          <div className="border-t pt-4">
            <Heading level="h3" className="mb-3 text-base sm:text-lg">
              Comments ({comments.length})
            </Heading>
            
            {/* Add Comment */}
            <div className="mb-4">
              <Textarea
                placeholder="Add a comment..."
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                rows={3}
                className="mb-2"
              />
              <Button
                size="small"
                onClick={handleAddComment}
                disabled={isAddingComment || !newComment.trim()}
              >
                {isAddingComment ? "Adding..." : "Add Comment"}
              </Button>
            </div>

            {/* Comments List */}
            <div className="flex flex-col gap-3">
              {isLoadingComments ? (
                <Text size="small" className="text-ui-fg-subtle">Loading comments...</Text>
              ) : comments.length === 0 ? (
                <Text size="small" className="text-ui-fg-subtle">No comments yet. Be the first to comment!</Text>
              ) : (
                comments.map((comment) => (
                  <div
                    key={comment.id}
                    className="border rounded-lg p-3 sm:p-4 bg-ui-bg-subtle"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex flex-col">
                        <Text weight="plus" size="small">{comment.author_name}</Text>
                        <Text size="xsmall" className="text-ui-fg-subtle">
                          {format(new Date(comment.created_at), "MMM dd, yyyy 'at' h:mm a")}
                        </Text>
                      </div>
                      <Badge size="2xsmall" color={comment.author_type === "partner" ? "blue" : "purple"}>
                        {comment.author_type}
                      </Badge>
                    </div>
                    <Text size="small" className="whitespace-pre-wrap">
                      {comment.comment}
                    </Text>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </Drawer.Body>
      <Drawer.Footer className="flex flex-col sm:flex-row gap-2">
        <Drawer.Close asChild>
          <Button variant="secondary" className="w-full sm:w-auto">Close</Button>
        </Drawer.Close>
        {canAccept && (
          <Button onClick={handleAccept} disabled={isLoading} className="w-full sm:w-auto">
            {isLoading ? "Accepting..." : "Accept Task"}
          </Button>
        )}
        {canFinish && (
          <Button onClick={handleFinish} disabled={isLoading} className="w-full sm:w-auto">
            {isLoading ? "Finishing..." : "Finish Task"}
          </Button>
        )}
        {isCompleted && (
          <Badge size="small" color="green" className="self-center sm:self-auto">
            ✓ Completed
          </Badge>
        )}
      </Drawer.Footer>
    </>
  )
}

export default function TasksTable({ data }: TasksTableProps) {
  const [selectedTask, setSelectedTask] = useState<PartnerTaskRow | null>(null)

  return (
    <>
      {/* Mobile Card View */}
      <div className="flex flex-col gap-3 md:hidden">
        {data.map((task) => (
          <div
            key={task.id}
            className="border border-ui-border-base rounded-lg p-4 bg-ui-bg-base cursor-pointer hover:bg-ui-bg-base-hover transition-colors"
            onClick={() => setSelectedTask(task)}
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex-1">
                <Text weight="plus" className="mb-1">{task.title}</Text>
                {task.description && (
                  <Text size="small" className="text-ui-fg-subtle line-clamp-2">
                    {task.description}
                  </Text>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mb-3">
              <Badge
                size="small"
                color={priorityColors[task.priority as keyof typeof priorityColors] || "grey"}
              >
                {task.priority}
              </Badge>
              <Badge
                size="small"
                color={statusColors[task.status as keyof typeof statusColors] || "grey"}
              >
                {task.status.replace("_", " ")}
              </Badge>
            </div>
            <div className="flex items-center justify-between text-sm text-ui-fg-subtle">
              <span>
                {task.end_date
                  ? `Due: ${format(new Date(task.end_date), "MMM dd")}`
                  : "No due date"}
              </span>
              <span>{format(new Date(task.created_at), "MMM dd, yyyy")}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop Table View */}
      <div className="hidden md:block overflow-hidden rounded-lg border border-ui-border-base">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Title</Table.HeaderCell>
              <Table.HeaderCell>Priority</Table.HeaderCell>
              <Table.HeaderCell>Status</Table.HeaderCell>
              <Table.HeaderCell>Due Date</Table.HeaderCell>
              <Table.HeaderCell>Created</Table.HeaderCell>
              <Table.HeaderCell className="text-right">Actions</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {data.map((task) => (
                <Table.Row key={task.id}>
                  <Table.Cell>
                    <div className="flex flex-col">
                      <span className="font-medium">{task.title}</span>
                      {task.description && (
                        <span className="text-sm text-ui-fg-subtle line-clamp-1">
                          {task.description}
                        </span>
                      )}
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <Badge
                      size="small"
                      color={priorityColors[task.priority as keyof typeof priorityColors] || "grey"}
                    >
                      {task.priority}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell>
                    <Badge
                      size="small"
                      color={statusColors[task.status as keyof typeof statusColors] || "grey"}
                    >
                      {task.status.replace("_", " ")}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell>
                    {task.end_date
                      ? format(new Date(task.end_date), "MMM dd, yyyy")
                      : "-"}
                  </Table.Cell>
                  <Table.Cell>
                    {format(new Date(task.created_at), "MMM dd, yyyy")}
                  </Table.Cell>
                  <Table.Cell className="text-right">
                    <Button
                      size="small"
                      variant="secondary"
                      onClick={() => setSelectedTask(task)}
                    >
                      View Details
                    </Button>
                  </Table.Cell>
                </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </div>

      {/* Task Detail Drawer */}
      <Drawer open={!!selectedTask} onOpenChange={(open) => !open && setSelectedTask(null)}>
        <Drawer.Content>
          {selectedTask && (
            <TaskDetailDrawer
              task={selectedTask}
              onClose={() => setSelectedTask(null)}
            />
          )}
        </Drawer.Content>
      </Drawer>
    </>
  )
}

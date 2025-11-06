import { Container, Heading, Badge, Text } from "@medusajs/ui"
import { getPartnerTasks, getTaskComments } from "../../actions"
import { notFound } from "next/navigation"

import { format } from "date-fns"
import TaskDetailContent from "./task-detail-content"

export const dynamic = "force-dynamic"

type TaskDetailPageProps = {
  params: Promise<{ taskId: string }>
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
  cancelled: "red",
} as const

export default async function TaskDetailPage({ params }: TaskDetailPageProps) {
  const { taskId } = await params
  
  // Fetch all tasks and find the specific one
  const res = await getPartnerTasks()
  const tasks = res?.tasks || []
  const task = tasks.find((t) => t.id === taskId)

  if (!task) {
    notFound()
  }

  // Fetch comments for this task
  const commentsRes = await getTaskComments(taskId)
  const initialComments = commentsRes?.comments || []

  return (
    <Container className="w-full max-w-4xl">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            <Heading level="h1" className="mb-2">{task.title}</Heading>
            {task.description && (
              <Text className="text-ui-fg-subtle">{task.description}</Text>
            )}
          </div>
          <div className="flex gap-2 ml-4">
            <Badge color={priorityColors[task.priority as keyof typeof priorityColors]}>
              {task.priority}
            </Badge>
            <Badge color={statusColors[task.status as keyof typeof statusColors]}>
              {task.status}
            </Badge>
          </div>
        </div>

        {/* Task Metadata */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-ui-bg-subtle rounded-lg">
          {task.start_date && (
            <div>
              <Text size="xsmall" className="text-ui-fg-muted mb-1">Start Date</Text>
              <Text size="small" weight="plus">
                {format(new Date(task.start_date), "MMM dd, yyyy")}
              </Text>
            </div>
          )}
          {task.end_date && (
            <div>
              <Text size="xsmall" className="text-ui-fg-muted mb-1">Due Date</Text>
              <Text size="small" weight="plus">
                {format(new Date(task.end_date), "MMM dd, yyyy")}
              </Text>
            </div>
          )}
          <div>
            <Text size="xsmall" className="text-ui-fg-muted mb-1">Created</Text>
            <Text size="small" weight="plus">
              {format(new Date(task.created_at), "MMM dd, yyyy")}
            </Text>
          </div>
          <div>
            <Text size="xsmall" className="text-ui-fg-muted mb-1">Updated</Text>
            <Text size="small" weight="plus">
              {format(new Date(task.updated_at), "MMM dd, yyyy")}
            </Text>
          </div>
        </div>
      </div>

      {/* Task Content - Client Component */}
      <TaskDetailContent task={task} initialComments={initialComments} />
    </Container>
  )
}

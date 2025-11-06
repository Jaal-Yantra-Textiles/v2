"use client"

import { Badge, Table, Text } from "@medusajs/ui"
import { format } from "date-fns"
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
  cancelled: "red",
} as const

export default function TasksTable({ data }: TasksTableProps) {
  const router = useRouter()

  const handleTaskClick = (taskId: string) => {
    router.push(`/dashboard/tasks/${taskId}`)
  }

  return (
    <>
      {/* Mobile Card View */}
      <div className="flex flex-col gap-3 md:hidden">
        {data.map((task) => (
          <div
            key={task.id}
            className="border border-ui-border-base rounded-lg p-4 bg-ui-bg-base cursor-pointer hover:bg-ui-bg-base-hover transition-colors"
            onClick={() => handleTaskClick(task.id)}
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
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {data.map((task) => (
              <Table.Row
                key={task.id}
                className="cursor-pointer hover:bg-ui-bg-base-hover transition-colors"
                onClick={() => handleTaskClick(task.id)}
              >
                <Table.Cell>
                  <div>
                    <Text weight="plus">{task.title}</Text>
                    {task.description && (
                      <Text size="small" className="text-ui-fg-subtle line-clamp-1">
                        {task.description}
                      </Text>
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
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </div>
    </>
  )
}

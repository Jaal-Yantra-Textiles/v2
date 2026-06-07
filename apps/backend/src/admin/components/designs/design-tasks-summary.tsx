import { Badge, Button, Container, Heading, Text } from "@medusajs/ui"
import { TriangleRightMini } from "@medusajs/icons"
import { Link } from "react-router-dom"

import { AdminDesign } from "../../hooks/api/designs"

interface Props {
  design: AdminDesign
}

const PREVIEW_COUNT = 3

const taskStatusColor = (status: string): "green" | "orange" | "red" | "grey" => {
  switch (status) {
    case "completed":
      return "green"
    case "in_progress":
      return "orange"
    case "cancelled":
      return "red"
    default:
      return "grey"
  }
}

/**
 * Compact tasks card for the design detail page (roadmap #8). Shows the
 * count + a few tasks and links to the dedicated sub-page
 * (/designs/:id/tasks) for the full task list + management.
 */
export const DesignTasksSummary = ({ design }: Props) => {
  const tasks = ((design as any)?.tasks || []) as any[]
  const preview = tasks.slice(0, PREVIEW_COUNT)
  const doneCount = tasks.filter((t: any) => String(t.status) === "completed").length

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-2">
          <Heading level="h2">Tasks</Heading>
          {tasks.length > 0 && (
            <Badge size="2xsmall" color="grey" rounded="full">
              {doneCount}/{tasks.length}
            </Badge>
          )}
        </div>
        {tasks.length > 0 && (
          <Button asChild variant="transparent" size="small">
            <Link to="tasks">View all</Link>
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-2 px-3 py-3">
        {tasks.length === 0 ? (
          <div className="flex items-center justify-center py-4">
            <Text size="small" className="text-ui-fg-subtle">
              No tasks for this design yet
            </Text>
          </div>
        ) : (
          <>
            {preview.map((task: any) => (
              <Link
                key={task.id}
                to="tasks"
                className="outline-none focus-within:shadow-borders-interactive-with-focus rounded-md [&:hover>div]:bg-ui-bg-component-hover"
              >
                <div className="shadow-elevation-card-rest bg-ui-bg-component flex items-center justify-between gap-3 rounded-md px-4 py-2.5 transition-colors">
                  <Text size="small" leading="compact" weight="plus" className="truncate">
                    {task.title || task.id}
                  </Text>
                  <div className="flex shrink-0 items-center gap-x-2">
                    <Badge size="2xsmall" color={taskStatusColor(String(task.status))}>
                      {String(task.status || "pending").replace(/_/g, " ")}
                    </Badge>
                    <TriangleRightMini className="text-ui-fg-muted" />
                  </div>
                </div>
              </Link>
            ))}
            {tasks.length > PREVIEW_COUNT && (
              <Link
                to="tasks"
                className="text-ui-fg-interactive hover:text-ui-fg-interactive-hover px-1 py-1"
              >
                <Text size="small" leading="compact">
                  View all {tasks.length} tasks →
                </Text>
              </Link>
            )}
          </>
        )}
      </div>
    </Container>
  )
}

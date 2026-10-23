import { Badge, Container, Heading, Text, toast } from "@medusajs/ui"
import { Plus, PlaySolid, SquaresPlus } from "@medusajs/icons"
import { usePartnerTasks } from "../../hooks/api/partner-tasks"
import { ActionMenu } from "../common/action-menu"
import { Link } from "react-router-dom"

type PartnerTasksSectionProps = {
  partnerId: string
}

export const PartnerTasksSection = ({ partnerId }: PartnerTasksSectionProps) => {
  const { tasks, count, isPending } = usePartnerTasks(partnerId)
  
  const taskCount = isPending ? 0 : (count || tasks?.length || 0)

  const handleRunPendingAssignments = async () => {
    try {
      // TODO: Implement API call to run pending assignments
      toast.info("Running pending task assignments...")
      // This would call an API endpoint that finds all pending tasks and runs their assignment workflows
    } catch (error) {
      toast.error("Failed to run pending assignments")
    }
  }

  return (
    <Container className="divide-y p-0 w-full">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-2">
          <Heading level="h2">Tasks</Heading>
          <Badge size="2xsmall" className="ml-2">{taskCount}</Badge>
        </div>
        <div className="flex items-center gap-x-4">
          <ActionMenu
            groups={[
              {
                actions: [
                  {
                    label: "View Canvas",
                    icon: <SquaresPlus />,
                    to: `tasks/view-canvas`,
                  },
                  {
                    label: "Create Task",
                    icon: <Plus />,
                    to: `tasks/new`,
                  },
                ],
              },
              {
                actions: [
                  {
                    label: "Run Pending Assignments",
                    icon: <PlaySolid />,
                    onClick: handleRunPendingAssignments,
                  },
                ],
              },
            ]}
          />
        </div>
      </div>
      <div className="px-6 py-4">
        {isPending ? (
          <Text size="small" className="text-ui-fg-subtle">Loading tasks...</Text>
        ) : taskCount === 0 ? (
          <Text size="small" className="text-ui-fg-subtle">No tasks assigned yet.</Text>
        ) : (
          <div className="flex flex-col gap-y-2">
            {(tasks ?? [])
              .filter((t: any) => !t.parent_task_id)
              .map((t: any) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between gap-x-3 rounded-md border px-3 py-2"
                >
                  <div className="min-w-0">
                    <Text size="small" weight="plus" className="truncate">
                      {t.title}
                    </Text>
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      {t.production_run ? (
                        <Link
                          to={`/production-runs/${t.production_run.id}`}
                          className="hover:underline"
                        >
                          For run: {t.production_run.design_name || t.production_run.id}
                          {t.production_run.quantity != null
                            ? ` · ${t.production_run.quantity} pcs`
                            : ""}
                        </Link>
                      ) : (
                        "Not for a production run"
                      )}
                    </Text>
                  </div>
                  <Badge size="2xsmall">{String(t.status).replace(/_/g, " ")}</Badge>
                </div>
              ))}
          </div>
        )}
      </div>
    </Container>
  )
}

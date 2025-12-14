import { Button, Container, Heading } from "@medusajs/ui"
import { Link } from "react-router-dom"

import { PartnerAssignedTask } from "../../../../hooks/api/partner-assigned-tasks"

type TaskActionsSectionProps = {
  task: PartnerAssignedTask
  isPending?: boolean
}

export const TaskActionsSection = ({
  task,
  isPending = false,
}: TaskActionsSectionProps) => {
  const status = String(task?.status || "")

  const canAccept = status === "pending" || status === "assigned" || status === "incoming"
  const canFinish = status === "accepted" || status === "in_progress" || status === "finished"

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Actions</Heading>
      </div>
      <div className="flex flex-col gap-y-2 px-6 py-4">
        {canAccept && (
          <Button size="small" variant="secondary" disabled={isPending} asChild>
            <Link to="accept">Accept</Link>
          </Button>
        )}
        {canFinish && (
          <Button size="small" variant="primary" disabled={isPending} asChild>
            <Link to="finish">Finish</Link>
          </Button>
        )}
      </div>
    </Container>
  )
}

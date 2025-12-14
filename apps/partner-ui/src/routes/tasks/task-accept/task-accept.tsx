import { Button, Heading, Text, toast } from "@medusajs/ui"
import { useParams } from "react-router-dom"

import { RouteDrawer, useRouteModal } from "../../../components/modals"
import { useAcceptPartnerAssignedTask } from "../../../hooks/api/partner-assigned-tasks"

export const TaskAccept = () => {
  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <RouteDrawer.Title asChild>
          <Heading>Accept Task</Heading>
        </RouteDrawer.Title>
        <RouteDrawer.Description className="sr-only">
          Accept the task
        </RouteDrawer.Description>
      </RouteDrawer.Header>
      <TaskAcceptContent />
    </RouteDrawer>
  )
}

const TaskAcceptContent = () => {
  const { id } = useParams()
  const { handleSuccess } = useRouteModal()

  const { mutateAsync, isPending } = useAcceptPartnerAssignedTask(id || "")

  const handleAccept = async () => {
    if (!id) {
      return
    }

    await mutateAsync(undefined, {
      onSuccess: () => {
        toast.success("Task accepted")
        handleSuccess()
      },
      onError: (e) => {
        toast.error(e.message)
      },
    })
  }

  return (
    <>
      <RouteDrawer.Body>
        <Text size="small" className="text-ui-fg-subtle">
          This will mark the task as accepted.
        </Text>
        {!id && (
          <Text size="small" className="text-ui-fg-subtle">
            Missing task id.
          </Text>
        )}
      </RouteDrawer.Body>
      <RouteDrawer.Footer>
        <div className="flex items-center gap-x-2">
          <RouteDrawer.Close asChild>
            <Button size="small" variant="secondary">
              Cancel
            </Button>
          </RouteDrawer.Close>
          <Button
            size="small"
            isLoading={isPending}
            onClick={handleAccept}
            disabled={!id}
          >
            Accept
          </Button>
        </div>
      </RouteDrawer.Footer>
    </>
  )
}

import { Button, Heading, Text, toast } from "@medusajs/ui"
import { useParams } from "react-router-dom"

import { RouteDrawer, useRouteModal } from "../../../components/modals"
import { useFinishPartnerAssignedTask } from "../../../hooks/api/partner-assigned-tasks"

export const TaskFinish = () => {
  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <RouteDrawer.Title asChild>
          <Heading>Finish Task</Heading>
        </RouteDrawer.Title>
        <RouteDrawer.Description className="sr-only">
          Finish the task
        </RouteDrawer.Description>
      </RouteDrawer.Header>
      <TaskFinishContent />
    </RouteDrawer>
  )
}

const TaskFinishContent = () => {
  const { id } = useParams()
  const { handleSuccess } = useRouteModal()

  const { mutateAsync, isPending } = useFinishPartnerAssignedTask(id || "")

  const handleFinish = async () => {
    if (!id) {
      return
    }

    await mutateAsync(undefined, {
      onSuccess: () => {
        toast.success("Task finished")
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
          This will mark the task as finished.
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
            onClick={handleFinish}
            disabled={!id}
          >
            Finish
          </Button>
        </div>
      </RouteDrawer.Footer>
    </>
  )
}

import { useState } from "react"
import { Button, Heading, Input, Text, toast } from "@medusajs/ui"
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
  const [actualCost, setActualCost] = useState("")

  const { mutateAsync, isPending } = useFinishPartnerAssignedTask(id || "")

  const handleFinish = async () => {
    if (!id) {
      return
    }

    const cost = parseFloat(actualCost)
    const payload =
      !isNaN(cost) && cost > 0
        ? { actual_cost: cost, cost_currency: "inr" }
        : undefined

    await mutateAsync(payload, {
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
      <RouteDrawer.Body className="flex flex-col gap-y-4">
        <Text size="small" className="text-ui-fg-subtle">
          This will mark the task as finished.
        </Text>
        <div className="flex flex-col gap-y-2">
          <Text size="small" weight="plus">
            Actual cost (optional)
          </Text>
          <div className="flex items-center gap-x-2">
            <Text size="small" className="text-ui-fg-muted">
              INR
            </Text>
            <Input
              type="number"
              size="small"
              placeholder="0"
              value={actualCost}
              onChange={(e) => setActualCost(e.target.value)}
            />
          </div>
          <Text size="xsmall" className="text-ui-fg-subtle">
            Recorded on the task and used when you submit it for payment.
          </Text>
        </div>
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

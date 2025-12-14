import { Button, Heading, Text, toast } from "@medusajs/ui"
import { useParams } from "react-router-dom"

import { RouteDrawer, useRouteModal } from "../../../components/modals"
import { useStartPartnerDesign } from "../../../hooks/api/partner-designs"

export const DesignStart = () => {
  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <RouteDrawer.Title asChild>
          <Heading>Start Design</Heading>
        </RouteDrawer.Title>
        <RouteDrawer.Description className="sr-only">
          Start the design workflow
        </RouteDrawer.Description>
      </RouteDrawer.Header>
      <DesignStartContent />
    </RouteDrawer>
  )
}

const DesignStartContent = () => {
  const { id } = useParams()
  const { handleSuccess } = useRouteModal()

  const { mutateAsync, isPending } = useStartPartnerDesign(id || "")

  const handleStart = async () => {
    if (!id) {
      return
    }

    await mutateAsync(undefined, {
      onSuccess: () => {
        toast.success("Design started")
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
          This will mark the design as started.
        </Text>
        {!id && (
          <Text size="small" className="text-ui-fg-subtle">
            Missing design id.
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
            onClick={handleStart}
            disabled={!id}
          >
            Start
          </Button>
        </div>
      </RouteDrawer.Footer>
    </>
  )
}

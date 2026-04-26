import { useState } from 'react'
import { Alert, Button, Heading, Text, toast } from "@medusajs/ui"
import { RouteDrawer } from '../../modal/route-drawer/route-drawer'
import { useQueryClient } from "@tanstack/react-query"
import {
  useBackfillAllGeocodes,
  useConfirmGeocodeAllAddresses,
} from "../../../hooks/api/geocode"
import { personsQueryKeys } from "../../../hooks/api/persons"
import { backfillAllGeocodesWorkflowId, waitConfirmationBackfillGeocodesStepId } from '../../../lib/constants'
import { useRouteModal } from '../../modal/use-route-modal'

export const BackfillGeocodes = () => {
  return (
    <RouteDrawer>
      <BackfillGeocodesContent />
    </RouteDrawer>
  )
}

const BackfillGeocodesContent = () => {
  const [transactionId, setTransactionId] = useState<string | null>(null)
  const [summary, setSummary] = useState<any | null>(null)
  const [errorMessage, setErrorMessage] = useState<string>('')

  const queryClient = useQueryClient()

  const { mutateAsync: backfillGeocodes, isPending: isBackfilling } = useBackfillAllGeocodes()
  const { mutateAsync: confirmGeocoding, isPending: isConfirming } = useConfirmGeocodeAllAddresses()
  const { handleSuccess } = useRouteModal()

  const handleBackfill = async () => {
    setErrorMessage('')
    try {
      const { summary, transaction_id } = await backfillGeocodes()
      setSummary(summary)
      setTransactionId(transaction_id)
      toast.info("Workflow started", {
        description: "The geocoding process has been initiated.",
      })
    } catch (err: any) {
      setErrorMessage(err.message)
    }
  }

  const handleConfirm = async () => {
    if (!transactionId) return

    await confirmGeocoding({
      transactionId,
      workflowId: backfillAllGeocodesWorkflowId,
      stepId: waitConfirmationBackfillGeocodesStepId,
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: personsQueryKeys.lists() })
        queryClient.invalidateQueries({ queryKey: personsQueryKeys.details() })
        toast.success("Success", {
          description: "Addresses were successfully queued for geocoding",
        })
        handleSuccess()
      },
      onError: (err: any) => {
        toast.error(err.message)
      }
    })
  }

  return (
    <>
      <RouteDrawer.Header>
        <RouteDrawer.Title>Backfill Geocodes</RouteDrawer.Title>
      </RouteDrawer.Header>
      <RouteDrawer.Body>
        <div className="flex flex-col gap-y-4">
          <Heading level="h2">Geocode All Addresses</Heading>
          <Text>
            This will start a background job to geocode all addresses that are missing latitude and longitude.
          </Text>
          <Alert color="orange" className="my-4">
            <div className="flex flex-col">
              <Heading level="h3">Warning</Heading>
              <Text>
                This is a potentially long-running and resource-intensive operation. It should only be run when necessary.
              </Text>
            </div>
          </Alert>
          {summary && (
            <div className="mt-4">
              <Heading level="h3">Summary</Heading>
              <Text className="bg-grey-5 rounded-md p-4 overflow-auto">Backfilling {summary.count} addresses, confirm to start</Text>
            </div>
          )}
          {errorMessage && (
            <Alert color="red" className="my-4">
              <Text>{errorMessage}</Text>
            </Alert>
          )}
        </div>
      </RouteDrawer.Body>
      <RouteDrawer.Footer>
        <div className="flex items-center gap-x-2">
          <RouteDrawer.Close asChild>
            <Button size="small" variant="secondary">
              Cancel
            </Button>
          </RouteDrawer.Close>
          {!transactionId ? (
            <Button size="small" onClick={handleBackfill} isLoading={isBackfilling}>
              Start Backfill
            </Button>
          ) : (
            <Button size="small" onClick={handleConfirm} isLoading={isConfirming}>
              Confirm
            </Button>
          )}
        </div>
      </RouteDrawer.Footer>
    </>
  )
}

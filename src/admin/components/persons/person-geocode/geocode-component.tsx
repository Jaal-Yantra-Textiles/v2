import { useState } from 'react'
import { Alert, Button, Heading, Text, toast } from "@medusajs/ui"
import { useRouteModal } from '../../modal/use-route-modal'
import { useQueryClient } from "@tanstack/react-query"
import {
  useGeocodeAllAddresses,
  useConfirmGeocodeAllAddresses,
} from "../../../hooks/api/geocode"
import { personsQueryKeys } from "../../../hooks/api/persons"
import { RouteDrawer } from '../../modal/route-drawer/route-drawer'
import { geocodeAllAddressesWorkflowId, waitConfirmationGeocodeAddressesStepId } from '../../../lib/constants'


export const PersonGeocodeContent = ({ personId }: { personId: string }) => {
    const [transactionId, setTransactionId] = useState<string | null>(null)
    const [summary, setSummary] = useState<any | null>(null)
    const [errorMessage, setErrorMessage] = useState<string>('')
  
    const queryClient = useQueryClient()

  const { mutateAsync: geocodeAddresses } = useGeocodeAllAddresses(personId, {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: personsQueryKeys.detail(personId) })
    },
  })

  const { mutateAsync: confirmGeocoding } = useConfirmGeocodeAllAddresses({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: personsQueryKeys.detail(personId) })
    },
  })
    const { handleSuccess } = useRouteModal()
  
    const handleGeocode = async () => {
      setErrorMessage('')
      try {
        const { summary, transaction_id } = await geocodeAddresses();
        setSummary(summary)
        setTransactionId(transaction_id)
        toast.info("Workflow started", {
          description: "The geocoding process has been initiated.",
        })
      } catch (err: any) {
        setErrorMessage(err.message || 'An error occurred while starting the geocode process.')
      }
    }
  
    const handleConfirm = async () => {
      if (!transactionId) {
        return
      }
  
      await confirmGeocoding({
        transactionId,
        workflowId: geocodeAllAddressesWorkflowId,
        stepId: waitConfirmationGeocodeAddressesStepId,
      }, {
        onSuccess: () => {
          toast.success("Success", {
            description: "Addresses were successfully queued for geocoding",
          })
          handleSuccess()
        },
        onError: (err: any) => {
          toast.error(err.message)
        },
      })
    }
  
    return (
      <>
        <RouteDrawer.Body>
          <div className="flex flex-col gap-y-4">
            <div>
              <Heading level="h2">Start Geocoding</Heading>
              <Text size="small" className="text-ui-fg-subtle">
                Click the button below to start the geocoding process for all addresses associated with this person.
              </Text>
            </div>
            {!summary && (
              <Button onClick={handleGeocode}  disabled={!!transactionId}>
                Start Geocoding
              </Button>
            )}
            {errorMessage && (
              <Alert variant="error" title="Operation failed">
                <Text>{errorMessage}</Text>
              </Alert>
            )}
            {summary && (
              <div>
                <Heading level="h2">Summary</Heading>
                <Text size="small">{summary.message}</Text>
              </div>
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
            <Button
              onClick={handleConfirm}
              size="small"
              disabled={!transactionId || !!errorMessage}
            >
              Confirm
            </Button>
          </div>
        </RouteDrawer.Footer>
      </>
    )
  }
  
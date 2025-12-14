import { Button, Heading, Text } from "@medusajs/ui"
import { useParams } from "react-router-dom"

import { RouteFocusModal } from "../../../components/modals"

export const DesignMoodboard = () => {
  const { id } = useParams()

  return (
    <RouteFocusModal>
      <RouteFocusModal.Header>
        <RouteFocusModal.Title asChild>
          <Heading>Moodboard</Heading>
        </RouteFocusModal.Title>
        <RouteFocusModal.Description className="sr-only">
          Moodboard
        </RouteFocusModal.Description>
      </RouteFocusModal.Header>

      <RouteFocusModal.Body>
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">
            {id ? "Moodboard is not available in PartnerUI yet." : "Missing design id."}
          </Text>
        </div>
      </RouteFocusModal.Body>

      <RouteFocusModal.Footer>
        <div className="flex items-center justify-end gap-x-2">
          <RouteFocusModal.Close asChild>
            <Button size="small" variant="secondary">
              Close
            </Button>
          </RouteFocusModal.Close>
        </div>
      </RouteFocusModal.Footer>
    </RouteFocusModal>
  )
}

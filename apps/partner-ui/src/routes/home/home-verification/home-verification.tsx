import { Button, Heading, Input, Text } from "@medusajs/ui"

import { RouteFocusModal } from "../../../components/modals"

export const HomeVerification = () => {
  return (
    <RouteFocusModal>
      <div className="flex h-full flex-col overflow-hidden">
        <RouteFocusModal.Header>
          <RouteFocusModal.Title asChild>
            <Heading>Verification</Heading>
          </RouteFocusModal.Title>
          <RouteFocusModal.Description className="sr-only">
            Verification
          </RouteFocusModal.Description>
        </RouteFocusModal.Header>

        <RouteFocusModal.Body className="flex flex-1 flex-col overflow-hidden">
          <div className="flex flex-1 flex-col items-center overflow-y-auto">
            <div className="flex w-full max-w-[720px] flex-col gap-y-8 px-2 py-16">
              <div>
                <Text size="small" className="text-ui-fg-subtle">
                  Upload documents and your artisan card to complete verification.
                </Text>
              </div>

              <div className="grid grid-cols-1 gap-4">
                <div className="flex flex-col gap-2">
                  <Text size="small" weight="plus">
                    Documents
                  </Text>
                  <Input type="file" />
                  <Text size="xsmall" className="text-ui-fg-subtle">
                    Upload any verification documents.
                  </Text>
                </div>

                <div className="flex flex-col gap-2">
                  <Text size="small" weight="plus">
                    Artisan card
                  </Text>
                  <Input type="file" />
                  <Text size="xsmall" className="text-ui-fg-subtle">
                    Upload your artisan card.
                  </Text>
                </div>
              </div>

              <div className="flex items-center justify-end gap-x-2">
                <RouteFocusModal.Close asChild>
                  <Button size="small" variant="secondary" type="button">
                    Close
                  </Button>
                </RouteFocusModal.Close>
                <Button size="small" type="button" disabled>
                  Submit
                </Button>
              </div>
            </div>
          </div>
        </RouteFocusModal.Body>
      </div>
    </RouteFocusModal>
  )
}

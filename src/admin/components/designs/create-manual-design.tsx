import { RouteFocusModal } from "../modal/route-focus-modal";
import { Button, Heading, Text } from "@medusajs/ui";

interface CreateManualDesignProps {
  onSave?: () => void;
}

export function CreateManualDesign({ onSave }: CreateManualDesignProps) {
  return (
    <RouteFocusModal>
      <RouteFocusModal.Header />
      <RouteFocusModal.Body className="flex flex-1 flex-col items-center overflow-y-auto py-16">
        <div className="flex w-full max-w-[720px] flex-col gap-y-8">
          <div>
            <Heading>Create Design Manually</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              Create a new design from scratch
            </Text>
          </div>
          
          <div className="flex flex-col gap-y-4">
            {/* Empty content as requested */}
          </div>
        </div>
      </RouteFocusModal.Body>
      
      <RouteFocusModal.Footer>
        <div className="flex justify-end items-center gap-x-2 px-6 py-4">
          <RouteFocusModal.Close asChild>
            <Button variant="secondary">
              Close
            </Button>
          </RouteFocusModal.Close>
          
          <Button 
            variant="primary"
            onClick={onSave}
          >
            Save
          </Button>
        </div>
      </RouteFocusModal.Footer>
    </RouteFocusModal>
  );
}

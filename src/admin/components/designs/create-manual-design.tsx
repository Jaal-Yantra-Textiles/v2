import { useState } from "react";
import { RouteFocusModal } from "../modal/route-focus-modal";
import { Button, Heading, Text, Input, Textarea, toast } from "@medusajs/ui";
import { KeyboundForm } from "../utilitites/key-bound-form";
import { useCreateDesign } from "../../hooks/api/designs";
import { useNavigate } from "react-router-dom";

interface CreateManualDesignProps {
  onSave?: () => void;
}

export function CreateManualDesign({ onSave }: CreateManualDesignProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  
  const navigate = useNavigate();
  const { mutateAsync, isPending } = useCreateDesign();
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!name || !description) {
      toast.error("Name and description are required");
      return;
    }
    
    try {
      await mutateAsync(
        {
          name,
          description,
          status: "Conceptual",
          target_completion_date: new Date().toISOString(),
        },
        {
          onSuccess: ({ design }) => {
            toast.success(`Design ${design.name} created successfully`);
            if (onSave) {
              onSave();
            } else {
              navigate(`/designs/${design.id}`);
            }
          },
          onError: (error) => {
            toast.error(error.message || "Failed to create design");
          },
        }
      );
    } catch (error: any) {
      toast.error(error.message || "An unexpected error occurred");
    }
  }
  return (
    <RouteFocusModal>
      <KeyboundForm
              onSubmit={handleSubmit}
              className="flex flex-1 flex-col overflow-hidden"
            >
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
            <div className="flex flex-col gap-y-2">
              <Text size="base" weight="plus">Name</Text>
              <Input 
                placeholder="Enter design name" 
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full"
              />
            </div>
            
            <div className="flex flex-col gap-y-2">
              <Text size="base" weight="plus">Description</Text>
              <Textarea 
                placeholder="Enter design description" 
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                className="w-full"
              />
            </div>
          </div>
        </div>
      </RouteFocusModal.Body>
      
      <RouteFocusModal.Footer>
        <div className="flex justify-end items-center gap-x-2 px-6">
          <RouteFocusModal.Close asChild>
            <Button variant="secondary">
              Close
            </Button>
          </RouteFocusModal.Close>
          
          <Button 
            variant="primary"
            onClick={handleSubmit}
            isLoading={isPending}
            disabled={!name || !description || isPending}
          >
            Save
          </Button>
        </div>
      </RouteFocusModal.Footer>
      </KeyboundForm>
    </RouteFocusModal>
  );
}
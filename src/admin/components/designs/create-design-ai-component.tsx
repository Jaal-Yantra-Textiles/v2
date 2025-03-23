import { useState } from 'react';
import { useNavigate } from "react-router-dom";
import { RouteFocusModal } from "../modal/route-focus-modal";
import { Button, Text, Textarea, Heading, toast } from "@medusajs/ui";
import { Sparkles } from "@medusajs/icons";
import { useCreateDesignLLM } from "../../hooks/api/designs";

interface CreateDesignAIProps {
  onSubmit?: (aiPrompt: string) => void;
}

export function CreateDesignAIComponent({ onSubmit }: CreateDesignAIProps) {
  const [designPrompt, setDesignPrompt] = useState<string>('');
  const navigate = useNavigate();
  
  const createDesignLLM = useCreateDesignLLM({
    onSuccess: (data) => {
      toast.success("Design created successfully");
      
      if (onSubmit) {
        onSubmit(designPrompt);
      } else {
        // Navigate to the design detail page if no onSubmit handler
        navigate(`/designs/${data.design.id}`);
      }
    },
    onError: (error) => {
      toast.error(error.message || "Failed to create design");
    },
  });

  const handleGenerate = () => {
    if (!designPrompt.trim()) return;
    
    createDesignLLM.mutate({
      designPrompt: designPrompt.trim(),
    });
  };

  return (
    <RouteFocusModal>
      <RouteFocusModal.Header />
      <RouteFocusModal.Body className="flex flex-1 flex-col items-center overflow-y-auto py-16">
        <div className="flex w-full max-w-[720px] flex-col gap-y-8">
          <div>
            <Heading>Create Design with AI</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              Describe your design idea and let AI help you create it.
            </Text>
          </div>
          
          <div className="flex flex-col gap-y-4">
            <div>
              <Text size="base" weight="plus" className="mb-2">
                Describe your design
              </Text>
              <Textarea
                placeholder="E.g., Create a summer collection with floral patterns in pastel colors..."
                rows={8}
                className="w-full"
                value={designPrompt}
                onChange={(e) => setDesignPrompt(e.target.value)}
              />
            </div>
            
            <div className="mt-4">
              <Text size="base" weight="plus" className="mb-2">Example prompts:</Text>
              <ul className="list-disc pl-5 text-ui-fg-subtle space-y-2">
                <li>Create a winter collection with geometric patterns in dark blue and white</li>
                <li>Design a sustainable activewear line with recycled materials</li>
                <li>Create a formal wear collection inspired by 1920s fashion</li>
              </ul>
            </div>
          </div>
        </div>
      </RouteFocusModal.Body>
      
      <RouteFocusModal.Footer>
        <div className="flex justify-end items-center gap-x-2">
          <RouteFocusModal.Close asChild>
            <Button variant="secondary">
              Cancel
            </Button>
          </RouteFocusModal.Close>
          
          <Button 
            variant="primary"
            onClick={handleGenerate}
            isLoading={createDesignLLM.isPending}
            disabled={!designPrompt.trim() || createDesignLLM.isPending}
          >
            <Sparkles className="mr-2" />
            {createDesignLLM.isPending ? 'Generating...' : 'Generate with AI'}
          </Button>
        </div>
      </RouteFocusModal.Footer>
    </RouteFocusModal>
  );
}

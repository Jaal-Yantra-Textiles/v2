import { Button, Heading, Text, Input, Textarea, toast } from "@medusajs/ui";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useNavigate } from "react-router-dom";
import { RouteFocusModal } from "../modal/route-focus-modal";
import { KeyboundForm } from "../utilitites/key-bound-form";
import { useCreateDesign } from "../../hooks/api/designs";
import { useRouteModal } from "../modal/use-route-modal";
import { Form } from "../common/form";

// Define the schema for design creation
const designSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().min(1, "Description is required"),
  aiPrompt: z.string().optional(),
});

type DesignFormValues = z.infer<typeof designSchema>;

export function CreateDesign() {
  const [mode, setMode] = useState<'ai' | 'manual'>('manual');
  const navigate = useNavigate();
  const { handleSuccess } = useRouteModal();
  const { mutateAsync, isPending } = useCreateDesign();

  // Initialize form with validation
  const form = useForm<DesignFormValues>({
    resolver: zodResolver(designSchema),
    defaultValues: {
      name: "",
      description: "",
      aiPrompt: "",
    },
  });

  const { 
    handleSubmit, 
    formState: { errors }
  } = form;

  // Form submission handler
  const onSubmit = handleSubmit(async (data) => {
    try {
      await mutateAsync(
        {
          name: data.name,
          description: data.description,
          status: "Conceptual",
          target_completion_date: new Date().toISOString(),
          // If in AI mode, include the prompt
          ...(mode === 'ai' && data.aiPrompt ? { 
            metadata: { ai_prompt: data.aiPrompt } 
          } : {}),
        },
        {
          onSuccess: ({ design }) => {
            toast.success(`Design ${design.name} created successfully`);
            handleSuccess(`/designs/${design.id}`);
          },
          onError: (error) => {
            toast.error(error.message || "Failed to create design");
          },
        }
      );
    } catch (error: any) {
      toast.error(error.message || "An unexpected error occurred");
    }
  });

  return (
    <RouteFocusModal.Form form={form}>
      <KeyboundForm
        onSubmit={onSubmit}
        className="flex flex-1 flex-col overflow-hidden"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onSubmit();
          }
        }}
      >
        <RouteFocusModal.Header />
        <RouteFocusModal.Body className="flex flex-1 flex-col items-center overflow-y-auto py-16">
          <div className="flex w-full max-w-[720px] flex-col gap-y-8">
            <div>
              <Heading>{mode === 'ai' ? 'Create Design with AI' : 'Create Design Manually'}</Heading>
              <Text size="small" className="text-ui-fg-subtle">
                {mode === 'ai' 
                  ? 'Create a new design using AI assistance' 
                  : 'Create a new design from scratch'}
              </Text>
            </div>
            
            {/* Mode toggle - more prominent with better styling */}
            <div className="flex flex-col gap-y-4 p-4 border rounded-lg bg-ui-bg-subtle">
              <Text weight="plus">Design Creation Method</Text>
              <div className="flex gap-x-4">
                <Button
                  variant={mode === 'manual' ? "primary" : "secondary"}
                  onClick={() => setMode('manual')}
                  type="button"
                  size="base"
                  className="flex-1"
                >
                  Manual Design
                </Button>
                <Button
                  variant={mode === 'ai' ? "primary" : "secondary"}
                  onClick={() => setMode('ai')}
                  type="button"
                  size="base"
                  className="flex-1"
                >
                  AI Assisted
                </Button>
              </div>
              <Text size="small" className="text-ui-fg-subtle">
                {mode === 'ai' 
                  ? 'AI will help generate design concepts based on your prompt' 
                  : 'Create your design manually with complete control'}
              </Text>
            </div>
            
            <div className="flex flex-col gap-y-4">
              {/* Fields for Manual mode */}
              {mode === 'manual' && (
                <>
                  {/* Name field */}
                  <Form.Field
                    control={form.control}
                    name="name"
                    render={({ field }) => {
                      return (
                        <Form.Item>
                          <Form.Label>Name</Form.Label>
                          <Form.Control>
                            <Input 
                              placeholder="Enter design name" 
                              {...field}
                            />
                          </Form.Control>
                          {errors.name && (
                            <Form.ErrorMessage>{errors.name.message}</Form.ErrorMessage>
                          )}
                        </Form.Item>
                      )
                    }}
                  />
                  
                  {/* Description field */}
                  <Form.Field
                    control={form.control}
                    name="description"
                    render={({ field }) => {
                      return (
                        <Form.Item>
                          <Form.Label>Description</Form.Label>
                          <Form.Control>
                            <Textarea 
                              placeholder="Enter design description" 
                              rows={4}
                              {...field}
                            />
                          </Form.Control>
                          {errors.description && (
                            <Form.ErrorMessage>{errors.description.message}</Form.ErrorMessage>
                          )}
                        </Form.Item>
                      )
                    }}
                  />
                </>
              )}
              
              {/* Fields for AI mode */}
              {mode === 'ai' && (
                <>
                  {/* AI Prompt field */}
                  <Form.Field
                    control={form.control}
                    name="aiPrompt"
                    render={({ field }) => {
                      return (
                        <Form.Item>
                          <Form.Label>AI Prompt</Form.Label>
                          <Form.Control>
                            <Textarea 
                              placeholder="Describe what you want the AI to create..." 
                              rows={6}
                              {...field}
                            />
                          </Form.Control>
                          <Form.Hint>
                            Provide detailed instructions for the AI to generate your design.
                            <br />
                            Example: "Create a modern logo for a sustainable fashion brand called 'EcoThreads' using earthy tones and minimalist design."
                          </Form.Hint>
                        </Form.Item>
                      )
                    }}
                  />
                  
                  {/* Name field - simplified for AI mode */}
                  <Form.Field
                    control={form.control}
                    name="name"
                    render={({ field }) => {
                      return (
                        <Form.Item>
                          <Form.Label>Design Name</Form.Label>
                          <Form.Control>
                            <Input 
                              placeholder="Give your AI design a name" 
                              {...field}
                            />
                          </Form.Control>
                          {errors.name && (
                            <Form.ErrorMessage>{errors.name.message}</Form.ErrorMessage>
                          )}
                        </Form.Item>
                      )
                    }}
                  />
                </>
              )}
            </div>
          </div>
        </RouteFocusModal.Body>
        
        <RouteFocusModal.Footer>
          <div className="flex justify-end items-center gap-x-2 px-6">
            <Button 
              variant="secondary"
              onClick={() => navigate(-1)}
              type="button"
            >
              Cancel
            </Button>
            
            <Button 
              variant="primary"
              type="submit"
              isLoading={isPending}
              disabled={isPending}
            >
              {mode === 'ai' ? 'Generate with AI' : 'Save'}
            </Button>
          </div>
        </RouteFocusModal.Footer>
      </KeyboundForm>
      
      {/* Navigation blocking is handled by RouteFocusModal and KeyboundForm */}
    </RouteFocusModal.Form>
  );
}

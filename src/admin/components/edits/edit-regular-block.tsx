import React, { useState, useEffect, useRef } from "react";
import { Button, Text, toast, Input, Tooltip } from "@medusajs/ui";
import { useForm } from "react-hook-form";
import "../common/json-editor-overrides.css";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { InformationCircleSolid } from "@medusajs/icons";
import { Form } from "../common/form";
import { KeyboundForm } from "../utilitites/key-bound-form";
import { useRouteModal } from "../modal/use-route-modal";
import { RouteFocusModal } from "../modal/route-focus-modal";
import { useUpdateBlock } from "../../hooks/api/blocks";
import { BlockType } from "../../hooks/api/pages";
import { JsonEditor, monoLightTheme, monoDarkTheme } from "json-edit-react";
import { useDarkMode } from "../../hooks/use-dark-mode";
import { StackedFocusModal } from "../modal/stacked-modal/stacked-focused-modal";
import { SimpleEditor } from "../editor/editor";





const blockSchema = z.object({
  id: z.string(),
  name: z.string().min(1, "Name is required"),
  type: z.enum([
    "Hero",
    "Header",
    "Footer",
    "Feature",
    "Gallery",
    "Testimonial",
    "MainContent",
    "ContactForm",
    "Product",
    "Section",
    "Custom"
  ]),
  content: z.record(z.any()).optional(),
  settings: z.record(z.any()).optional(),
  order: z.number()
});

type BlockFormValues = {
  block: z.infer<typeof blockSchema>;
};

const blockFormSchema = z.object({
  block: blockSchema,
});

interface EditRegularBlockProps {
  websiteId: string;
  pageId: string;
  blockId: string;
  block: z.infer<typeof blockSchema>;
  onSuccess?: () => void;
}

export const EditRegularBlock = ({ websiteId, pageId, blockId, block, onSuccess }: EditRegularBlockProps) => {
  const updateBlock = useUpdateBlock(websiteId, pageId, blockId);
  const { handleSuccess } = useRouteModal();
  const isDarkMode = useDarkMode();

  // Custom theme with proper background colors and text colors
  const lightTheme = [
    monoLightTheme,
    {
      styles: {
        container: {
          backgroundColor: '#ffffff',
        },
        input: {
          color: '#292929', // Dark text for light background
        },
        property: '#292929', // Dark property names
        string: 'rgb(203, 75, 22)', // Keep original string color
        number: 'rgb(38, 139, 210)', // Keep original number color
      },
    },
  ];

  const darkTheme = [
    monoDarkTheme,
    {
      styles: {
        container: {
          backgroundColor: '#1a1a1a',
        },
        input: {
          color: '#e0e0e0', // Light text for dark background
        },
        property: '#e0e0e0', // Light property names
        string: 'rgb(255, 160, 122)', // Lighter string color for dark mode
        number: 'rgb(100, 200, 255)', // Lighter number color for dark mode
      },
    },
  ];

  const form = useForm<BlockFormValues>({
    resolver: zodResolver(blockFormSchema),
    defaultValues: {
      block: {
        id: block.id,
        name: block.name,
        type: block.type as BlockType,
        content: block.content || {},
        settings: block.settings || {},
        order: block.order || 0
      }
    },
    mode: "onSubmit", // Only validate on submit to avoid premature validation
  });

  // Local state for rich editor modal
  const [richBodyDraft, setRichBodyDraft] = useState<any>(() => {
    const current = (block?.content as any)?.body
    return current ?? { type: "doc", content: [{ type: "paragraph" }] }
  })

  // Auto-save functionality
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isInitialMount = useRef(true);
  const previousValuesRef = useRef<string>("");

  // Watch all form fields for changes
  const watchedValues = form.watch();

  useEffect(() => {
    // Skip auto-save on initial mount
    if (isInitialMount.current) {
      isInitialMount.current = false;
      // Store initial values
      previousValuesRef.current = JSON.stringify(watchedValues);
      return;
    }

    // Compare current values with previous values
    const currentValuesString = JSON.stringify(watchedValues);
    const hasActualChanges = currentValuesString !== previousValuesRef.current;

    // Only proceed if there are actual changes
    if (!hasActualChanges) {
      return;
    }

    // Update previous values
    previousValuesRef.current = currentValuesString;

    // Clear existing timeout
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }

    // Set new timeout for auto-save (debounce for 1 second)
    autoSaveTimeoutRef.current = setTimeout(() => {
      handleAutoSave();
    }, 1000);

    // Cleanup timeout on unmount
    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, [watchedValues]);

  // Auto-save handler
  const handleAutoSave = async () => {
    try {
      const formValues = form.getValues();
      const { block } = formValues;
      const { content, settings } = block;

      const updateData = {
        name: block.name,
        type: block.type,
        content: content || {},
        settings: settings || {},
        order: block.order
      };

      await updateBlock.mutateAsync(updateData);
      toast.success("Updated", {
        duration: 2000,
      });
    } catch (error: any) {
      console.error('Auto-save error:', error);
      toast.error("Failed to save changes");
    }
  };

  // Direct submit handler to bypass form validation issues
  const handleDirectSubmit = async () => {
    try {
      // Get current form values
      const formValues = form.getValues();
      console.log('Form values:', formValues);
      
      // Extract block data
      const { block } = formValues;
      const { content, settings } = block;
      
      // No need to process content and settings - they're already objects from the JsonKeyValueEditor
      
      // Prepare update data
      const updateData = {
        name: block.name,
        type: block.type,
        content: content || {},
        settings: settings || {},
        order: block.order
      };
      
      console.log('Sending update data:', updateData);
      
      // Call the API
      const result = await updateBlock.mutateAsync(updateData);
      console.log('Update successful:', result);
      
      toast.success("Block updated successfully");
      onSuccess?.() || handleSuccess(`/websites/${websiteId}/pages/${pageId}`);
    } catch (error: any) {
      console.error('Update error:', error);
      toast.error(error?.message || "Error updating block");
    }
  };


  return (
    <RouteFocusModal.Form form={form}>
      <KeyboundForm
        onSubmit={form.handleSubmit(handleDirectSubmit)}
        className="flex flex-1 flex-col overflow-hidden"
      >
        <RouteFocusModal.Header>
         
        </RouteFocusModal.Header>

        <RouteFocusModal.Body className="flex flex-1 flex-col overflow-y-auto py-8 w-full px-4 md:px-8">
          <div className="flex items-center py-2">
            <Text size="base" weight="plus">
              Edit Block
            </Text>
          </div>
          <div className="flex flex-col gap-y-6 w-full">
                  <Form.Field
                    control={form.control}
                    name="block.name"
                    render={({ field }) => (
                      <Form.Item>
                        <Form.Label>Name</Form.Label>
                        <Form.Control>
                          <Input {...field} placeholder="Block name" />
                        </Form.Control>
                        <Form.ErrorMessage />
                      </Form.Item>
                    )}
                  />

                  <Form.Field
                    control={form.control}
                    name="block.type"
                    render={({ field }) => (
                      <Form.Item>
                        <Form.Label>Type</Form.Label>
                        <Form.Control>
                          <Input 
                            {...field}
                            readOnly 
                            className="bg-ui-bg-disabled text-ui-fg-disabled cursor-not-allowed" 
                          />
                        </Form.Control>
                        <Form.ErrorMessage />
                      </Form.Item>
                    )}
                  />

                  <Form.Field
                    control={form.control}
                    name="block.content"
                    render={({ field }) => (
                      <Form.Item>
                        <div className="flex items-center gap-x-2">
                          <Form.Label>Content</Form.Label>
                          <Tooltip content="Content defines the main data of the block, such as text, images, and layout settings.">
                            <InformationCircleSolid className="text-ui-fg-subtle h-4 w-4" />
                          </Tooltip>
                        </div>
                        <Form.Control>
                          <div className="w-full border border-ui-border-base rounded-md overflow-hidden">
                            <JsonEditor
                              data={field.value || {}}
                              setData={(newData) => {
                                if (typeof newData === 'object' && newData !== null && Object.keys(newData).length === 0 && (!field.value || Object.keys(field.value).length === 0)) {
                                  field.onChange(undefined);
                                } else {
                                  field.onChange(newData);
                                }
                              }}
                              theme={isDarkMode ? darkTheme : lightTheme}
                            />
                          </div>
                        </Form.Control>
                        {form.getValues("block.type") === "MainContent" && (
                          <div className="mt-2">
                            <StackedFocusModal id="rich-body-editor">
                              <StackedFocusModal.Trigger asChild>
                                <Button
                                  variant="secondary"
                                  size="small"
                                  onClick={() => {
                                    const current = form.getValues("block.content") as any
                                    setRichBodyDraft(current?.body ?? { type: "doc", content: [{ type: "paragraph" }] })
                                  }}
                                >
                                  Edit Body (Rich Editor)
                                </Button>
                              </StackedFocusModal.Trigger>
                              <StackedFocusModal.Content className="flex flex-col">
                                <StackedFocusModal.Header>
                                  <StackedFocusModal.Title>Edit Main Content Body</StackedFocusModal.Title>
                                </StackedFocusModal.Header>
                                <div className="overflow-y-auto p-2">
                                  <SimpleEditor
                                    editorContent={typeof richBodyDraft === 'string' ? richBodyDraft : JSON.stringify(richBodyDraft)}
                                    setEditorContent={(content) => {
                                      // content will be JSON object when outputFormat=json
                                      setRichBodyDraft(content)
                                    }}
                                    outputFormat="json"
                                  />
                                </div>
                                <StackedFocusModal.Footer>
                                  <div className="flex w-full items-center justify-end gap-x-2">
                                    <StackedFocusModal.Close asChild>
                                      <Button variant="secondary">Cancel</Button>
                                    </StackedFocusModal.Close>
                                    <StackedFocusModal.Close asChild>
                                      <Button
                                        variant="primary"
                                        onClick={() => {
                                          const current = (form.getValues("block.content") as any) || {}
                                          const next = { ...current, body: richBodyDraft }
                                          form.setValue("block.content", next, { shouldDirty: true })
                                          toast.success("Body content updated")
                                        }}
                                      >
                                        Save and Close
                                      </Button>
                                    </StackedFocusModal.Close>
                                  </div>
                                </StackedFocusModal.Footer>
                              </StackedFocusModal.Content>
                            </StackedFocusModal>
                          </div>
                        )}
                        <Form.ErrorMessage />
                      </Form.Item>
                    )}
                  />

                  <Form.Field
                    control={form.control}
                    name="block.settings"
                    render={({ field }) => (
                      <Form.Item>
                        <div className="flex items-center gap-x-2">
                          <Form.Label>Settings</Form.Label>
                          <Tooltip content="Settings control the visual appearance of the block, such as colors, padding, and alignment.">
                            <InformationCircleSolid className="text-ui-fg-subtle h-4 w-4" />
                          </Tooltip>
                        </div>
                        <Form.Control>
                          <div className="w-full h-[150px] border border-ui-border-base rounded-md overflow-hidden">
                            <JsonEditor
                              data={field.value || {}}
                              setData={(newData) => {
                                if (typeof newData === 'object' && newData !== null && Object.keys(newData).length === 0 && (!field.value || Object.keys(field.value).length === 0)) {
                                  field.onChange(undefined);
                                } else {
                                  field.onChange(newData);
                                }
                              }}
                              theme={isDarkMode ? darkTheme : lightTheme}
                              className="w-full h-full"
                            />
                          </div>
                        </Form.Control>
                        <Form.ErrorMessage />
                      </Form.Item>
                    )}
                  />

                  <Form.Field
                    control={form.control}
                    name="block.order"
                    render={({ field }) => (
                      <Form.Item>
                        <Form.Label>Order</Form.Label>
                        <Form.Control>
                          <Input 
                            {...field} 
                            type="number" 
                            placeholder="Block display order" 
                            min="0"
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => field.onChange(parseInt(e.target.value) || 0)}
                          />
                        </Form.Control>
                        <Form.ErrorMessage />
                      </Form.Item>
                    )}
                  />
          </div>
        </RouteFocusModal.Body>
      <RouteFocusModal.Footer className="px-4 md:px-8">
        <Button
          variant="primary"
          onClick={handleDirectSubmit}
          disabled={form.formState.isSubmitting}
        >
          Update Block
        </Button>
      </RouteFocusModal.Footer>
      </KeyboundForm>
    </RouteFocusModal.Form>
  );
};

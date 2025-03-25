import { Button, Text, toast, Input, Tooltip } from "@medusajs/ui";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { InformationCircleSolid } from "@medusajs/icons";
import { Form } from "../common/form";
import { KeyboundForm } from "../utilitites/key-bound-form";
import { useRouteModal } from "../modal/use-route-modal";
import { RouteFocusModal } from "../modal/route-focus-modal";
import { useUpdateBlock } from "../../hooks/api/blocks";
import { BlockType } from "../../hooks/api/pages";
import { JsonKeyValueEditor } from "../common/json-key-value-editor";





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

  const form = useForm<BlockFormValues>({
    resolver: zodResolver(blockSchema),
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

        <RouteFocusModal.Body className="flex flex-1 flex-col items-center overflow-y-auto py-8 w-full">
          <div className="flex w-full flex-col gap-y-6 px-4 md:px-8">
            <div className="w-full">
              <div className="flex items-center py-2">
                <Text size="base" weight="plus">
                  Edit Block
                </Text>
              </div>
              <div className="w-full">
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
                          <JsonKeyValueEditor 
                            initialValue={field.value || {}} 
                            onChange={field.onChange}
                            label="Content"
                          />
                        </Form.Control>
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
                          <JsonKeyValueEditor 
                            initialValue={field.value || {}} 
                            onChange={field.onChange}
                            label="Settings"
                          />
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
              </div>
            </div>
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

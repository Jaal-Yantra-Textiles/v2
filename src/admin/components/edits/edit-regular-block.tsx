import { Button, Input, Text, toast, Textarea, Tooltip } from "@medusajs/ui";
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
  content: z.record(z.unknown()).optional(),
  settings: z.record(z.unknown()).optional(),
  order: z.number()
});

type BlockFormValues = {
  block: z.infer<typeof blockSchema>;
};

interface EditRegularBlockProps {
  websiteId: string;
  pageId: string;
  blockId: string;
  block: any; // Replace with proper type
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
    }
  });

  const handleSubmit = form.handleSubmit(async (data: BlockFormValues) => {
    try {
      const { id, ...updateData } = data.block;
      await updateBlock.mutateAsync(updateData);
      
      toast.success("Block updated successfully");
      onSuccess?.() || handleSuccess(`/websites/${websiteId}/pages/${pageId}`);
    } catch (error) {
      toast.error("Error updating block");
      console.error(error);
    }
  });

  return (
    <RouteFocusModal.Form form={form}>
      <KeyboundForm
        onSubmit={handleSubmit}
        className="flex flex-1 flex-col overflow-hidden"
      >
        <RouteFocusModal.Header>
         
        </RouteFocusModal.Header>

        <RouteFocusModal.Body className="flex flex-1 flex-col items-center overflow-y-auto py-16">
          <div className="flex w-full max-w-[720px] flex-col gap-y-8">
            <div className="border rounded-lg">
              <div className="flex items-center p-4 border-b">
                <Text size="base" weight="plus">
                  {block.type} Block
                </Text>
              </div>
              <div className="p-4">
                <div className="flex flex-col gap-y-4">
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
                    name="block.content"
                    render={({ field }) => (
                      <Form.Item>
                        <div className="flex items-center gap-x-2">
                          <Form.Label>Content (JSON)</Form.Label>
                          <Tooltip content="Content defines the main data of the block, such as text, images, and layout settings.">
                            <InformationCircleSolid className="text-ui-fg-subtle h-4 w-4" />
                          </Tooltip>
                        </div>
                        <Form.Control>
                          <Textarea 
                            {...field} 
                            value={typeof field.value === 'string' 
                              ? field.value 
                              : JSON.stringify(field.value, null, 2)}
                            onChange={(e) => {
                              try {
                                const parsed = JSON.parse(e.target.value);
                                field.onChange(parsed);
                              } catch (error) {
                                // Allow invalid JSON while typing
                                field.onChange(e.target.value);
                              }
                            }}
                            placeholder="Block content in JSON format"
                            rows={10}
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
                          <Form.Label>Settings (JSON)</Form.Label>
                          <Tooltip content="Settings control the visual appearance of the block, such as colors, padding, and alignment.">
                            <InformationCircleSolid className="text-ui-fg-subtle h-4 w-4" />
                          </Tooltip>
                        </div>
                        <Form.Control>
                          <Textarea 
                            {...field}
                            value={typeof field.value === 'string' 
                              ? field.value 
                              : JSON.stringify(field.value, null, 2)}
                            onChange={(e) => {
                              try {
                                const parsed = JSON.parse(e.target.value);
                                field.onChange(parsed);
                              } catch (error) {
                                // Allow invalid JSON while typing
                                field.onChange(e.target.value);
                              }
                            }}
                            placeholder="Block settings in JSON format"
                            rows={10}
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
      <RouteFocusModal.Footer>
        <Button
          variant="primary"
          type="submit"
          disabled={!form.formState.isDirty || form.formState.isSubmitting}
        >
          Update Block
        </Button>
      </RouteFocusModal.Footer>
      </KeyboundForm>
    </RouteFocusModal.Form>
  );
};

import { Button, Heading, IconButton, Input, Text, toast, Textarea, Tooltip } from "@medusajs/ui";
import { Trash, InformationCircleSolid } from "@medusajs/icons";
import { BlockTemplateSelector } from "../websites/block-template-selector";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useNavigate } from "react-router-dom";
import { Form } from "../common/form";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { KeyboundForm } from "../utilitites/key-bound-form";
import { useCreateBlock } from "../../hooks/api/blocks";
import { useRouteModal } from "../modal/use-route-modal";
import { RouteFocusModal } from "../modal/route-focus-modal";
import { useEffect, useState } from "react";
import { blockTemplates, BlockType } from "../websites/block-templates";

const blockSchema = z.object({
  blocks: z.array(z.object({
    name: z.string().min(1, "Name is required"),
    type: z.enum([
      "Hero",
      "Header",
      "Footer",
      "Feature",
      "Gallery",
      "Testimonial",
      "MainContent"
    ]),
    content: z.record(z.unknown()).optional(),
    settings: z.record(z.unknown()).optional(),
    order: z.number().min(0)
  })).min(1, "At least one block is required")
});

type BlockFormValues = z.infer<typeof blockSchema>;



interface CreateWebsiteBlocksProps {
  websiteId: string;
  pageId: string;
}

export function CreateWebsiteBlocks({ websiteId, pageId }: CreateWebsiteBlocksProps) {
  const navigate = useNavigate();
  const createBlock = useCreateBlock(websiteId, pageId);
  const { handleSuccess } = useRouteModal();
  const [expandedSections, setExpandedSections] = useState<Record<number, boolean>>({});

  const form = useForm<BlockFormValues>({
    resolver: zodResolver(blockSchema),
    defaultValues: {
      blocks: []
    }
  });

  const { fields, append, remove } = useFieldArray({
    name: "blocks",
    control: form.control
  });

  useEffect(() => {
    // Expand first section by default when a block is added
    if (fields.length > 0) {
      setExpandedSections({ [fields.length - 1]: true });
    }
  }, [fields.length]);

  const toggleSection = (index: number) => {
    setExpandedSections(prev => ({
      ...prev,
      [index]: !prev[index]
    }));
  };

  const handleSubmit = form.handleSubmit(async (data: BlockFormValues) => {
    try {
      // Create all blocks in a single API call
      await createBlock.mutateAsync({ blocks: data.blocks });
      
      toast.success("Blocks created successfully");
      handleSuccess(`/websites/${websiteId}/pages/${pageId}`);
    } catch (error) {
      toast.error("Error creating blocks");
    }
  });

  const addBlock = (type: BlockType) => {
    const template = blockTemplates[type];
    append({
      name: template.name,
      type: template.type,
      content: template.content ? JSON.parse(JSON.stringify(template.content)) : undefined,
      settings: template.settings ? JSON.parse(JSON.stringify(template.settings)) : undefined,
      order: fields.length
    });
  };

  if (!websiteId || !pageId) return null;

  return (
    <RouteFocusModal.Form form={form}>
      <KeyboundForm
        onSubmit={handleSubmit}
        className="flex flex-1 flex-col overflow-hidden"
      >
        <RouteFocusModal.Header />
        <RouteFocusModal.Body className="flex flex-1 flex-col items-center overflow-y-auto py-16">
          <div className="flex w-full max-w-[720px] flex-col gap-y-8">
            <div>
              <Heading>Create Blocks</Heading>
              <Text className="text-ui-fg-subtle">
                Add blocks to your page
              </Text>
            </div>

            <div className="flex flex-col gap-y-4">
              {fields.map((field, index) => (
                <div key={field.id} className="border rounded-lg overflow-hidden">
                  <Collapsible
                    open={expandedSections[index]}
                    onOpenChange={() => toggleSection(index)}
                  >
                    <div className="flex items-center justify-between p-4 border-b cursor-pointer">
                      <CollapsibleTrigger className="flex-1 flex items-center justify-between">
                        <Text size="base" weight="plus">
                          Block {index + 1} - {form.watch(`blocks.${index}.type`)}
                        </Text>
                        <div className="flex items-center">
                          {expandedSections[index] ? "-" : "+"}
                        </div>
                      </CollapsibleTrigger>
                      <div className="flex items-center gap-x-2 ml-2">
                        <Tooltip content="Remove block">
                          <IconButton
                            size="small"
                            variant="transparent"
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              remove(index);
                            }}
                          >
                            <Trash className="w-4 h-4" />
                          </IconButton>
                        </Tooltip>
                      </div>
                    </div>
                    <CollapsibleContent>
                      <div className="p-4">
                        <div className="flex flex-col gap-y-4">
                        <Form.Field
                          control={form.control}
                          name={`blocks.${index}.name`}
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
                          name={`blocks.${index}.content`}
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
                          name={`blocks.${index}.settings`}
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
                                  rows={5}
                                />
                              </Form.Control>
                              <Form.ErrorMessage />
                            </Form.Item>
                          )}
                        />
                        </div>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </div>
              ))}
            </div>
          </div>
        </RouteFocusModal.Body>
        <RouteFocusModal.Footer>
          <div className="flex items-center justify-between w-full">
            <BlockTemplateSelector onSelect={addBlock} />
            <div className="flex gap-x-2">
              <Button
                variant="secondary"
                onClick={() => navigate(`/websites/${websiteId}/pages/${pageId}`)}
              >
                Cancel
              </Button>
              <Button type="submit">Create Blocks</Button>
            </div>
          </div>
        </RouteFocusModal.Footer>
      </KeyboundForm>
    </RouteFocusModal.Form>
  );
}

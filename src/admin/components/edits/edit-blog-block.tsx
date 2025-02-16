import { Button, Text, toast } from "@medusajs/ui";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import { Block as BlockNoteBlock } from "@blocknote/core";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { KeyboundForm } from "../utilitites/key-bound-form";
import { useRouteModal } from "../modal/use-route-modal";
import { RouteFocusModal } from "../modal/route-focus-modal";
import { useUpdateBlock } from "../../hooks/api/blocks";
import { useEffect, useState } from "react";

const blockSchema = z.object({
  content: z.object({
    text: z.string(),
  })
});

type BlockFormValues = {
  content: z.infer<typeof blockSchema>["content"];
};

interface EditBlogBlockProps {
  websiteId: string;
  pageId: string;
  blockId: string;
  block: any; // Replace with proper type
  onSuccess?: () => void;
}

export const EditBlogBlock = ({ websiteId, pageId, blockId, block, onSuccess }: EditBlogBlockProps) => {
  const [editorContent, setEditorContent] = useState<BlockNoteBlock[]>([]);
  const updateBlock = useUpdateBlock(websiteId, pageId, blockId);
  const { handleSuccess } = useRouteModal();

  // Initialize BlockNote editor with default content if empty
  const editor = useCreateBlockNote({
    initialContent: block?.content?.text ? 
      JSON.parse(block.content.text) : 
      [{ type: "paragraph", content: [{ type: "text", text: "" }] }],
  });

  const form = useForm<BlockFormValues>({
    mode: "onChange",
    resolver: zodResolver(blockSchema),
    defaultValues: {
      content: {
        text: block.content?.text || ""
      }
    }
  });

  useEffect(() => {
    if (block?.content?.text) {
      try {
        const parsedContent = JSON.parse(block.content.text);
        setEditorContent(parsedContent);
        editor.replaceBlocks(editor.document, parsedContent);
      } catch (error) {
        console.error("Error parsing blog content:", error);
      }
    }
  }, [block, editor]);

  // Keep form values in sync with editor content
  useEffect(() => {
    if (editorContent.length > 0) {
      form.setValue('content.text', JSON.stringify(editorContent), {
        shouldDirty: true
      });
    }
  }, [editorContent, form]);

  const handleSubmit = form.handleSubmit(async (data: BlockFormValues) => {
    console.log('Submitting data:', data);
    try {
      // Use the form data's content
      const payload = {
        name: block.name,
        type: "MainContent" as const,
        content: {
          text: data.content.text, // Use form data instead of getting from editor directly
          layout: "full" as const
        },
        settings: {
          alignment: "left" as const
        },
        order: block.order || 0
      };
      
      console.log('Update payload:', payload);

      await updateBlock.mutateAsync(payload);
      
      toast.success("Content updated successfully");
      onSuccess?.() || handleSuccess(`/websites/${websiteId}/pages/${pageId}`);
    } catch (error) {
      toast.error("Error updating content");
      console.error(error);
    }
  });

  // Debug form state
  console.log('Form state:', {
    values: form.getValues(),
    errors: form.formState.errors,
    isDirty: form.formState.isDirty,
    isSubmitting: form.formState.isSubmitting
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
            <div>
              <Text size="base" weight="plus">
                {block.name}
              </Text>
            </div>
            <div className="">
              <BlockNoteView
                editor={editor}
                onChange={() => {
                  const blocks = editor.document;
                  setEditorContent(blocks);
                }}
              />
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

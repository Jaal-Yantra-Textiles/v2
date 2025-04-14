import { Button, Switch, Text, toast } from "@medusajs/ui";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { KeyboundForm } from "../utilitites/key-bound-form";
import { useRouteModal } from "../modal/use-route-modal";
import { RouteFocusModal } from "../modal/route-focus-modal";
import { useUpdateBlock } from "../../hooks/api/blocks";
import { useCallback, useEffect, useRef, useState } from "react";
import { TextEditor } from "../common/richtext-editor";

const blockSchema = z.object({
  content: z.object({
    text: z.any(), // Allow any type to accommodate both string and object
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
  const [editorContent, setEditorContent] = useState(block.content.text);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(true);
  const [firstImageUrl, setFirstImageUrl] = useState(block.content.image?.content || "");
  const saveTimeoutRef = useRef<NodeJS.Timeout>();
  const lastSavedContentRef = useRef(block.content.text);
  const initialRenderRef = useRef(true);
  const editorInstanceRef = useRef<any>(null);
  const updateBlock = useUpdateBlock(websiteId, pageId, blockId);
  const { handleSuccess } = useRouteModal();
  
  // Initialize form
  const form = useForm<BlockFormValues>({
    mode: "onChange",
    resolver: zodResolver(blockSchema),
    defaultValues: {
      content: {
        text: block.content?.text || ""
      }
    }
  });
  
  // Prevent initial save
  useEffect(() => {
    // Set to false after component mounts
    initialRenderRef.current = false;
    
    // Cleanup timeout on unmount
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  // Function to extract the first image URL from editor content
  const extractFirstImageUrl = useCallback((editor: any) => {
    if (!editor || !editor.state) return "";
    
    try {
      // Find the first image node in the editor
      let imageUrl = "";
      
      // Access the document and traverse it safely
      const doc = editor.state.doc;
      if (doc && typeof doc.descendants === 'function') {
        doc.descendants((node: any) => {
          if (node.type && node.type.name === 'image' && !imageUrl && node.attrs && node.attrs.src) {
            imageUrl = node.attrs.src;
            return false; // Stop traversing once we find the first image
          }
          return true; // Continue traversing
        });
      }
      
      return imageUrl;
    } catch (error) {
      console.error('Error extracting image URL:', error);
      return "";
    }
  }, []);

  const autoSaveContent = useCallback(async (content: any) => {
    // Store the raw content for comparison
    const contentString = JSON.stringify(content);
    
    // Don't save if content hasn't changed
    if (contentString === lastSavedContentRef.current) {
      return;
    }

    // Extract first image URL if editor instance is available
    const currentImageUrl = editorInstanceRef.current ? 
      extractFirstImageUrl(editorInstanceRef.current) : firstImageUrl;
    
    try {
      const payload = {
        content: {
          ...block.content,
          text: content, // Use the raw content directly
          image: {
            type: "image",
            content: currentImageUrl
          }
        },
      };
      await updateBlock.mutateAsync(payload);
      lastSavedContentRef.current = contentString; // Store stringified for comparison
      
      // Update the first image URL state if it changed
      if (currentImageUrl !== firstImageUrl) {
        setFirstImageUrl(currentImageUrl);
      }
      
      toast.success("Content saved", { id: "content-saved" });
    } catch (error) {
      toast.error("Error saving content", { id: "content-save-error" });
      console.error(error);
    }
  }, [block.content, updateBlock, firstImageUrl, extractFirstImageUrl]);

  // Simple handler that only updates when content changes
  const handleEditorChange = useCallback((content: any) => {
    setEditorContent(content);
    
    // Skip auto-save on initial render
    if (initialRenderRef.current) {
      return;
    }
    
    // Set form as dirty to enable update button
    form.setValue('content.text', 'changed', {
      shouldDirty: true,
      shouldTouch: true
    });
    
    // Only save if autosave is enabled
    if (autoSaveEnabled) {
      autoSaveContent(content);
    }
  }, [form, autoSaveContent, autoSaveEnabled]);



  const handleSubmit = form.handleSubmit(async () => {
    try {
      // Extract first image URL if editor instance is available
      const currentImageUrl = editorInstanceRef.current ? 
        extractFirstImageUrl(editorInstanceRef.current) : firstImageUrl;
      
      // Use the current editor content directly
      const payload = {
        name: block.name,
        type: "MainContent" as const,
        content: {
          ...block.content,
          text: editorContent, // Use editor content directly
          layout: "full" as const,
          image: {
            type: "image",
            content: currentImageUrl
          }
        },
        settings: {
          alignment: "left" as const
        },
        order: block.order || 0
      };
  
      await updateBlock.mutateAsync(payload);
      
      // Update the first image URL state if it changed
      if (currentImageUrl !== firstImageUrl) {
        setFirstImageUrl(currentImageUrl);
      }
      
      // Store stringified content for comparison
      lastSavedContentRef.current = JSON.stringify(editorContent);
      
      // Reset form dirty state
      form.reset(undefined, { keepValues: true });
      
      toast.success("Content updated successfully");
      onSuccess?.() || handleSuccess(`/websites/${websiteId}/pages/${pageId}`);
    } catch (error) {
      toast.error("Error updating content");
          
    }
  });

  return (
    <RouteFocusModal.Form form={form}>
      <KeyboundForm
        onSubmit={handleSubmit}
        className="flex flex-1 flex-col overflow-hidden"
      >
        <RouteFocusModal.Header>
          <div className="flex items-center justify-between w-full px-8 py-2">
            <Text size="large" weight="plus">Edit Blog Content</Text>
            <div className="flex items-center gap-2">
              <Text size="small">Autosave</Text>
              <Switch
                checked={autoSaveEnabled}
                onCheckedChange={setAutoSaveEnabled}
              />
            </div>
          </div>
        </RouteFocusModal.Header>

        <RouteFocusModal.Body className="flex flex-1 flex-col overflow-hidden">
          <div className="flex h-full w-full flex-col">
            <div className="px-8 py-4 border-b">
              <Text size="base" weight="plus">
                {block.name}
              </Text>
            </div>
            <div className="flex-1 h-full overflow-y-auto">
              <TextEditor
                editorContent={editorContent}
                setEditorContent={handleEditorChange}
                isLoading={false} /* Never show loading state in editor */
                onEditorReady={(editor) => {
                  editorInstanceRef.current = editor;
                  // Extract first image on initial load
                  const imageUrl = extractFirstImageUrl(editor);
                  if (imageUrl && imageUrl !== firstImageUrl) {
                    setFirstImageUrl(imageUrl);
                  }
                }}
              />
            </div>
          </div>
        </RouteFocusModal.Body>
        <RouteFocusModal.Footer>
          <div className="flex items-center justify-between w-full px-8">
            <div>
              {!autoSaveEnabled && (
                <Text size="small" className="text-gray-500">
                  Form state: {form.formState.isDirty ? 'Changed' : 'Unchanged'}
                </Text>
              )}
            </div>
            <Button
              variant="primary"
              type="submit"
              disabled={autoSaveEnabled || !form.formState.isDirty || form.formState.isSubmitting}
            >
              {autoSaveEnabled ? "Autosave Enabled" : form.formState.isDirty ? "Update Block" : "No Changes"}
            </Button>
          </div>
        </RouteFocusModal.Footer>
      </KeyboundForm>
    </RouteFocusModal.Form>
  );
};

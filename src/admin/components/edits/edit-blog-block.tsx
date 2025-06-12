import { Button, Prompt, Switch, Text, toast } from "@medusajs/ui";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useUpdateBlock } from "../../hooks/api/blocks";
import { useRouteNonFocusModal } from "../modal/route-non-focus";
import { useCallback, useEffect, useRef, useState } from "react";
import { TextEditor } from "../common/richtext-editor";
import { RouteNonFocusModal } from "../modal/route-non-focus";
import { useTranslation } from "react-i18next";

const blockSchema = z.object({
  content: z.object({
    text: z.any(), // Allow any type to accommodate both string and object
  }),
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

const EditBlogBlockInner = ({ websiteId, pageId, blockId, block, onSuccess }: EditBlogBlockProps) => {
  const [editorContent, setEditorContent] = useState(block.content.text);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(true);
  const [firstImageUrl, setFirstImageUrl] = useState(block.content.image?.content || "");
  const saveTimeoutRef = useRef<NodeJS.Timeout>();
  const lastSavedContentRef = useRef(block.content.text);
  const initialRenderRef = useRef(true);
  const editorInstanceRef = useRef<any>(null);
  const { t } = useTranslation();
  const { close, registerBeforeClose, setIsChildPromptOpen } = useRouteNonFocusModal();
  const [showConfirmationPrompt, setShowConfirmationPrompt] = useState(false);
  const promptPromiseResolveRef = useRef<((value: boolean | PromiseLike<boolean>) => void) | null>(null);
  const updateBlock = useUpdateBlock(websiteId, pageId, blockId);

  // Effect to inform the modal about the prompt's visibility
  useEffect(() => {
    if (setIsChildPromptOpen) {
      setIsChildPromptOpen(showConfirmationPrompt);
    }
    // Cleanup function to reset when component unmounts or prompt is hidden
    return () => {
      if (setIsChildPromptOpen) {
        setIsChildPromptOpen(false);
      }
    };
  }, [showConfirmationPrompt, setIsChildPromptOpen]);

  const form = useForm<BlockFormValues>({
    mode: "onChange",
    resolver: zodResolver(blockSchema),
    defaultValues: {
      content: {
        text: block.content?.text || "",
      },
    },
  });

  useEffect(() => {
    initialRenderRef.current = false;
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  const extractFirstImageUrl = useCallback((editor: any) => {
    if (!editor || !editor.state) return "";
    try {
      let imageUrl = "";
      const doc = editor.state.doc;
      if (doc && typeof doc.descendants === 'function') {
        doc.descendants((node: any) => {
          if (node.type && node.type.name === 'image' && !imageUrl && node.attrs && node.attrs.src) {
            imageUrl = node.attrs.src;
            return false;
          }
          return true;
        });
      }
      return imageUrl;
    } catch (error) {
      console.error('Error extracting image URL:', error);
      return "";
    }
  }, []);

  const autoSaveContent = useCallback(async (content: any) => {
    const contentString = JSON.stringify(content);
    if (contentString === lastSavedContentRef.current) {
      return;
    }

    const currentImageUrl = editorInstanceRef.current ? extractFirstImageUrl(editorInstanceRef.current) : firstImageUrl;

    try {
      const payload = {
        content: {
          ...block.content,
          text: content,
          image: {
            type: "image",
            content: currentImageUrl,
          },
        },
      };
      await updateBlock.mutateAsync(payload);
      lastSavedContentRef.current = contentString;

      if (currentImageUrl !== firstImageUrl) {
        setFirstImageUrl(currentImageUrl);
      }

      toast.success("Content saved", { id: "content-saved" });
    } catch (error) {
      toast.error("Error saving content", { id: "content-save-error" });
      console.error(error);
    }
  }, [block.content, updateBlock, firstImageUrl, extractFirstImageUrl]);

  const handleEditorChange = useCallback((content: any) => {
    setEditorContent(content);
    if (initialRenderRef.current) {
      return;
    }

    form.setValue('content.text', content, {
      shouldDirty: true,
      shouldTouch: true,
    });

    if (autoSaveEnabled) {
      autoSaveContent(content);
    }
  }, [form, autoSaveContent, autoSaveEnabled]);

  const handleSubmit = form.handleSubmit(async (data) => {
    try {
      const currentImageUrl = editorInstanceRef.current ? extractFirstImageUrl(editorInstanceRef.current) : firstImageUrl;

      const payload = {
        name: block.name,
        type: "MainContent" as const,
        content: {
          ...block.content,
          text: data.content.text,
          layout: "full" as const,
          image: {
            type: "image",
            content: currentImageUrl,
          },
        },
        settings: {
          alignment: "left" as const,
        },
        order: block.order || 0,
      };

      await updateBlock.mutateAsync(payload);

      if (currentImageUrl !== firstImageUrl) {
        setFirstImageUrl(currentImageUrl);
      }

      lastSavedContentRef.current = JSON.stringify(data.content.text);

      form.reset(data);

      toast.success("Content updated successfully");
      if (onSuccess) {
        onSuccess();
      }
    } catch (error) {
      toast.error("Error updating content");
    }
  });



  const handleBeforeClose = useCallback(async () => {
    console.log("Checking before close...");
    console.log("Is autosave enabled?", autoSaveEnabled);
    console.log("Is form dirty?", form.formState.isDirty);

    if (autoSaveEnabled || !form.formState.isDirty) {
      console.log("Condition met, closing without prompt.");
      return true; // No prompt needed, allow close
    }

    console.log("Condition not met, showing prompt.");
    setShowConfirmationPrompt(true);
    // Return a promise that will be resolved by the prompt's buttons
    return new Promise<boolean>((resolve) => {
      promptPromiseResolveRef.current = resolve;
    });
  }, [autoSaveEnabled, form.formState.isDirty, t]);

  useEffect(() => {
    registerBeforeClose(handleBeforeClose);
  }, [registerBeforeClose, handleBeforeClose]);

  const handlePromptConfirm = () => {
    if (promptPromiseResolveRef.current) {
      promptPromiseResolveRef.current(true);
    }
    setShowConfirmationPrompt(false);
  };

  const handlePromptDismiss = () => {
    if (promptPromiseResolveRef.current) {
      promptPromiseResolveRef.current(false);
    }
    setShowConfirmationPrompt(false);
  };

  return (
    <>
      <RouteNonFocusModal.Header>
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
      </RouteNonFocusModal.Header>

      <RouteNonFocusModal.Body className="flex flex-1 flex-col overflow-hidden">
        <div className="flex h-full w-full flex-col">
          <div className="flex-1 h-full overflow-y-auto">
            <TextEditor
              editorContent={editorContent}
              setEditorContent={handleEditorChange}
              isLoading={false}
              onEditorReady={(editor) => {
                editorInstanceRef.current = editor;
                const imageUrl = extractFirstImageUrl(editor);
                if (imageUrl && imageUrl !== firstImageUrl) {
                  setFirstImageUrl(imageUrl);
                }
              }}
            />
          </div>
        </div>
      </RouteNonFocusModal.Body>

      {showConfirmationPrompt && (
        <>

          <Prompt
            variant="confirmation"
            open={showConfirmationPrompt}
            onOpenChange={(isOpen) => {
              if (!isOpen) {
                handlePromptDismiss();
              }
            }}
          >
            <Prompt.Content style={{ zIndex: 50 }}>
              <Prompt.Header>
                <Prompt.Title>{t("general.unsavedChangesTitle")}</Prompt.Title>
                <Prompt.Description>{t("general.unsavedChangesDescription")}</Prompt.Description>
              </Prompt.Header>
              <Prompt.Footer>
                <Prompt.Cancel onClick={handlePromptDismiss}>{t("general.cancel")}</Prompt.Cancel>
                <Prompt.Action onClick={handlePromptConfirm}>{t("general.confirm")}</Prompt.Action>
              </Prompt.Footer>
            </Prompt.Content>
          </Prompt>
        </>
      )}
      <RouteNonFocusModal.Footer>
        <div className="flex items-center justify-between w-full px-8">
          <div>
            {!autoSaveEnabled && (
              <Text size="small" className="text-gray-500">
                Form state: {form.formState.isDirty ? 'Changed' : 'Unchanged'}
              </Text>
            )}
          </div>
          <div className="flex items-center justify-end gap-x-2">
            <Button
              variant="primary"
              type="submit"
              onClick={handleSubmit}
              disabled={autoSaveEnabled || !form.formState.isDirty || form.formState.isSubmitting}
            >
              {autoSaveEnabled ? "Autosave Enabled" : form.formState.isDirty ? "Update Block" : "No Changes"}
            </Button>
            <Button
              variant="secondary"
              onClick={close}
            >
              Close
            </Button>
          </div>
        </div>
      </RouteNonFocusModal.Footer>
    </>
  );
};

export const EditBlogBlock = (props: EditBlogBlockProps) => {
  return (
    <RouteNonFocusModal>
      <EditBlogBlockInner {...props} />
    </RouteNonFocusModal>
  );
};

import { Button, Prompt, Switch, Tabs, Text, toast } from "@medusajs/ui";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "@medusajs/framework/zod";
import { useUpdateBlock } from "../../hooks/api/blocks";
import { usePage } from "../../hooks/api/pages";
import { useRouteNonFocusModal } from "../modal/route-non-focus";
import { useCallback, useEffect, useRef, useState } from "react";
import { RouteNonFocusModal } from "../modal/route-non-focus";
import { useTranslation } from "react-i18next";
import { SimpleEditor } from "../editor/editor";
import { EmailComposer, type EmailComposerValue } from "../email-editor/email-composer";

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
  const { close, registerBeforeClose } = useRouteNonFocusModal();
  const [showConfirmationPrompt, setShowConfirmationPrompt] = useState(false);
  const promptPromiseResolveRef = useRef<((value: boolean | PromiseLike<boolean>) => void) | null>(null);
  const updateBlock = useUpdateBlock(websiteId, pageId, blockId);
  // The send path tags newsletter links with the post's slug; product cards do too.
  const { page } = usePage(websiteId, pageId);
  const [activeTab, setActiveTab] = useState<"website" | "email">("website");

  // #2349 — the website text and the email version live in the same
  // `block.content`. The server deep-merges a content patch onto the stored
  // block (update-block.ts), so each editor sends only its own fields. What the
  // client must guarantee is ORDER: autosave fires per keystroke, and parallel
  // saves can land out of order so an older text wins. Saves therefore run one
  // at a time, and edits made while one is in flight merge into a single
  // follow-up save of the newest content.
  const saveQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const pendingPatchRef = useRef<Record<string, any>>({});
  const pendingExtraRef = useRef<Record<string, any>>({});
  const saveContent = useCallback(
    (patch: Record<string, any>, extra: Record<string, any> = {}) => {
      Object.assign(pendingPatchRef.current, patch);
      Object.assign(pendingExtraRef.current, extra);
      const run = async () => {
        const p = pendingPatchRef.current;
        const e = pendingExtraRef.current;
        if (!Object.keys(p).length && !Object.keys(e).length) return; // merged into an earlier run
        pendingPatchRef.current = {};
        pendingExtraRef.current = {};
        try {
          await updateBlock.mutateAsync({ ...e, content: p });
        } catch (error) {
          // Keep what failed so the next save carries it (newer edits win).
          pendingPatchRef.current = { ...p, ...pendingPatchRef.current };
          pendingExtraRef.current = { ...e, ...pendingExtraRef.current };
          throw error;
        }
      };
      const next = saveQueueRef.current.then(run, run);
      saveQueueRef.current = next.catch(() => undefined);
      return next;
    },
    [updateBlock]
  );



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

  // Extract image URL from TipTap JSON content (for SimpleEditor)
  const extractFirstImageUrlFromJson = useCallback((content: any) => {
    try {
      if (!content || typeof content !== 'object') return "";
      
      // Check if content has the TipTap structure
      if (content.type === 'doc' && Array.isArray(content.content)) {
        // Find the first image node
        for (const node of content.content) {
          if (node.type === 'image' && node.attrs && node.attrs.src) {
            return node.attrs.src;
          }
          // Check nested content (e.g., in paragraphs)
          if (node.content && Array.isArray(node.content)) {
            for (const childNode of node.content) {
              if (childNode.type === 'image' && childNode.attrs && childNode.attrs.src) {
                return childNode.attrs.src;
              }
            }
          }
        }
      }
      return "";
    } catch (error) {
      console.error('Error extracting image URL from JSON:', error);
      return "";
    }
  }, []);

  const autoSaveContent = useCallback(async (content: any) => {
    // Compare the actual content, not stringified versions
    if (content === lastSavedContentRef.current) {
      return;
    }

    // Extract image URL from JSON content (SimpleEditor doesn't provide editor instance)
    const currentImageUrl = extractFirstImageUrlFromJson(content) || firstImageUrl;

    try {
      await saveContent({
        text: content,
        image: {
          type: "image",
          content: currentImageUrl,
        },
      });
      lastSavedContentRef.current = content;

      if (currentImageUrl !== firstImageUrl) {
        setFirstImageUrl(currentImageUrl);
      }

      toast.success("Content saved", { id: "content-saved" });
    } catch (error) {
      toast.error("Error saving content", { id: "content-save-error" });
      console.error(error);
    }
  }, [saveContent, firstImageUrl, extractFirstImageUrlFromJson]);

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
      // Extract image URL from JSON content (SimpleEditor doesn't provide editor instance)
      const currentImageUrl = extractFirstImageUrlFromJson(data.content.text) || firstImageUrl;

      await saveContent(
        {
          text: data.content.text,
          layout: "full" as const,
          image: {
            type: "image",
            content: currentImageUrl,
          },
        },
        {
          name: block.name,
          type: "MainContent" as const,
          settings: {
            alignment: "left" as const,
          },
          order: block.order || 0,
        }
      );

      if (currentImageUrl !== firstImageUrl) {
        setFirstImageUrl(currentImageUrl);
      }

      lastSavedContentRef.current = data.content.text;

      form.reset(data);

      toast.success("Content updated successfully");
      if (onSuccess) {
        onSuccess();
      }
    } catch (error) {
      toast.error("Error updating content");
    }
  });



  const saveEmail = useCallback(
    async ({ json, html }: EmailComposerValue) => {
      await saveContent({
        email_doc: json,
        email_html: html,
        email_updated_at: new Date().toISOString(),
      });
    },
    [saveContent]
  );

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
          <div className="flex items-center gap-4">
            <Text size="large" weight="plus">Edit Blog Content</Text>
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "website" | "email")}>
              <Tabs.List>
                <Tabs.Trigger value="website">Website</Tabs.Trigger>
                <Tabs.Trigger value="email">Email</Tabs.Trigger>
              </Tabs.List>
            </Tabs>
          </div>
          <div className={activeTab === "website" ? "flex items-center gap-2" : "hidden"}>
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
          {/* Both stay mounted so switching tabs never drops unsaved editor state. */}
          <div className={activeTab === "email" ? "flex-1 h-full overflow-hidden" : "hidden"}>
            <EmailComposer
              initialContent={block.content?.email_doc ?? null}
              blogDoc={editorContent}
              campaign={page?.slug}
              onSave={saveEmail}
            />
          </div>
          <div className={activeTab === "website" ? "flex-1 h-full overflow-y-auto" : "hidden"}>
            {/* <TextEditor
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
            /> */}
            <SimpleEditor
              editorContent={editorContent}
              setEditorContent={handleEditorChange}
              outputFormat="json"
              showAiWrite
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

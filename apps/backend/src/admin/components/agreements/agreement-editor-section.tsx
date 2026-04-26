import { Text, Button } from "@medusajs/ui";
import { useState, useCallback, useRef, useEffect } from 'react';
import { SimpleEditor } from "../editor/editor";
import { AdminAgreement, useUpdateAgreement } from "../../hooks/api/agreement";
import { useParams } from "react-router-dom";
import { toast } from "@medusajs/ui";
import { RouteFocusModal } from "../modal/route-focus-modal";

interface AgreementEditorSectionProps {
  agreement: AdminAgreement
}

// Reusable AgreementTextEditor component extracted from content-step.tsx
export function AgreementTextEditor({
  editorContent: initialEditorContent,
  setEditorContent: onSetEditorContent,
  debounceTime = 300,

}: {
  editorContent: string;
  setEditorContent: (content: string) => void;
  onEditorReady?: (editor: any) => void;
  debounceTime?: number;

}) {
  const debounceTimeoutRef = useRef<NodeJS.Timeout>();

  // Handle content changes with debouncing and convert to HTML
  const handleContentChange = useCallback((content: string) => {
    // Clear any existing timeout
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }
    
    // Set a new timeout
    debounceTimeoutRef.current = setTimeout(() => {
      // Ensure we're passing HTML string, not JSON
      onSetEditorContent(content);
    }, debounceTime);
  }, [onSetEditorContent, debounceTime]);

  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);

  return (
    
      <SimpleEditor // Fix SimpleEditor usage
        editorContent={initialEditorContent}
        setEditorContent={handleContentChange}
        outputFormat="html"
      />
  );
}

export function AgreementEditorSection({ 
  agreement
}: AgreementEditorSectionProps) {
  const [content, setContent] = useState(agreement.content || "");
  const [isSaving, setIsSaving] = useState(false);
  const { id } = useParams<{ id: string }>();

  const updateAgreement = useUpdateAgreement(agreement.id || id!);

  const handleSave = useCallback(async () => {
    if (!content.trim()) {
      toast.error("Content cannot be empty");
      return;
    }

    setIsSaving(true);
    try {
      await updateAgreement.mutateAsync({
        content,
      });
      
      toast.success("Agreement content updated successfully");
    } catch (error) {
      console.error("Error updating agreement:", error);
      toast.error("Failed to update agreement content");
    } finally {
      setIsSaving(false);
    }
  }, [content, updateAgreement]);

  const handleCancel = useCallback(() => {
    setContent(agreement.content || "");
  }, [agreement.content]);

  return (
    <RouteFocusModal>
      <RouteFocusModal.Header>
        <div className="flex items-center justify-between w-full">
          <div>
            <Text size="small" className="text-ui-fg-subtle">
              {agreement.title}
            </Text>
          </div>
        </div>
      </RouteFocusModal.Header>
      
      <RouteFocusModal.Body className="size-full overflow-hidden">
        <div className="flex size-full flex-col overflow-hidden">
          <div className="size-full overflow-y-auto p-1">
            <AgreementTextEditor
              editorContent={content}
              setEditorContent={setContent}
              debounceTime={500}
            />
          </div>
        </div>
      </RouteFocusModal.Body>
      
      <RouteFocusModal.Footer>
        <div className="flex items-center justify-end gap-x-2">
          <Button
            variant="secondary"
            size="small"
            onClick={handleCancel}
            disabled={isSaving}
          >
            Reset
          </Button>
          <Button
            variant="primary"
            size="small"
            onClick={handleSave}
            isLoading={isSaving}
            disabled={content === agreement.content}
          >
            Save Changes
          </Button>
        </div>
      </RouteFocusModal.Footer>
    </RouteFocusModal>
  );
}

// Hook for using the agreement editor in other components
export function useAgreementEditor() {
  const [isEditing, setIsEditing] = useState(false);
  
  return {
    isEditing,
    setIsEditing,
  };
}
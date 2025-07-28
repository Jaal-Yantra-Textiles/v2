// designs-notes-section.tsx
import { useState, useCallback } from 'react';
import { RouteFocusModal } from "../modal/route-focus-modal";
import { Button } from "@medusajs/ui";
import { SimpleEditor } from "../editor/editor";
import { useUpdateDesign } from "../../hooks/api/designs";

interface DesignNotesProps {
  designId: string;
  initialNotes?: string;
  onChange?: (notes: string) => void;
}

export function DesignNotesSection({ designId, initialNotes = "", onChange }: DesignNotesProps) {
  const [notes, setNotes] = useState(initialNotes || `<p>Add your design notes here...</p><p>Include details about materials, colors, patterns, and any special instructions.</p><p></p>`);
  const [hasChanges, setHasChanges] = useState(false);
  const { mutateAsync: updateDesign, isPending: isSaving } = useUpdateDesign(designId);

  const handleNotesChange = useCallback((content: string) => {
    setNotes(content);
    setHasChanges(content !== initialNotes);
    onChange?.(content);
  }, [initialNotes, onChange]);

  const handleSave = useCallback(async () => {
    try {
      await updateDesign({ designer_notes: notes });
      setHasChanges(false);
    } catch (error) {
      console.error('Error saving design notes:', error);
    }
  }, [notes, updateDesign]);

  return (
    <RouteFocusModal>
      <RouteFocusModal.Header>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Design Notes</h2>
            <p className="text-sm text-ui-fg-subtle">Add detailed notes about this design.</p>
          </div>
        </div>
      </RouteFocusModal.Header>
      <RouteFocusModal.Body>
        <div className="p-6">
          <SimpleEditor 
            editorContent={notes}
            setEditorContent={handleNotesChange}
            outputFormat="html"
          />
        </div>
      </RouteFocusModal.Body>
      <RouteFocusModal.Footer>
        <div className="flex items-center justify-end gap-x-2">
          <RouteFocusModal.Close asChild>
            <Button size="small" variant="secondary">
              Close
            </Button>
          </RouteFocusModal.Close>
          <Button
            size="small"
            variant="primary"
            onClick={handleSave}
            disabled={!hasChanges || isSaving}
          >
            {isSaving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </RouteFocusModal.Footer>
    </RouteFocusModal>
  );
}
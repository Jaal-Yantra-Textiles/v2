import { useState, useCallback } from "react";
import { Button } from "@medusajs/ui";
import { RouteFocusModal } from "../modal/route-focus-modal";
import { SimpleEditor } from "../editor/editor";

interface PersonNotesProps {
  initialNotes?: string;
  onSave?: (notes: string) => void;
}

export const PersonNotes = ({ initialNotes = "", onSave }: PersonNotesProps) => {
  const [notes, setNotes] = useState(initialNotes || `<p>Welcome to this notes section!</p><p>Start writing extra notes needed for your work.</p><p></p>`);
  const [hasChanges, setHasChanges] = useState(false);

  const handleNotesChange = useCallback((content: string) => {
    setNotes(content);
    setHasChanges(content !== initialNotes);
  }, [initialNotes]);

  const handleSave = useCallback(() => {
    if (onSave) {
      onSave(notes);
    }
    setHasChanges(false);
  }, [notes, onSave]);

  return (
    <RouteFocusModal>
      <RouteFocusModal.Header>
      </RouteFocusModal.Header>
      <RouteFocusModal.Body>
        
          <SimpleEditor 
            editorContent={notes}
            setEditorContent={handleNotesChange}
            outputFormat="html"
          />
        
      </RouteFocusModal.Body>
      <RouteFocusModal.Footer>
        <div className="flex items-center justify-end gap-x-2">
          <RouteFocusModal.Close asChild>
            <Button size="small" variant="secondary">
              Cancel
            </Button>
          </RouteFocusModal.Close>
          <Button
            size="small"
            variant="primary"
            onClick={handleSave}
            disabled={!hasChanges}
          >
            Save
          </Button>
        </div>
      </RouteFocusModal.Footer>
    </RouteFocusModal>
  );
};

export default PersonNotes;
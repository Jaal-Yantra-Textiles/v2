// designs-notes-section.tsx
import { useState, useCallback, useEffect } from 'react';
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
  const { mutateAsync: updateDesign, isPending: isSaving } = useUpdateDesign(designId);

  // Baseline string from API and current notes string (we always save a string)
  const [baseline, setBaseline] = useState<string>(initialNotes || "");
  const [notesString, setNotesString] = useState<string>(initialNotes || "");
  const [hasChanges, setHasChanges] = useState(false);

  const handleNotesChange = useCallback((content: any | string) => {
    const nextString = typeof content === 'string' ? content : (() => {
      try { return JSON.stringify(content); } catch { return String(content); }
    })();
    setNotesString(nextString);
    setHasChanges(nextString !== baseline);
    onChange?.(nextString);
  }, [baseline, onChange]);

  const handleSave = useCallback(async () => {
    try {
      await updateDesign({ designer_notes: notesString });
      setHasChanges(false);
      setBaseline(notesString);
    } catch (error) {
      console.error('Error saving design notes:', error);
    }
  }, [notesString, updateDesign]);

  // When API value changes (prop change), reset editor and baseline
  useEffect(() => {
    setBaseline(initialNotes || "");
    setNotesString(initialNotes || "");
    setHasChanges(false);
  }, [initialNotes]);

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
            key={`${designId}:${baseline.length}`}
            editorContent={notesString}
            setEditorContent={handleNotesChange}
            // Force JSON output so we always persist JSON
            outputFormat={"json"}
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
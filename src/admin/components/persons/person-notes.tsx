import { Button } from "@medusajs/ui";
import "@blocknote/core/fonts/inter.css";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import { RouteFocusModal } from "../modal/route-focus-modal";
import "@blocknote/shadcn/style.css";

export const PersonNotes = () => {
  const editor = useCreateBlockNote({
    initialContent: [
      {
        type: "paragraph",
        content: "Welcome to this notes section!",
      },
      {
        type: "paragraph",
        content: "Start writing extra notes need for your work",
      },
      {
        type: "paragraph",
        content: "Toggle light/dark mode in the page footer and see the theme change too",
      },
      {
        type: "paragraph",
      },
    ],
  });

  return (
    <RouteFocusModal>
      <RouteFocusModal.Header />
      <RouteFocusModal.Body>
        <div 
          className="[&_.bn-container]:bg-white dark:[&_.bn-container]:bg-gray-900" 
          style={{ 
            "--bn-colors-menu-background": "#9b0000",
            "--bn-colors-menu-text": "#ffffff",
          } as React.CSSProperties}
        >
          <BlockNoteView
            editor={editor}
            className="py-6 px-4"
          />
        </div>
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
            type="submit"
          >
            Save
          </Button>
        </div>
      </RouteFocusModal.Footer>
    </RouteFocusModal>
  );
};

export default PersonNotes;
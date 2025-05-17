import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css"; 
import { Route, useNavigate, useParams } from "react-router-dom";
import { useDesign } from "../../hooks/api/designs";
import { RouteNonFocusModal } from "../modal/route-non-focus";
import { useMoodboard } from "../../hooks/use-moodboard";
import { Button } from "@medusajs/ui";

export function DesignMoodboardSection() {
  const { id } = useParams<{ id: string }>();
  if (!id) return null;
  
  const { design } = useDesign(id, { fields: ["moodboard"] });
  const navigate = useNavigate();
  
  // Function to close the modal
  const onClose = () => {
    // Use window.history.back() to navigate back
    navigate(-1);
  };
  
  const {
    isSaving,
    hasChanges,
    excalidrawAPIRef,
    handleSave,
    handleCloseSave,
    handleExcalidrawChange,
    saveExcalidrawState
  } = useMoodboard({
    designId: id,
    onClose
  });

  return (
    <RouteNonFocusModal>
      <RouteNonFocusModal.Header>
        <div className="flex items-center justify-end w-full">
          <div className="flex items-end justify-end gap-x-2">
            <Button
              variant="secondary"
              size="base"
              onClick={handleSave}
              disabled={isSaving || !hasChanges}
            >
              {isSaving ? "Saving..." : hasChanges ? "Save Changes" : "No Changes"}
            </Button>
          </div>
          <RouteNonFocusModal.Close onClick={handleCloseSave} />
        </div>
      </RouteNonFocusModal.Header>
      <RouteNonFocusModal.Body>
        <div 
          className="relative h-[700px]" 
        >
          <Excalidraw
            excalidrawAPI={api => {
              excalidrawAPIRef.current = api;
              
              // Restore files if they exist
              const savedFiles = (design?.moodboard as any)?.files;
              if (savedFiles && Object.keys(savedFiles).length > 0) {
                // Create a simplified version of the files to restore
                const filesToRestore = Object.entries(savedFiles).map(([id, file]: [string, any]) => {  
                  const dataURL = file.dataURL && file.dataURL.startsWith('http') ? file.dataURL : null;
                  
                  return {
                    id,
                    dataURL: dataURL || 'placeholder', // Placeholder to avoid errors, will be replaced
                    mimeType: file.mimeType || 'image/png',
                    created: file.created || Date.now(),
                    lastRetrieved: Date.now()
                  };
                });
                
                // Add a small delay to ensure Excalidraw is fully initialized
                setTimeout(() => {
                  api.addFiles(filesToRestore as any);
                  
                  // Force a re-render to make sure elements reference the files correctly
                  const currentElements = api.getSceneElements();
                  const currentAppState = api.getAppState();
                  
                  // Update the scene with the restored files
                  api.updateScene({
                    elements: currentElements,
                    appState: currentAppState,
                  });
                }, 100);
              }
            }}
            initialData={{
              type: "excalidraw",
              version: 2,
              source: "https://excalidraw.com",
              elements: (design?.moodboard as any)?.elements ?? [],
              appState: {
                ...(design?.moodboard as any)?.appState,
                collaborators: new Map(),
              },
              files: (design?.moodboard as any)?.files ?? {}
            }}
            onChange={handleExcalidrawChange}
            UIOptions={{
              canvasActions: {
                // Disable elements that may conflict with modal
                loadScene: true,
                export: { saveFileToDisk: true },
              },
            }}
            detectScroll={true}
            autoFocus={true}
          />
        </div>
      </RouteNonFocusModal.Body>
    </RouteNonFocusModal>
  );
}
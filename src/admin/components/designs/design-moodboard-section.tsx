import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { useState } from "react";
import { Route, useNavigate, useParams } from "react-router-dom";
import { useDesign } from "../../hooks/api/designs";
import { RouteNonFocusModal } from "../modal/route-non-focus";
import { useMoodboard } from "../../hooks/use-moodboard";
import { Button } from "@medusajs/ui";
import { FashionPanel } from "./fashion-panel";

export function DesignMoodboardSection() {
  const { id } = useParams<{ id: string }>();
  if (!id) return null;
  
  const { design } = useDesign(id, { fields: ["moodboard"] });
  const navigate = useNavigate();
  
  // Function to close the modal
  const onClose = () => {
    console.log('Closing')
    navigate(-1);
  };
  
  const [fashionPanelOpen, setFashionPanelOpen] = useState(false);

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

  function getCanvasCenter() {
    const api = excalidrawAPIRef.current;
    if (!api) return { x: 0, y: 0 };
    const appState = api.getAppState();
    const { scrollX, scrollY, zoom, width, height } = appState as any;
    const zoomValue = typeof zoom === "object" ? zoom.value : zoom;
    return {
      x: (width / 2 - scrollX) / zoomValue,
      y: (height / 2 - scrollY) / zoomValue,
    };
  }

  return (
    <RouteNonFocusModal>
      <RouteNonFocusModal.Header onClick={handleCloseSave}>
        <div className="flex items-center justify-end w-full">
          <div className="flex items-end justify-end gap-x-2">
            <Button
              variant="primary"
              size="base"
              onClick={(e) => {
                e.stopPropagation();
                handleSave();
              }}
              disabled={isSaving || !hasChanges}
            >
              {isSaving ? "Saving..." : hasChanges ? "Save Changes" : "No Changes"}
            </Button>
          </div>
        </div>
      </RouteNonFocusModal.Header>
      <RouteNonFocusModal.Body>
        <div className="relative h-[700px]">
          {fashionPanelOpen && (
            <div className="absolute top-14 right-2 z-50 w-72">
              <FashionPanel
                excalidrawAPI={excalidrawAPIRef.current}
                getCanvasCenter={getCanvasCenter}
                onClose={() => setFashionPanelOpen(false)}
              />
            </div>
          )}
          <Excalidraw
            excalidrawAPI={api => {
              excalidrawAPIRef.current = api;
              
              // Restore files if they exist
              const savedFiles = (design?.moodboard as any)?.files;
              if (savedFiles && Object.keys(savedFiles).length > 0) {
                // Create a simplified version of the files to restore
                const filesToRestore = Object.entries(savedFiles).map(([id, file]: [string, any]) => {
                  const raw = file.dataURL ?? ''
                  // Accept http(s) remote URLs and inline data: URIs (SVG, PNG, etc.)
                  const dataURL = raw.startsWith('http') || raw.startsWith('data:') ? raw : null;

                  return {
                    id,
                    dataURL: dataURL || 'placeholder',
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
            renderTopRightUI={() => (
              <button
                className="rounded px-3 py-1 text-sm font-medium bg-ui-bg-subtle border border-ui-border-base hover:bg-ui-bg-base"
                onClick={() => setFashionPanelOpen(v => !v)}
                title="Fashion Library"
              >
                Fashion Library
              </button>
            )}
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
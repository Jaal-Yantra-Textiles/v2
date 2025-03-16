import { Excalidraw } from "@excalidraw/excalidraw";
import { RouteFocusModal } from "../modal/route-focus-modal";
import "@excalidraw/excalidraw/index.css"; 
import { useCallback } from "react";
export function DesignMoodboardSection() {

  const handleExcalidrawChange = useCallback(() => {
    // Prevent modal state reset
  }, []);
    
  return (
    <RouteFocusModal>
        <RouteFocusModal.Header></RouteFocusModal.Header>
      <RouteFocusModal.Body>
      <div 
          className="relative h-[700px]" 
        >
          <Excalidraw
            UIOptions={{
              canvasActions: {
                // Disable elements that may conflict with modal
                loadScene: true,
                saveToActiveFile: true,
                export: { saveFileToDisk: true },
                toggleTheme: true,
              },
            }}
            onChange={handleExcalidrawChange}
            detectScroll={true}
            autoFocus={true}
          />
        </div>
      </RouteFocusModal.Body>
    </RouteFocusModal>
  );
}
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@medusajs/ui";
import { useUpdateDesign, useDesign } from "./api/designs";
import { useMoodboardFiles } from "./use-moodboard-files";
import { isEqual } from "lodash";


// In this code some how the on close by escape does not get triggered so for now
// we are leaving like this

export const useMoodboard = ({ 
  designId, 
  onClose
}: {
  designId: string;
  onClose?: () => void;
}) => {
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const { mutate: updateDesign } = useUpdateDesign(designId);
  const { design } = useDesign(designId, { fields: ["moodboard"] });

  const originalStateRef = useRef<any>(null);
  const didInitializeRef = useRef(false);
  
  const saveExcalidrawStateRef = useRef<() => Promise<void>>(() => Promise.resolve());
  
  const {
    fileUrlMappingRef,
    excalidrawAPIRef,
    processImageElements,
    handleExcalidrawChange
  } = useMoodboardFiles(() => saveExcalidrawStateRef.current());
  
  // Store the original state when it's first loaded
  useEffect(() => {
    if (design?.moodboard && !originalStateRef.current) {
      originalStateRef.current = design.moodboard;
      setHasChanges(false);
    }
  }, [design]);

  const handleChange = useCallback(
    (elements: readonly any[], appState: any, files: any) => {
      handleExcalidrawChange(elements, appState, files);

      // Excalidraw fires onChange on initial mount. Ignore that.
      if (!didInitializeRef.current) {
        didInitializeRef.current = true;
        return;
      }

      // Mark as dirty on any subsequent change. This matches the previous UX where
      // Save is enabled after edits. (We still do a deeper comparison during save.)
      setHasChanges(true);
    },
    [handleExcalidrawChange]
  );

  const saveExcalidrawState = useCallback(async () => {
    setIsSaving(true);
    try {
      const api = excalidrawAPIRef.current;
      if (!api) {
        throw new Error('Excalidraw API not initialized');
      }
      
      const elements = api.getSceneElements();
      const appState = api.getAppState();
      const files = api.getFiles();
      
      const cleanAppState = {
        viewBackgroundColor: appState.viewBackgroundColor,
        gridSize: appState.gridSize,
        theme: appState.theme,
        zoom: appState.zoom
      };
      
      const { formattedFiles, pendingUploads } = await processImageElements(elements, files, api);
      
      if (pendingUploads.length > 0) {
        await Promise.all(pendingUploads);
      }
      
      const imageElements = elements.filter((el: any) => el.type === 'image');
      if (Object.keys(formattedFiles).length === 0 && imageElements.length > 0) {
        imageElements.forEach((el: any) => {
          if (el.fileId && el.status === 'saved' && el.url?.startsWith('http')) {
            formattedFiles[el.fileId] = {
              id: el.fileId,
              mimeType: el.mimeType || 'image/png',
              dataURL: el.url,
              created: Date.now(),
              lastRetrieved: Date.now()
            };
          }
        });
      }
      
      const processedElements = elements.map((el: any) => {
        if (el.type === 'image' && el.fileId && fileUrlMappingRef.current[el.fileId]) {
          return {
            ...el,
            status: 'saved',
            url: fileUrlMappingRef.current[el.fileId]
          };
        }
        return el;
      });
      
      const processedFiles = { ...formattedFiles };
      Object.entries(fileUrlMappingRef.current).forEach(([fileId, url]) => {
        processedFiles[fileId] = processedFiles[fileId] || {
          id: fileId,
          dataURL: url,
          mimeType: 'image/png',
          created: Date.now(),
          lastRetrieved: Date.now()
        };
      });
      
      const excalidrawData = {
        type: "excalidraw",
        version: 2,
        source: "https://excalidraw.com",
        elements: processedElements,
        appState: cleanAppState,
        files: processedFiles
      };
      
      // Check if there are changes compared to the original state
      if (originalStateRef.current) {
        const hasStateChanged = !isEqual(
          JSON.stringify(excalidrawData, (key, value) => {
            // Ignore certain fields that might change but don't affect the actual content
            if (key === 'lastRetrieved' || key === 'created') return undefined;
            return value;
          }),
          JSON.stringify(originalStateRef.current, (key, value) => {
            if (key === 'lastRetrieved' || key === 'created') return undefined;
            return value;
          })
        );
        console.log('Has changes:', hasStateChanged);
        setHasChanges(hasStateChanged);
      }
      
      await new Promise<void>((resolve, reject) => {
        updateDesign(
          { moodboard: excalidrawData },
          {
            onSuccess: () => resolve(),
            onError: (error) => reject(error)
          }
        );
      });
      
    } catch (error) {
      console.error("Error in saveExcalidrawState:", error);
      throw error;
    } finally {
      setIsSaving(false);
    }
  }, [updateDesign, processImageElements, fileUrlMappingRef, excalidrawAPIRef]);
  
  // Update the save ref when the save function changes
  useEffect(() => {
    saveExcalidrawStateRef.current = saveExcalidrawState;
  }, [saveExcalidrawState]);
  
  const handleSave = useCallback(() => {
    setIsSaving(true);
    toast.loading("Saving moodboard...");
    
    saveExcalidrawState()
      .then(() => {
        toast.dismiss();
        toast.success("Moodboard saved successfully");
      })
      .catch(err => {
        console.error('Error saving moodboard:', err);
        toast.dismiss();
        toast.error("Failed to save moodboard");
      })
      .finally(() => {
        setIsSaving(false);
      });
  }, [saveExcalidrawState]);
  
  const handleCloseSave = useCallback(() => {
    // Check if we need to save (if there are changes)
    if (!hasChanges) {
      // No changes, just close without saving
      onClose?.();
      return;
    }
    
    setIsSaving(true);
    saveExcalidrawState()
      .then(() => {
        toast.success("Moodboard saved successfully");
        onClose?.();
      })
      .catch(() => {
        toast.error("Failed to save moodboard");
        onClose?.();
      })
      .finally(() => {
        setIsSaving(false);
      });
  }, [saveExcalidrawState, onClose, hasChanges]);
  
  useEffect(() => {
    const interval = setInterval(() => {
      saveExcalidrawState().catch(console.error);
    }, 30000);
    
      return () => {
      if (interval) clearInterval(interval);
    };
  }, [saveExcalidrawState]);
  
  return {
    isSaving,
    hasChanges,
    excalidrawAPIRef,
    handleSave,
    handleCloseSave,
    handleExcalidrawChange: handleChange,
    saveExcalidrawState
  };
};
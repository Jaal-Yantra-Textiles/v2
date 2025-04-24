import { Excalidraw } from "@excalidraw/excalidraw";
import type { BinaryFiles, BinaryFileData } from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css"; 
import { useCallback, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { useDesign, useUpdateDesign } from "../../hooks/api/designs";
import { useFileUpload } from "../../hooks/api/upload";
import { RouteNonFocusModal } from "../modal/route-non-focus";

function base64toBlob(dataURL: string, mime: string): Blob {
  try {
    // Handle data URLs by extracting the base64 part
    const base64String = dataURL.includes('base64,')
      ? dataURL.split('base64,')[1]
      : dataURL;
      
    const binary = atob(base64String);
    const array = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      array[i] = binary.charCodeAt(i);
    }
    return new Blob([array], { type: mime });
  } catch (error) {
    console.error('Error converting base64 to blob:', error);
    // Return an empty blob as fallback
    return new Blob([], { type: mime });
  }
}

export function DesignMoodboardSection() {
  const { id } = useParams<{ id: string }>();
  if (!id) return null;
  const { design } = useDesign(id, { fields: ["moodboard"] });
  const { mutate: updateDesign } = useUpdateDesign(id);
  const { mutate: uploadFile } = useFileUpload();
  
  // Function to close the modal
  const onClose = () => {
    // Use window.history.back() to navigate back
    window.history.back();
  };

  // Track which files have been processed to avoid duplicate uploads
  const processedFiles = useRef<Record<string, boolean>>({});
  
  // Track file ID to URL mapping for more reliable file handling
  const fileUrlMappingRef = useRef<Record<string, string>>({});
  const excalidrawAPIRef = useRef<any>(null);
  const autoSaveRef = useRef<NodeJS.Timeout | null>(null);
  
  // Helper function to check if a file has been processed
  const isFileProcessed = useCallback((fileId: string): boolean => {
    return processedFiles.current[fileId] === true;
  }, []);
  
  // Helper function to process image elements and upload files if needed
  const processImageElements = useCallback(async (elements: any[], files: any, api: any) => {
    // Format files according to Excalidraw's JSON schema
    const formattedFiles: Record<string, any> = {};
    const pendingUploads: Promise<void>[] = [];
    
    // Filter image elements
    const imageElements = elements.filter((el: any) => el.type === 'image');
    console.log('Image elements before processing:', imageElements.length, imageElements);
    
    // Process each image element
    for (const el of imageElements) {
      if (el.status !== 'saved' && el.fileId) {
        // Check if this element has a fileId but no corresponding file in the files object
        const fileExists = files[el.fileId];
        const needsUpload = !fileExists || 
          (fileExists && fileExists.dataURL && !fileExists.dataURL.startsWith('http'));
        
        // Check if this file needs to be processed and hasn't been processed yet
        if (needsUpload && !isFileProcessed(el.fileId)) {
          console.log(`Found image element with fileId ${el.fileId} that needs upload`);
          
          // Get the file data either from the files object or from the element itself
          const fileData = fileExists || { dataURL: el.src, mimeType: el.mimeType || 'image/png' };
          
          // Upload the file
          const uploadPromise = new Promise<void>((resolve) => {
            try {
              // Extract MIME type from the data URL
              const mimeMatch = fileData.dataURL.match(/^data:([\w\/+]+);/); 
              const mimeType = mimeMatch ? mimeMatch[1] : fileData.mimeType || 'image/png';
              
              // Convert base64 to Blob
              const blob = base64toBlob(fileData.dataURL, mimeType);

              const fileName = `excalidraw-${el.fileId}`;
              const fileObj = new File([blob], fileName, { type: mimeType });
              
              // Upload the file using the callback pattern
              uploadFile(
                { files: [fileObj] },
                {
                  onSuccess: (response) => {
                    const uploadedUrl = response.files[0].url;
                    console.log(`Element file ${el.fileId} uploaded successfully:`, uploadedUrl);
                    
                    // Store in our URL mapping
                    fileUrlMappingRef.current[el.fileId] = uploadedUrl;
                    console.log('Updated URL mapping:', fileUrlMappingRef.current);
                    
                    // Add to formatted files with the remote URL
                    formattedFiles[el.fileId] = {
                      id: el.fileId,
                      mimeType: mimeType,
                      dataURL: uploadedUrl,
                      created: Date.now(),
                      lastRetrieved: Date.now()
                    };
                    
                    // Mark as processed
                    processedFiles.current[el.fileId] = true;
                    
                    // Update the element to use the new URL
                    el.status = 'saved';
                    el.url = uploadedUrl;
                    
                    // Update the file in Excalidraw
                    const fileToAdd = { 
                      id: el.fileId, 
                      mimeType: mimeType, 
                      dataURL: uploadedUrl, 
                      created: Date.now(),
                      lastRetrieved: Date.now()
                    } as any;
                    
                    api.addFiles([fileToAdd]);
                    resolve();
                  },
                  onError: (error) => {
                    console.error(`Error uploading element file ${el.fileId}:`, error);
                    resolve();
                  }
                }
              );
            } catch (error) {
              console.error(`Error processing element file ${el.fileId}:`, error);
              resolve();
            }
          });
          
          pendingUploads.push(uploadPromise);
        } else if (el.status === 'saved' && el.url && el.url.startsWith('http')) {
          // Element already has a saved URL, add it to formatted files
          formattedFiles[el.fileId] = {
            id: el.fileId,
            mimeType: el.mimeType || 'image/png',
            dataURL: el.url,
            created: Date.now(),
            lastRetrieved: Date.now()
          };
          console.log(`Added element with saved URL ${el.url} to formattedFiles`);
        }
      }
    }
    
    // Return the formatted files and pending uploads
    return { formattedFiles, pendingUploads };
  }, [uploadFile]);

  // Save the current state of the Excalidraw canvas
  const saveExcalidrawState = useCallback(async () => {
    const api = excalidrawAPIRef.current;
    if (!api) return;
    
    // Get current state from Excalidraw
    const elements = api.getSceneElements();
    const appState = api.getAppState();
    const files = api.getFiles();
    console.log('Files from Excalidraw:', files, Object.keys(files).length);
    
    // Only save necessary properties to avoid storing excessive data
    const cleanAppState = {
      viewBackgroundColor: appState.viewBackgroundColor,
      gridSize: appState.gridSize,
      theme: appState.theme,
      // Add other necessary properties but keep it minimal
      zoom: appState.zoom
    };
    
    // Process image elements and upload files if needed
    const { formattedFiles, pendingUploads } = await processImageElements(elements, files, api);
    
    // Now check files from the API
    for (const [id, fileData] of Object.entries(files)) {
      const file = fileData as BinaryFileData;
      console.log(`Checking file ${id}:`, file);
      // Only include files that are referenced by elements
      const referencingElements = elements.filter((el: any) => 
        el.type === 'image' && el.fileId === id
      );
      
      if (referencingElements.length > 0) {
        console.log(`File ${id} is referenced by ${referencingElements.length} elements`);
        // If the dataURL is a base64 string (not a remote URL), upload it first
        if (file.dataURL && !file.dataURL.startsWith('http')) {
          // Check if we've already processed this file
          if (!isFileProcessed(id)) {
            console.log(`Uploading base64 file ${id} during save`);
            const uploadPromise = new Promise<void>(async (resolve) => {
              try {
                // Extract MIME type from the data URL
                const mimeMatch = file.dataURL.match(/^data:([\w\/+]+);/); 
                const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
                
                // Convert base64 to Blob
                const blob = base64toBlob(file.dataURL, mimeType);

                const fileName = `excalidraw-${id}`;
               const fileObj = new File([blob], fileName, { type: mimeType });
                
                // Upload the file

                uploadFile(
                  { files: [fileObj] },
                  {
                    onSuccess: (response) => {
                        const uploadedUrl = response.files[0].url;
                        
                        console.log(`File ${id} uploaded successfully:`, uploadedUrl);
                        
                        // Store in our URL mapping
                        fileUrlMappingRef.current[id] = uploadedUrl;
                        console.log('Updated URL mapping:', fileUrlMappingRef.current);
                        
                        // Add to formatted files with the remote URL
                        formattedFiles[id] = {
                          id: id,
                          mimeType: file.mimeType,
                          dataURL: uploadedUrl,
                          created: file.created || Date.now(),
                          lastRetrieved: Date.now()
                        };
                        
                        // Mark as processed
                        processedFiles.current[id] = true;
                        
                        // Update the element to use the new URL
                        referencingElements.forEach((el: any) => {
                          el.status = 'saved';
                          el.url = uploadedUrl;
                        });
                        resolve();
                    },
                    onError: (error) => {
                      console.error(`Error uploading file ${id}:`, error);
                      resolve();
                    }
                  }
                );
              } catch (error) {
                console.error(`Error uploading file ${id}:`, error);
              }
              resolve();
            });
            
            pendingUploads.push(uploadPromise);
          }
        } else if (file.dataURL && file.dataURL.startsWith('http')) {
          // If it's already a remote URL, just add it to formatted files
          formattedFiles[id] = {
            id: id,
            mimeType: file.mimeType,
            dataURL: file.dataURL,
            created: file.created || Date.now(),
            lastRetrieved: Date.now()
          };
          console.log(`Added remote URL file ${id} to formattedFiles`);
        }
      } else {
        console.log(`File ${id} is not referenced by any elements`);
      }
    }
    
    // Wait for all pending uploads to complete
    if (pendingUploads.length > 0) {
      console.log(`Waiting for ${pendingUploads.length} file uploads to complete`);
      await Promise.all(pendingUploads);
      console.log('All file uploads completed');
    }
    
    // Debug the formatted files
    console.log('Formatted files after processing:', formattedFiles, Object.keys(formattedFiles).length);
    
    // If we have image elements but no formatted files, something went wrong
    const imageElements = elements.filter((el: any) => el.type === 'image');
    if (Object.keys(formattedFiles).length === 0 && imageElements.length > 0) {
      console.warn('Warning: We have image elements but no formatted files!');
      
      // Last attempt to extract files from elements
      imageElements.forEach((el: any) => {
        if (el.fileId && el.status === 'saved' && el.url && el.url.startsWith('http')) {
          console.log(`Last chance: Adding element with URL ${el.url} to formattedFiles`);
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
    
    console.log("Saving moodboard with elements:", elements.length, "and files:", Object.keys(formattedFiles).length);
    console.log("Final formatted files:", formattedFiles);
    
    // Process elements to ensure they have the correct URLs
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
    
    // Process files to ensure they have the correct URLs
    const processedFiles = { ...formattedFiles };
    Object.entries(fileUrlMappingRef.current).forEach(([fileId, url]) => {
      if (processedFiles[fileId]) {
        processedFiles[fileId] = {
          ...processedFiles[fileId],
          dataURL: url
        };
      } else {
        // Create a new file entry if it doesn't exist
        processedFiles[fileId] = {
          id: fileId,
          dataURL: url,
          mimeType: 'image/png', // Default, you might want to store this in your mapping too
          created: Date.now(),
          lastRetrieved: Date.now()
        };
      }
    });
    
    console.log('Processed files before save:', processedFiles);
    console.log('URL mapping before save:', fileUrlMappingRef.current);
    
    // Create a complete Excalidraw-compatible JSON structure
    const excalidrawData = {
      type: "excalidraw",
      version: 2,
      source: "https://excalidraw.com",
      elements: processedElements,
      appState: cleanAppState,
      files: processedFiles
    };
    
    console.log("Final excalidraw data structure:", JSON.stringify(excalidrawData).substring(0, 200) + '...');
    
    return new Promise<void>((resolve, reject) => {
      updateDesign(
        { 
          moodboard: excalidrawData
        },
        {
          onSuccess: () => {
            console.log("Moodboard saved successfully");
            resolve();
          },
          onError: (error) => {
            console.error("Error saving moodboard:", error);
            reject(error);
          }
        }
      );
    });
  }, [updateDesign]);

  const handleExcalidrawChange = useCallback(
    (
      elements: readonly any[],
      appState: any,
      files: BinaryFiles = {}
    ) => {
      // Only handle file uploads here

      console.log('Files received:', files);
      Object.entries(files).forEach(([fileKey, fileData]) => {
        if (!processedFiles.current[fileKey]) {
          try {
            processedFiles.current[fileKey] = true;
            const { dataURL, mimeType } = fileData as BinaryFileData;
            
            // Skip processing if dataURL is already a URL (not base64)
            if (dataURL.startsWith('http')) {
              console.log('File already has a URL, skipping upload:', fileKey);
              return;
            }
            
            // Find elements that reference this file
            const referencingElements = elements.filter(
              (el: any) => el.type === 'image' && el.fileId === fileKey
            );
            
            if (referencingElements.length === 0) {
              console.log(`File ${fileKey} not referenced by any elements, skipping upload`);
              return;
            }
            
            console.log(`Processing file ${fileKey} with type ${mimeType}, referenced by ${referencingElements.length} elements`);
            const blob = base64toBlob(dataURL, mimeType);
            const file = new File([blob], fileKey, { type: mimeType });
            
            uploadFile(
              { files: [file] },
              {
                onSuccess: (response) => {
                    const uploadedUrl = response.files[0].url;
                    console.log('File uploaded successfully:', uploadedUrl);
                    
                    // Store in our URL mapping
                    fileUrlMappingRef.current[fileKey] = uploadedUrl;
                    console.log('Updated URL mapping:', fileUrlMappingRef.current);
                  
                    // Update the file in Excalidraw with the remote URL
                    // Format according to Excalidraw's expected structure
                    const fileToAdd = { 
                      id: fileKey, 
                      mimeType, 
                      dataURL: uploadedUrl, 
                      created: Date.now(),
                      lastRetrieved: Date.now()
                    } as any;
                    
                    console.log('Adding file to Excalidraw:', fileToAdd);
                    const files = excalidrawAPIRef.current?.addFiles([fileToAdd]);
                    console.log('Files after adding:', files);
                  
                    // Force a re-render with the current state
                    const currentElements = excalidrawAPIRef.current?.getSceneElements() || [];
                    const currentAppState = excalidrawAPIRef.current?.getAppState() || {};
                    
                    // Store the uploaded URL in our tracking map for future reference
                    // This helps avoid re-uploading the same file
                    processedFiles.current[fileKey] = true;
                    
                    // Trigger a save after file upload completes
                    saveExcalidrawState().catch(err => {
                      console.error('Error saving after file upload:', err);
                    });
                },
                onError: (error) => {
                  console.error('Error uploading file:', error);
                  // Remove from processed files so we can try again
                  delete processedFiles.current[fileKey];
                }
              }
            );
          } catch (error) {
            console.error(`Error processing file ${fileKey}:`, error);
            delete processedFiles.current[fileKey];
          }
        }
      });
    },
    [uploadFile, saveExcalidrawState]
  );

  // Handle closing the modal and save the moodboard
  const handleCloseSave = useCallback(() => {
    saveExcalidrawState()
      .then(() => {
        if (onClose) onClose();
      })
      .catch(err => {
        console.error('Error saving before close:', err);
        if (onClose) onClose(); // Close anyway even if save fails
      });
  }, [saveExcalidrawState, onClose]);

  // Set up auto-save functionality
  useEffect(() => {
    const saveInterval = setInterval(() => {
      console.log('Auto-saving moodboard...');
      saveExcalidrawState().catch(err => {
        console.error('Error during auto-save:', err);
      });
    }, 30000); // Save every 30 seconds
    
    // Clean up on unmount
    return () => {
      clearInterval(saveInterval);
      if (autoSaveRef.current) {
        clearTimeout(autoSaveRef.current);
      }
    };
  }, [saveExcalidrawState]);

  return (
    <RouteNonFocusModal>
      <RouteNonFocusModal.Header>
        <RouteNonFocusModal.Close onClick={handleCloseSave} />
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
                console.log('Restoring files:', Object.keys(savedFiles).length, savedFiles);
                
                // First, restore our URL mapping
                Object.entries(savedFiles).forEach(([id, file]: [string, any]) => {
                  if (file.dataURL && file.dataURL.startsWith('http')) {
                    fileUrlMappingRef.current[id] = file.dataURL;
                    console.log(`Restored URL mapping for file ${id}:`, file.dataURL);
                  }
                });
                
                console.log('Restored URL mapping:', fileUrlMappingRef.current);
                
                const filesToRestore = Object.entries(savedFiles).map(([id, file]: [string, any]) => {  
                  // Mark this file as already processed so we don't try to upload it again
                  processedFiles.current[id] = true;
                  
                  // Ensure we have a valid dataURL that's a remote URL, not base64
                  const dataURL = fileUrlMappingRef.current[id] || 
                    (file.dataURL && file.dataURL.startsWith('http') ? file.dataURL : null);
                    
                  if (!dataURL) {
                    console.warn(`File ${id} has invalid dataURL, will need to be re-uploaded`);
                    processedFiles.current[id] = false; // Allow re-upload
                  }
                  
                  return {
                    id,
                    dataURL: dataURL || 'placeholder', // Placeholder to avoid errors, will be replaced
                    mimeType: file.mimeType || 'image/png',
                    created: file.created || Date.now(),
                    lastRetrieved: Date.now() // Update the last retrieved time
                  };
                });
                
                // Add a small delay to ensure Excalidraw is fully initialized
                setTimeout(() => {
                  console.log('Adding restored files to Excalidraw:', filesToRestore);
                  api.addFiles(filesToRestore as any);
                  
                  // Force a re-render to make sure elements reference the files correctly
                  const currentElements = api.getSceneElements();
                  const currentAppState = api.getAppState();
                  
                  // Log the current state
                  console.log('Current elements before update:', currentElements.length);
                  console.log('Current files before update:', api.getFiles());
                  
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
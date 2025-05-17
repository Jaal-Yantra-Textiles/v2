import { useCallback, useRef } from "react";
import { useFileUpload } from "./api/upload";
import { BinaryFileData, BinaryFiles } from "@excalidraw/excalidraw/types";

// Helper function to convert base64 to Blob
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
    return new Blob([], { type: mime });
  }
}

export interface UseMoodboardFilesReturn {
  processedFiles: React.MutableRefObject<Record<string, boolean>>;
  fileUrlMappingRef: React.MutableRefObject<Record<string, string>>;
  excalidrawAPIRef: React.MutableRefObject<any>;
  prevElementsCountRef: React.MutableRefObject<number>;
  isFileProcessed: (fileId: string) => boolean;
  processImageElements: (elements: any[], files: any, api: any) => Promise<{ 
    formattedFiles: Record<string, any>, 
    pendingUploads: Promise<void>[] 
  }>;
  handleExcalidrawChange: (elements: readonly any[], appState: any, files: BinaryFiles) => void;
}

export const useMoodboardFiles = (saveCallback: () => Promise<void>): UseMoodboardFilesReturn => {
  const { mutate: uploadFile } = useFileUpload();
  
  // Track which files have been processed to avoid duplicate uploads
  const processedFiles = useRef<Record<string, boolean>>({});
  
  // Track file ID to URL mapping for more reliable file handling
  const fileUrlMappingRef = useRef<Record<string, string>>({});
  
  // Keep track of previous elements count to detect additions
  const prevElementsCountRef = useRef<number>(0);
  
  // Reference to the Excalidraw API
  const excalidrawAPIRef = useRef<any>(null);
  
  // Helper function to check if a file has been processed
  const isFileProcessed = useCallback((fileId: string): boolean => {
    return processedFiles.current[fileId] === true;
  }, []);
  
  // Process image elements and upload files if needed
  const processImageElements = useCallback(async (elements: any[], files: any, api: any) => {
    const formattedFiles: Record<string, any> = {};
    const pendingUploads: Promise<void>[] = [];
    
    // Filter image elements
    const imageElements = elements.filter((el: any) => el.type === 'image');
    
    // Process each image element
    for (const el of imageElements) {
      if (el.status !== 'saved' && el.fileId) {
        const fileExists = files[el.fileId];
        const needsUpload = !fileExists || 
          (fileExists && fileExists.dataURL && !fileExists.dataURL.startsWith('http'));
        
        if (needsUpload && !isFileProcessed(el.fileId)) {
          const fileData = fileExists || { dataURL: el.src, mimeType: el.mimeType || 'image/png' };
          
          const uploadPromise = new Promise<void>((resolve) => {
            try {
              const mimeMatch = fileData.dataURL.match(/^data:([\w\/+]+);/); 
              const mimeType = mimeMatch ? mimeMatch[1] : fileData.mimeType || 'image/png';
              
              const blob = base64toBlob(fileData.dataURL, mimeType);
              const fileName = `excalidraw-${el.fileId}`;
              const fileObj = new File([blob], fileName, { type: mimeType });
              
              uploadFile(
                { files: [fileObj] },
                {
                  onSuccess: (response) => {
                    const uploadedUrl = response.files[0].url;
                    fileUrlMappingRef.current[el.fileId] = uploadedUrl;
                    
                    formattedFiles[el.fileId] = {
                      id: el.fileId,
                      mimeType: mimeType,
                      dataURL: uploadedUrl,
                      created: Date.now(),
                      lastRetrieved: Date.now()
                    };
                    
                    processedFiles.current[el.fileId] = true;
                    el.status = 'saved';
                    el.url = uploadedUrl;
                    
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
          formattedFiles[el.fileId] = {
            id: el.fileId,
            mimeType: el.mimeType || 'image/png',
            dataURL: el.url,
            created: Date.now(),
            lastRetrieved: Date.now()
          };
        }
      }
    }
    
    return { formattedFiles, pendingUploads };
  }, [uploadFile, isFileProcessed]);
  
  // Handle changes in the Excalidraw component
  const handleExcalidrawChange = useCallback((
    elements: readonly any[],
    appState: any,
    files: BinaryFiles = {}
  ) => {
    const currentElementsCount = elements.length;
    const previousElementsCount = prevElementsCountRef.current;
    prevElementsCountRef.current = currentElementsCount;
    
    if (currentElementsCount > previousElementsCount && previousElementsCount > 0) {
      setTimeout(() => {
        saveCallback().catch(err => {
          console.error('Error saving after elements added:', err);
        });
      }, 500);
    }

    Object.entries(files).forEach(([fileKey, fileData]) => {
      if (!processedFiles.current[fileKey]) {
        try {
          processedFiles.current[fileKey] = true;
          const { dataURL, mimeType } = fileData as BinaryFileData;
          
          if (dataURL.startsWith('http')) {
            return;
          }
          
          const blob = base64toBlob(dataURL, mimeType);
          const file = new File([blob], fileKey, { type: mimeType });
          
          uploadFile(
            { files: [file] },
            {
              onSuccess: (response) => {
                const uploadedUrl = response.files[0].url;
                fileUrlMappingRef.current[fileKey] = uploadedUrl;
                
                const fileToAdd = { 
                  id: fileKey, 
                  mimeType, 
                  dataURL: uploadedUrl, 
                  created: Date.now(),
                  lastRetrieved: Date.now()
                } as any;
                
                excalidrawAPIRef.current?.addFiles([fileToAdd]);
                saveCallback().catch(console.error);
              },
              onError: (error) => {
                console.error('Error uploading file:', error);
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
  }, [uploadFile, saveCallback]);
  
  return {
    processedFiles,
    fileUrlMappingRef,
    excalidrawAPIRef,
    prevElementsCountRef,
    processImageElements,
    handleExcalidrawChange,
    isFileProcessed
  };
};
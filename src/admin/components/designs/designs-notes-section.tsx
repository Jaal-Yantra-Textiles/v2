// designs-notes-section.tsx
import { useRef, useEffect, useState } from 'react';
import EditorJS, { OutputData } from '@editorjs/editorjs';
import { RouteFocusModal } from "../modal/route-focus-modal";
import { Button, Skeleton } from "@medusajs/ui";
import './app.scss'
import { useUpdateDesign } from "../../hooks/api/designs";
// Import EditorJS tools
import List from '@editorjs/list';
import Header from '@editorjs/header';

// Configure EditorJS tools with proper typing
const EDITOR_JS_TOOLS = {
  header: {
    class: Header,
    config: {
      levels: [1, 2, 3, 4, 5, 6],
      defaultLevel: 3
    }
  },
  list: {
    class: List,
    inlineToolbar: true
  }
} as any;

// Default initial data
const DEFAULT_INITIAL_DATA = {
  time: new Date().getTime(),
  blocks: []
};

interface DesignNotesProps {
  designId: string;
  data?: OutputData;
  onChange?: (data: OutputData) => void;
}

export function DesignNotesSection({ designId, data, onChange }: DesignNotesProps) {
  // Create references
  const editorRef = useRef<EditorJS | null>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const isInitialized = useRef(false);
  const [isLoading, setIsLoading] = useState(true);
  const { mutateAsync: updateDesign, isPending: isSaving } = useUpdateDesign(designId);

  // Initialize editor when component mounts
  useEffect(() => {
    console.log('useEffect running, initialized:', isInitialized.current);
    
    // Prevent multiple initializations
    // if (isInitialized.current || !editorContainerRef.current) {
    //   return;
    // }
    
    // Add a small delay to ensure the DOM is fully rendered
    const initTimer = setTimeout(() => {
      // Set initialization flag
      isInitialized.current = true;
      console.log('Initializing editor for the first time');
      
      try {
        // Create editor instance
        const editor = new EditorJS({
          holder: 'editorjs',  // Use the ID instead of the ref
          tools: EDITOR_JS_TOOLS,
          autofocus: true,
          placeholder: 'Start taking design notes...',
          data: data || DEFAULT_INITIAL_DATA,
          onChange: async () => {
            if (!editor) return;
            
            try {
              console.log('Editor content changed');
              const content = await editor.saver.save();
              console.log('Editor content saved:', content);
              
              // Save to the design
              const stringifiedContent = JSON.stringify(content);
              await updateDesign({ designer_notes: stringifiedContent });
              
              // Call the onChange prop if provided
              onChange?.(content);
            } catch (error) {
              console.error('Error saving editor content:', error);
            }
          }
        });
        
        // Use the isReady promise to check when the editor is fully initialized
        editor.isReady
          .then(() => {
            console.log('Editor.js is ready to work!');
            // Check available blocks
            console.log('Editor initialized successfully');
            setIsLoading(false);
          })
          .catch((reason) => {
            console.log(`Editor.js initialization failed because of ${reason}`);
            setIsLoading(false); // Stop loading even if there's an error
          });
        
        // Store in ref for access in cleanup
        editorRef.current = editor;
      } catch (error) {
        console.error('Error initializing editor:', error);
        isInitialized.current = false; // Reset flag if initialization fails
        setIsLoading(false); // Stop loading state even if there's an error
      }
    }, 100); // Small delay to ensure DOM is ready
    
    // Cleanup function - only runs when component is actually unmounted
    return () => {
      console.log('Component actually unmounting');
      clearTimeout(initTimer); // Clear the timer if component unmounts before initialization
      
      if (editorRef.current) {
        try {
          console.log('Destroying editor instance');
          editorRef.current.destroy();
          editorRef.current = null;
          isInitialized.current = false;
        } catch (error) {
          console.error('Error during editor cleanup:', error);
        }
      }
    };
  }, []); // Empty dependency array to ensure it only runs once

  return (
    <RouteFocusModal>
      <RouteFocusModal.Header>
        <RouteFocusModal.Title>Design Notes</RouteFocusModal.Title>
      </RouteFocusModal.Header>
      <RouteFocusModal.Description/>
        
      <RouteFocusModal.Body className="z-50">
        <div className="px-6 py-4">
          <div className="relative min-h-[300px] z-50">
            {isLoading && (
              <div className="absolute inset-0 z-10 p-4 bg-white">
                <Skeleton className="w-full h-8 mb-4" />
                <Skeleton className="w-3/4 h-4 mb-2" />
                <Skeleton className="w-full h-4 mb-2" />
                <Skeleton className="w-1/2 h-4 mb-2" />
                <Skeleton className="w-4/5 h-4 mb-2" />
                <Skeleton className="w-2/3 h-4 mb-2" />
              </div>
            )}
            <div 
              id="editorjs"
              ref={editorContainerRef}
              className="p-4 rounded-lg min-h-[300px]"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      </RouteFocusModal.Body>
      <RouteFocusModal.Footer>
        <div className="">
          <RouteFocusModal.Close asChild>
            <Button 
              variant="primary"
              isLoading={isSaving}
              disabled={isSaving}
            >
              {isSaving ? 'Saving...' : 'Save & Close'}
            </Button>
          </RouteFocusModal.Close>
        </div>
      </RouteFocusModal.Footer>
    </RouteFocusModal>
  );
}
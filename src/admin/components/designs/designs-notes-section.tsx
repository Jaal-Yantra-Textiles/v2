// designs-notes-section.tsx
import { useRef, useEffect } from 'react';
import EditorJS, { OutputData } from '@editorjs/editorjs';
import { RouteFocusModal } from "../modal/route-focus-modal";

// Import EditorJS tools
import List from '@editorjs/list';
import Header from '@editorjs/header';

// Configure EditorJS tools
const EDITOR_JS_TOOLS = {
  list: List,
  header: Header,
};

// Default initial data
const DEFAULT_INITIAL_DATA = {
  time: new Date().getTime(),
  blocks: [
    {
      type: "paragraph",
      data: { text: "Start taking design notes..." }
    }
  ]
};

interface DesignNotesProps {
  data?: OutputData;
  onChange?: (data: OutputData) => void;
}

export function DesignNotesSection({ data, onChange }: DesignNotesProps) {
  // Create references
  const editorRef = useRef<any>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const isInitialized = useRef(false);

  useEffect(() => {
    console.log('useEffect running, initialized:', isInitialized.current);
    
    // Only initialize once
    if (editorContainerRef.current && !isInitialized.current) {
      console.log('Initializing editor for the first time');
      isInitialized.current = true;
      
      try {
        // Create editor instance
        const editor = new EditorJS({
          holder: editorContainerRef.current,
          tools: EDITOR_JS_TOOLS,
          autofocus: true,
          data: data || DEFAULT_INITIAL_DATA,
          onReady: () => {
            console.log('Editor.js is ready and initialized');
          },
          onChange: async () => {
            try {
              const content = await editor.saver.save();
              console.log('Editor content saved');
              onChange?.(content);
            } catch (error) {
              console.error('Error saving editor content:', error);
            }
          }
        });
        
        // Store in ref for access in cleanup
        editorRef.current = editor;
      } catch (error) {
        console.error('Error initializing editor:', error);
        isInitialized.current = false; // Reset flag if initialization fails
      }
    }
    
    // Cleanup function - only runs when component is actually unmounted
    return () => {
      console.log('Component actually unmounting');
      if (editorRef.current && isInitialized.current) {
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
  }, [data, onChange]); // Removed editorInstance from dependencies

  return (
    <RouteFocusModal>
      <RouteFocusModal.Header>
        <RouteFocusModal.Title>Design Notes</RouteFocusModal.Title>
      </RouteFocusModal.Header>
      <RouteFocusModal.Body>
        <div 
          ref={editorContainerRef}
          className="p-4  rounded-lg min-h-[300px]"
          onClick={(e) => e.stopPropagation()}
        />
      </RouteFocusModal.Body>
    </RouteFocusModal>
  );
}
import { Heading, Text, Toaster } from "@medusajs/ui";
import { Control } from "react-hook-form";
import { Form } from "../../common/form";
import { useCallback, useRef, useEffect } from 'react';
import RichTextEditor from 'reactjs-tiptap-editor';
import { extensions } from "../../common/richtext-editor";

type AgreementFormData = {
  title: string;
  status: string;
  subject: string;
  template_key?: string;
  valid_from?: string;
  valid_until?: string;
  from_email?: string;
  content: string;
};

type ContentStepProps = {
  control: Control<AgreementFormData>;
};

// Custom TextEditor component that outputs HTML instead of JSON
function AgreementTextEditor({
  editorContent: initialEditorContent,
  setEditorContent: onSetEditorContent,
  onEditorReady: onEditorReadyProp,
  debounceTime = 300,
}: {
  editorContent: string;
  setEditorContent: (content: string) => void;
  onEditorReady?: (editor: any) => void;
  debounceTime?: number;
}) {
  const debounceTimeoutRef = useRef<NodeJS.Timeout>();

  const editorCallbackRef = useCallback((editorInstance: any) => {
    const editor = editorInstance?.editor;
    if (onEditorReadyProp && editor) {
      onEditorReadyProp(editor);
    } else if (onEditorReadyProp) {
      onEditorReadyProp(null);
    }
  }, [onEditorReadyProp]);
  
  // Handle content changes with debouncing and convert to HTML
  const handleContentChange = useCallback((content: string) => {
    // Clear any existing timeout
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }
    
    // Set a new timeout
    debounceTimeoutRef.current = setTimeout(() => {
      // Ensure we're passing HTML string, not JSON
      onSetEditorContent(content);
    }, debounceTime);
  }, [onSetEditorContent, debounceTime]);
  
  // Clean up the timeout when component unmounts
  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);
  
  return (
    <>
      <Toaster />
      <div className="relative h-full w-full overflow-y-auto">
        <div className="relative">
          <RichTextEditor 
            output='html'  // Changed from 'json' to 'html'
            content={initialEditorContent} 
            onChangeContent={handleContentChange} 
            extensions={extensions} 
            ref={editorCallbackRef}
            toolbar={{
              render: (_props, _toolbarItems, dom, containerDom) => (
                <div className="richtext-code-block-toolbar">
                  {containerDom(dom)}
                </div>
              )
            }}
          />
        </div>
      </div>
    </>
  );
}

export const AgreementContentStep = ({ control }: ContentStepProps) => {
  return (
    <div className="flex flex-col gap-y-8 p-6">
      <div>
        <Heading level="h2">Agreement Content</Heading>
        <Text className="text-ui-fg-subtle">
          Write the content of your agreement. You can use handlebars variables like {"{{user_name}}"} for dynamic content.
        </Text>
      </div>

      <Form.Field
        control={control}
        name="content"
        render={({ field }) => {
          const handleEditorChange = (content: string | object) => {
            // Convert content to HTML string if it's an object (JSON format)
            let htmlContent: string;
            
            if (typeof content === 'object' && content !== null) {
              // If content is JSON object, we need to extract HTML from the editor
              console.log('Editor content (JSON):', content);
              // For now, convert JSON to string - ideally we'd get HTML from editor instance
              htmlContent = JSON.stringify(content);
            } else {
              // Content is already a string (HTML)
              htmlContent = content as string;
              console.log('Editor content (HTML):', htmlContent);
            }
            
            field.onChange(htmlContent);
          };

          const handleEditorReady = (editor: any) => {
            if (editor) {
              console.log('Editor ready, can extract HTML:', editor.getHTML?.());
              // If we have an editor instance, we can extract HTML directly
              const htmlContent = editor.getHTML?.();
              if (htmlContent && typeof htmlContent === 'string') {
                field.onChange(htmlContent);
              }
            }
          };

          return (
            <Form.Item>
              <Form.Label>Content</Form.Label>
              <Form.Control>
                <div className="border border-ui-border-base rounded-lg overflow-hidden">
                  <div 
                    className="[&_.bn-container]:bg-white dark:[&_.bn-container]:bg-gray-900 [&_.bn-container]:min-h-[400px]" 
                    style={{ 
                      "--bn-colors-menu-background": "#f8f9fa",
                      "--bn-colors-menu-text": "#1f2937",
                    } as React.CSSProperties}
                  >
                    <AgreementTextEditor 
                      editorContent={field.value || ''} 
                      setEditorContent={handleEditorChange}
                      onEditorReady={handleEditorReady}
                    />
                  </div>
                </div>
              </Form.Control>
              <Form.ErrorMessage />
              <Text size="small" className="text-ui-fg-subtle mt-2">
                Use handlebars syntax for variables: {"{{user_name}}, {{company_name}}, {{date}}, etc."}
              </Text>
            </Form.Item>
          );
        }}
      />
    </div>
  );
};

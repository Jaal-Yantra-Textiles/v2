//@ts-ignore
import { Heading, Text } from "@medusajs/ui";
import { Control } from "react-hook-form";
import { Form } from "../../common/form";
import "@blocknote/core/fonts/inter.css";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import "@blocknote/shadcn/style.css";
import { useEffect } from "react";

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

export const AgreementContentStep = ({ control }: ContentStepProps) => {
  const editor = useCreateBlockNote({
    initialContent: [
      {
        type: "paragraph",
        content: "Start writing your agreement content here...",
      },
      {
        type: "paragraph",
        content: "You can use handlebars variables like " + "{{user_name}}, {{company_name}}, etc.",
      },
      {
        type: "paragraph",
        content: "",
      },
    ],
  });

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
          // Sync BlockNote content with form field
          useEffect(() => {
            const updateContent = async () => {
              const htmlContent = await editor.blocksToHTMLLossy(editor.document);
              field.onChange(htmlContent);
            };

            // Listen for changes in the editor
            const unsubscribe = editor.onChange(() => {
              updateContent();
            });

            return unsubscribe;
          }, [editor, field]);

          // Initialize editor with existing content if any
          useEffect(() => {
            if (field.value && field.value !== "") {
              try {
                // If we have existing content, try to parse it
                editor.tryParseHTMLToBlocks(field.value).then((blocks) => {
                  editor.replaceBlocks(editor.document, blocks);
                });
              } catch (error) {
                console.warn("Could not parse existing content:", error);
              }
            }
          }, []);

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
                    <BlockNoteView
                      editor={editor}
                      theme="light"
                      className="min-h-[400px]"
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

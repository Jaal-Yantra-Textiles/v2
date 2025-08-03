import { Heading, Input, Text, Textarea, Badge } from "@medusajs/ui";
import { Control, useFieldArray } from "react-hook-form";
import {  XMark } from "@medusajs/icons";
import { VariablesModal } from "./variables-modal";
import { Form } from "../../common/form";

interface Variable {
  name: string;
  description: string;
}

interface Variable {
  name: string;
  description: string;
}

interface ContentStepProps {
  control: Control<any>;
  variables: Variable[];
  onInsertVariable: (variableName: string) => void;
}
export const ContentStep = ({ control, variables, onInsertVariable }: ContentStepProps) => {
  const { fields, append, remove } = useFieldArray({
    control,
    name: "variables",
    keyName: "id"
  });

  const handleRemoveVariable = (variableName: string) => {
    const index = fields.findIndex(field => (field as any).key === variableName);
    if (index !== -1) {
      remove(index);
    }
  };

  const handleInsertVariable = (variableName: string) => {
    onInsertVariable(variableName);
  };

  const handleVariablesChange = (newVariables: Array<{name: string, defaultValue: string}>) => {
    console.log('ContentStep handleVariablesChange called with:', newVariables);
    // Clear existing variables
    remove();
    
    // Add new variables with their default values
    newVariables.forEach(variable => {
      console.log('Adding variable:', variable);
      append({ key: variable.name, value: variable.defaultValue });
    });
    // Note: fields will not update immediately due to React async state updates
    // The fields array will be updated on the next render
  };

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex-1 h-full overflow-y-auto">
        <div className="flex flex-col gap-y-6 p-6">
          <div>
            <Heading level="h2">Email Content</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              Create the subject and HTML content for your email template
            </Text>
          </div>

          <div className="grid gap-y-6">
            <Form.Field
              control={control}
              name="subject"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label>Subject Line</Form.Label>
                  <Form.Control>
                    <Input {...field} placeholder="Welcome to {'{'}{'{'} company_name {'}'}{'}'}!" />
                  </Form.Control>
                  <Form.ErrorMessage />
                  <Form.Hint>Use {'{'}{'{'} variable_name {'}'}{'}'}  for dynamic content</Form.Hint>
                </Form.Item>
              )}
            />

            <div className="grid grid-cols-4 gap-4">
              <div className="col-span-3 space-y-4">
                <Form.Field
                  control={control}
                  name="html_content"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>HTML Content</Form.Label>
                      <Form.Control>
                        <Textarea 
                          {...field} 
                          placeholder="<h1>Welcome {'{'}{'{'} user_name {'}'}{'}'} !</h1><p>Thank you for joining {'{'}{'{'} company_name {'}'}{'}'} ...</p>"
                          rows={12}
                          className="font-mono text-sm"
                        />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />
                
                {/* Selected Variables Badges */}
                {fields.length > 0 && (
                  <div>
                    <Text size="small" weight="plus" className="mb-2 block">Selected Variables</Text>
                    <div className="flex flex-wrap gap-2">
                      {fields.map((field) => (
                        <div key={field.id} className="relative">
                          <Badge
                            size="small"
                            className="cursor-pointer pr-6"
                            onClick={() => handleInsertVariable((field as any).key)}
                          >
                            {(field as any).key}
                          </Badge>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveVariable((field as any).key);
                            }}
                            className="absolute -top-2 -right-1 bg-white rounded-full p-1 shadow-sm border border-ui-border-base text-ui-fg-subtle hover:text-ui-fg-error hover:border-ui-fg-error transition-all"
                          >
                            <XMark />
                          </button>
                        </div>
                      ))}
                    </div>
                    <Text size="xsmall" className="text-ui-fg-subtle mt-1">
                      Click a badge to insert the variable into your content
                    </Text>
                  </div>
                )}
              </div>

              <div className="col-span-1 space-y-4">
                <VariablesModal
                  control={control}
                  predefinedVariables={variables}
                  selectedVariables={fields.map(field => (field as any).key)}
                  onVariablesChange={handleVariablesChange}
                  onInsertVariable={handleInsertVariable}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

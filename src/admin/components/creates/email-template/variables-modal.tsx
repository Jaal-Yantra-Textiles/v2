import { Button, Badge, Input, Text, Switch } from "@medusajs/ui";
import { Plus, Trash, X } from "@medusajs/icons";
import { useState } from "react";
import { Control, useFieldArray } from "react-hook-form";
import { StackedFocusModal } from "../../modal/stacked-modal/stacked-focused-modal";
import { Form } from "../../common/form";

interface Variable {
  name: string;
  description: string;
}

interface VariablesModalProps {
  control: Control<any>;
  predefinedVariables: Variable[];
  selectedVariables: string[];
  onVariablesChange: (variables: string[]) => void;
  onInsertVariable: (variableName: string) => void;
}

export const VariablesModal = ({
  control,
  predefinedVariables,
  selectedVariables,
  onVariablesChange,
  onInsertVariable
}: VariablesModalProps) => {
  const [useCustomVariables, setUseCustomVariables] = useState(false);
  const [localSelectedVariables, setLocalSelectedVariables] = useState<string[]>(selectedVariables);

  const { fields, append, remove } = useFieldArray({
    control,
    name: "variables"
  });

  const addCustomVariable = () => {
    append({ key: "", value: "" });
  };

  const handleVariableToggle = (variableName: string) => {
    const newSelection = localSelectedVariables.includes(variableName)
      ? localSelectedVariables.filter(v => v !== variableName)
      : [...localSelectedVariables, variableName];
    setLocalSelectedVariables(newSelection);
  };

  const handleSave = () => {
    // Get custom variables that have both key and value
    const customVars = fields
      .map((field, index) => {
        const key = control._getWatch(`variables.${index}.key`);
        const value = control._getWatch(`variables.${index}.value`);
        return key && value ? key : null;
      })
      .filter(Boolean) as string[];

    // Combine predefined and custom variables
    const allAvailableVariables = [
      ...predefinedVariables.map(v => v.name),
      ...customVars
    ];

    // Filter selected variables to only include available ones
    const validSelectedVariables = localSelectedVariables.filter(v => 
      allAvailableVariables.includes(v)
    );

    onVariablesChange(validSelectedVariables);
  };

  const handleInsertAndClose = (variableName: string) => {
    onInsertVariable(variableName);
    // Don't close modal, just insert the variable
  };

  return (
    <StackedFocusModal id="variables-modal">
      <StackedFocusModal.Trigger asChild>
        <Button
          variant="secondary"
          size="small"
          onClick={() => setLocalSelectedVariables(selectedVariables)}
        >
          <Plus className="w-4 h-4" />
          Manage Variables
        </Button>
      </StackedFocusModal.Trigger>
      
      <StackedFocusModal.Content className="flex flex-col max-w-full">
        <StackedFocusModal.Header>
          <StackedFocusModal.Title>Manage Email Variables</StackedFocusModal.Title>
          <StackedFocusModal.Description>
            Select predefined variables or create custom ones for your email template
          </StackedFocusModal.Description>
        </StackedFocusModal.Header>
        
        <StackedFocusModal.Body className="flex-1 overflow-y-auto">
          <div className="space-y-6 p-6">
            {/* Variable Type Switch */}
            <div className="flex items-center justify-between p-4 bg-ui-bg-subtle rounded-lg">
              <div>
                <Text weight="plus" size="small">Variable Type</Text>
                <Text size="small" className="text-ui-fg-subtle">
                  {useCustomVariables ? 'Create and manage custom variables' : 'Select from predefined system variables'}
                </Text>
              </div>
              <div className="flex items-center gap-2">
                <Text size="small" className={!useCustomVariables ? 'text-ui-fg-base' : 'text-ui-fg-subtle'}>
                  Predefined
                </Text>
                <Switch
                  checked={useCustomVariables}
                  onCheckedChange={setUseCustomVariables}
                />
                <Text size="small" className={useCustomVariables ? 'text-ui-fg-base' : 'text-ui-fg-subtle'}>
                  Custom
                </Text>
              </div>
            </div>

            {useCustomVariables ? (
              /* Custom Variables Section */
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Text weight="plus">Custom Variables</Text>
                  <Button
                    type="button"
                    variant="secondary"
                    size="small"
                    onClick={addCustomVariable}
                  >
                    <Plus className="w-4 h-4" />
                    Add Variable
                  </Button>
                </div>
                
                <div className="grid gap-4">
                  {fields.map((field, index) => (
                    <div key={field.id} className="p-4 border rounded-lg">
                      <div className="flex items-center justify-between mb-3">
                        <Text size="small" weight="plus">Variable {index + 1}</Text>
                        <Button
                          type="button"
                          variant="transparent"
                          size="small"
                          onClick={() => remove(index)}
                        >
                          <Trash className="w-4 h-4 text-ui-fg-error" />
                        </Button>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-3 mb-3">
                        <Form.Field
                          control={control}
                          name={`variables.${index}.key`}
                          render={({ field }) => (
                            <Form.Item>
                              <Form.Label>Variable Key</Form.Label>
                              <Form.Control>
                                <Input 
                                  {...field} 
                                  placeholder="user_name" 
                                  size="small"
                                />
                              </Form.Control>
                              <Form.ErrorMessage />
                            </Form.Item>
                          )}
                        />
                        
                        <Form.Field
                          control={control}
                          name={`variables.${index}.value`}
                          render={({ field }) => (
                            <Form.Item>
                              <Form.Label>Default Value</Form.Label>
                              <Form.Control>
                                <Input 
                                  {...field} 
                                  placeholder="John Doe" 
                                  size="small"
                                />
                              </Form.Control>
                              <Form.ErrorMessage />
                            </Form.Item>
                          )}
                        />
                      </div>
                      
                      {control._getWatch(`variables.${index}.key`) && (
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            variant="secondary"
                            size="small"
                            onClick={() => handleVariableToggle(control._getWatch(`variables.${index}.key`))}
                          >
                            {localSelectedVariables.includes(control._getWatch(`variables.${index}.key`)) ? 'Deselect' : 'Select'}
                          </Button>
                          <Button
                            type="button"
                            variant="transparent"
                            size="small"
                            onClick={() => handleInsertAndClose(control._getWatch(`variables.${index}.key`))}
                          >
                            Insert into Content
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                  
                  {fields.length === 0 && (
                    <div className="text-center py-8 text-ui-fg-subtle">
                      <Text size="small">No custom variables created yet</Text>
                      <Text size="xsmall">Click "Add Variable" to create your first custom variable</Text>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* Predefined Variables Section */
              <div className="space-y-4">
                <Text weight="plus">Predefined Variables</Text>
                <div className="grid gap-3">
                  {predefinedVariables.map((variable) => (
                    <div key={variable.name} className="p-4 border rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Text size="small" weight="plus">{variable.name}</Text>
                          {localSelectedVariables.includes(variable.name) && (
                            <Badge size="small" color="green">Selected</Badge>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            variant="secondary"
                            size="small"
                            onClick={() => handleVariableToggle(variable.name)}
                          >
                            {localSelectedVariables.includes(variable.name) ? 'Deselect' : 'Select'}
                          </Button>
                          <Button
                            type="button"
                            variant="transparent"
                            size="small"
                            onClick={() => handleInsertAndClose(variable.name)}
                          >
                            Insert into Content
                          </Button>
                        </div>
                      </div>
                      <Text size="xsmall" className="text-ui-fg-subtle">
                        {variable.description}
                      </Text>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </StackedFocusModal.Body>
        
        <StackedFocusModal.Footer>
          <div className="flex w-full items-center justify-between">
            <Text size="small" className="text-ui-fg-subtle">
              {localSelectedVariables.length} variable(s) selected
            </Text>
            <div className="flex items-center gap-x-2">
              <StackedFocusModal.Close asChild>
                <Button variant="secondary">Cancel</Button>
              </StackedFocusModal.Close>
              <StackedFocusModal.Close asChild>
                <Button variant="primary" onClick={handleSave}>
                  Save Selection
                </Button>
              </StackedFocusModal.Close>
            </div>
          </div>
        </StackedFocusModal.Footer>
      </StackedFocusModal.Content>
    </StackedFocusModal>
  );
};

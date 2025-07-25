import { Button, Input, Text } from "@medusajs/ui";
import { Plus, Trash } from "@medusajs/icons";
import { Control, useFieldArray } from "react-hook-form";
import { Form } from "../../common/form";

interface CustomVariablePanelProps {
  control: Control<any>;
  onInsertVariable: (variableName: string) => void;
}

export const CustomVariablePanel = ({ control, onInsertVariable }: CustomVariablePanelProps) => {
  const { fields, append, remove } = useFieldArray({
    control,
    name: "variables"
  });

  const addVariable = () => {
    append({ key: "", value: "" });
  };

  return (
    <div className="col-span-1">
      <div className="sticky top-0">
        <div className="flex items-center justify-between mb-3">
          <Text weight="plus" size="small">Custom Variables</Text>
          <Button
            type="button"
            variant="transparent"
            size="small"
            onClick={addVariable}
          >
            <Plus className="w-4 h-4" />
            Add
          </Button>
        </div>
        
        <div className="space-y-3">
          {fields.map((field, index) => (
            <div key={field.id} className="p-3 border rounded-lg">
              <div className="flex items-center justify-between mb-2">
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
              
              <div className="space-y-2">
                <Form.Field
                  control={control}
                  name={`variables.${index}.key`}
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>Key</Form.Label>
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
                
                {control._getWatch(`variables.${index}.key`) && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="small"
                    className="w-full"
                    onClick={() => onInsertVariable(control._getWatch(`variables.${index}.key`))}
                  >
                    Insert Variable
                  </Button>
                )}
              </div>
            </div>
          ))}
          
          {fields.length === 0 && (
            <div className="text-center py-8 text-ui-fg-subtle">
              <Text size="small">No custom variables defined</Text>
              <Text size="xsmall">Click "Add" to create your first variable</Text>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

import { Button, Input, Text, toast } from "@medusajs/ui";
import { Plus, Trash } from "@medusajs/icons";
import { useState, useCallback } from "react";
import { Control, useFieldArray } from "react-hook-form";
import { StackedFocusModal } from "../../modal/stacked-modal/stacked-focused-modal";
import { useStackedModal } from "../../modal/stacked-modal/use-stacked-modal";
import { BulkImportSection } from "./bulk-import-section";
import { PredefinedVariablesSection } from "./predefined-variables-section";

interface Variable {
  name: string;
  description: string;
}

interface VariableObject {
  name: string;
  defaultValue: string;
}

interface VariablesModalProps {
  control: Control<any>;
  predefinedVariables: Variable[];
  selectedVariables: VariableObject[];
  onVariablesChange: (variables: VariableObject[]) => void;
  onInsertVariable: (variableName: string) => void;
}

export const VariablesModal = ({
  control,
  predefinedVariables,
  selectedVariables,
  onVariablesChange,
  onInsertVariable
}: VariablesModalProps) => {
  const [localSelectedVariables, setLocalSelectedVariables] = useState<VariableObject[]>(selectedVariables);
  const [rawVariables, setRawVariables] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);

  const { fields, append, remove } = useFieldArray({
    control,
    name: "variables"
  });



  const handleCopyAllVariables = useCallback(() => {
    const allVariables = [
      ...predefinedVariables.map(v => v.name),
      ...fields.map((_, index) => control._getWatch(`variables.${index}.key`)).filter(Boolean)
    ];
    
    const variablesText = allVariables.map(name => `${name}=`).join('\n');
    navigator.clipboard.writeText(variablesText);
    toast.success("Variables copied to clipboard");
  }, [predefinedVariables, fields, control]);

  const handleAddCustomVariable = useCallback(() => {
    append({ key: "", value: "" });
  }, [append]);

  const handleToggleVariableName = useCallback((variableName: string) => {
    const existingVar = localSelectedVariables.find(v => v.name === variableName);
    const newSelection = existingVar
      ? localSelectedVariables.filter(v => v.name !== variableName)
      : [...localSelectedVariables, { name: variableName, defaultValue: '' }];
    setLocalSelectedVariables(newSelection);
  }, [localSelectedVariables]);

  const { setIsOpen } = useStackedModal();

  const handleSave = useCallback(() => {
    console.log('VariablesModal handleSave called');
    console.log('localSelectedVariables:', localSelectedVariables);
    console.log('fields:', fields);
    console.log('predefinedVariables:', predefinedVariables);
    
    // Get custom variables that have both key and value
    const customVars = fields
      .map((_, index) => {
        const key = control._getWatch(`variables.${index}.key`);
        const value = control._getWatch(`variables.${index}.value`);
        console.log(`Field ${index} key:`, key, 'value:', value);
        if (key) {
          return { name: key, defaultValue: value || '' };
        }
        return null;
      })
      .filter(Boolean) as Array<{name: string, defaultValue: string}>;
    
    console.log('customVars:', customVars);

    // Get predefined variables with their descriptions as default values
    const predefinedVars = localSelectedVariables
      .map(varName => {
        const predefinedVar = predefinedVariables.find(v => v.name === varName);
        return predefinedVar ? { 
          name: predefinedVar.name, 
          defaultValue: predefinedVar.description 
        } : null;
      })
      .filter(Boolean) as Array<{name: string, defaultValue: string}>;

    const validSelectedVariables = [
      ...predefinedVars,
      ...customVars
    ];
    
    console.log('validSelectedVariables being sent:', validSelectedVariables);

    onVariablesChange(validSelectedVariables);
    setIsOpen('variables-modal', false);
  }, [control, fields, localSelectedVariables, predefinedVariables, onVariablesChange, setIsOpen]);

  const handleInsertAndClose = useCallback((variableName: string) => {
    onInsertVariable(variableName);
    setIsOpen('variables-modal', false);
  }, [onInsertVariable, setIsOpen]);

  return (
    <StackedFocusModal id="variables-modal">
      <StackedFocusModal.Trigger asChild>
        <Button
          variant="secondary"
          size="small"
          className="w-full"
        >
          <Plus className="w-4 h-4 mr-2" />
          Manage Variables
        </Button>
      </StackedFocusModal.Trigger>
      <StackedFocusModal.Content>
        <StackedFocusModal.Header>
          <Text size="small" weight="plus">
            Manage Variables
          </Text>
        </StackedFocusModal.Header>

        <StackedFocusModal.Body className="flex flex-col gap-6 max-h-[600px] overflow-y-auto px-6 py-4">
          <BulkImportSection
            rawVariables={rawVariables}
            onRawVariablesChange={setRawVariables}
            onParse={(parsedVars) => {
              parsedVars.forEach(({ key, value }) => {
                append({ key, value });
              });
              setRawVariables("");
              setParseError(null);
            }}
            onCopyAll={handleCopyAllVariables}
            parseError={parseError}
          />

          <PredefinedVariablesSection
            variables={predefinedVariables}
            selectedVariables={localSelectedVariables}
            onToggleVariable={handleToggleVariableName}
            onInsertVariable={handleInsertAndClose}
          />

          {/* Custom Variables */}
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <Text size="small" weight="plus" className="text-ui-fg-base">
                Custom Variables
              </Text>
              <Button
                type="button"
                variant="secondary"
                size="small"
                className="w-full sm:w-auto"
                onClick={handleAddCustomVariable}
              >
                <Plus className="w-4 h-4" />
                Add Variable
              </Button>
            </div>
            <div className="space-y-3">
              {fields.map((field, index) => (
                <div key={field.id} className="flex flex-col sm:flex-row items-start sm:items-center gap-2 p-3 border border-ui-border-base rounded-lg bg-ui-bg-subtle">
                  <Input
                    placeholder="Variable name"
                    {...control.register(`variables.${index}.key`)}
                    className="text-sm flex-1"
                  />
                  <Input
                    placeholder="Default value"
                    {...control.register(`variables.${index}.value`)}
                    className="text-sm flex-1"
                  />
                  <Button
                    type="button"
                    variant="transparent"
                    size="small"
                    className="w-full sm:w-auto text-ui-fg-error hover:text-ui-fg-error-hover"
                    onClick={() => remove(index)}
                  >
                    <Trash className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </StackedFocusModal.Body>

        <StackedFocusModal.Footer>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setLocalSelectedVariables(selectedVariables);
                setRawVariables("");
                setParseError(null);
                setIsOpen('variables-modal', false);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={handleSave}
            >
              Save Variables
            </Button>
          </div>
        </StackedFocusModal.Footer>
      </StackedFocusModal.Content>
    </StackedFocusModal>
  );
};

export default VariablesModal;
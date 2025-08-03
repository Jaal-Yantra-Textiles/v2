import { Button, Text } from "@medusajs/ui";

interface Variable {
  name: string;
  description: string;
}

interface PredefinedVariablesSectionProps {
  variables: Variable[];
  selectedVariables: string[];
  onToggleVariable: (variableName: string) => void;
  onInsertVariable: (variableName: string) => void;
}

export const PredefinedVariablesSection = ({
  variables,
  selectedVariables,
  onToggleVariable,
  onInsertVariable
}: PredefinedVariablesSectionProps) => {
  return (
    <div className="space-y-2">
      <Text size="small" weight="plus">
        Predefined Variables
      </Text>
      <div className="space-y-2">
        {variables.map((variable) => (
          <div
            key={variable.name}
            className="border border-ui-border-base rounded-lg p-4 space-y-3 bg-ui-bg-subtle hover:bg-ui-bg-subtle-hover transition-colors"
          >
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <Text size="small" weight="plus" className="text-ui-fg-base">
                {variable.name}
              </Text>
              <Button
                type="button"
                variant={selectedVariables.includes(variable.name) ? "secondary" : "primary"}
                size="small"
                className="w-full sm:w-auto"
                onClick={() => onToggleVariable(variable.name)}
              >
                {selectedVariables.includes(variable.name) ? 'Deselect' : 'Select'}
              </Button>
            </div>
            <Text size="small" className="text-ui-fg-subtle leading-relaxed">
              {variable.description}
            </Text>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pt-2 border-t border-ui-border-base">
              <Text size="small" className="text-ui-fg-muted font-mono bg-ui-bg-field px-3 py-1.5 rounded-md text-xs sm:text-sm">
                {`{{${variable.name}}}`}
              </Text>
              <Button
                type="button"
                variant="transparent"
                size="small"
                className="text-ui-fg-interactive hover:text-ui-fg-interactive-hover w-full sm:w-auto"
                onClick={() => onInsertVariable(variable.name)}
              >
                Insert into Content
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

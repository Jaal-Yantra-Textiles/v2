import { Button, Text } from "@medusajs/ui";
import { InformationCircleSolid } from "@medusajs/icons";

interface Variable {
  name: string;
  description: string;
}

interface VariablePanelProps {
  variables: Variable[];
  onInsertVariable: (variableName: string) => void;
}

export const VariablePanel = ({ variables, onInsertVariable }: VariablePanelProps) => {
  return (
    <div className="col-span-1">
      <div className="sticky top-0">
        <div className="flex items-center gap-2 mb-3">
          <InformationCircleSolid className="text-ui-fg-muted" />
          <Text weight="plus" size="small">Variables</Text>
        </div>
        <div className="space-y-2">
          {variables.map((variable) => (
            <div key={variable.name} className="p-3 border rounded-lg">
              <div className="flex items-center justify-between mb-1">
                <Text size="small" weight="plus">{variable.name}</Text>
                <Button
                  type="button"
                  variant="transparent"
                  size="small"
                  onClick={() => onInsertVariable(variable.name)}
                >
                  Insert
                </Button>
              </div>
              <Text size="xsmall" className="text-ui-fg-subtle">
                {variable.description}
              </Text>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

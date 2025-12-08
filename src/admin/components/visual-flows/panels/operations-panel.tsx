import { Text, Heading, IconButton } from "@medusajs/ui"
import { XMark } from "@medusajs/icons"
import { OperationDefinition } from "../../../hooks/api/visual-flows"

interface OperationsPanelProps {
  operations: Record<string, OperationDefinition[]>
  onClose: () => void
}

const categoryLabels: Record<string, string> = {
  data: "Data Operations",
  logic: "Logic & Control",
  communication: "Communication",
  integration: "Integrations",
  utility: "Utilities",
}

export function OperationsPanel({ operations, onClose }: OperationsPanelProps) {
  const onDragStart = (event: React.DragEvent, operationType: string) => {
    event.dataTransfer.setData("application/reactflow", operationType)
    event.dataTransfer.effectAllowed = "move"
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <Heading level="h2" className="text-sm">Operations</Heading>
        <IconButton variant="transparent" size="small" onClick={onClose}>
          <XMark />
        </IconButton>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <Text className="text-ui-fg-subtle text-xs">
          Drag operations to the canvas to add them to your flow
        </Text>

        {Object.entries(operations).map(([category, ops]) => (
          <div key={category}>
            <Text weight="plus" className="text-xs text-ui-fg-subtle mb-2 uppercase">
              {categoryLabels[category] || category}
            </Text>
            <div className="space-y-1">
              {ops.map((op) => (
                <div
                  key={op.type}
                  draggable
                  onDragStart={(e) => onDragStart(e, op.type)}
                  className="
                    px-3 py-2 rounded-md border border-ui-border-base bg-ui-bg-base
                    cursor-grab hover:border-ui-border-interactive hover:bg-ui-bg-base-hover
                    transition-colors
                  "
                >
                  <Text weight="plus" className="text-sm">
                    {op.name}
                  </Text>
                  <Text className="text-xs text-ui-fg-subtle">
                    {op.description}
                  </Text>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

import { Container, Heading, Text, Button } from "@medusajs/ui"
import { PencilSquare } from "@medusajs/icons"
import { Link } from "react-router-dom"
import { VisualFlow } from "../../hooks/api/visual-flows"

interface VisualFlowEditorSectionProps {
  flow: VisualFlow
}

export const VisualFlowEditorSection = ({ flow }: VisualFlowEditorSectionProps) => {
  // Get counts from canvas_state if operations array is empty (data stored in canvas_state)
  const canvasNodes = flow.canvas_state?.nodes || []
  const canvasEdges = flow.canvas_state?.edges || []
  
  // Count operations (nodes excluding trigger)
  const operationsCount = flow.operations?.length || canvasNodes.filter((n: any) => n.id !== "trigger").length
  const connectionsCount = flow.connections?.length || canvasEdges.length

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Flow Editor</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Visual workflow editor
          </Text>
        </div>
        <Link to="editor">
          <Button variant="secondary" size="small">
            <PencilSquare className="mr-2" />
            Open Editor
          </Button>
        </Link>
      </div>

      <div className="px-6 py-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-ui-bg-subtle rounded-lg p-4">
            <Text size="small" className="text-ui-fg-subtle">Operations</Text>
            <Text className="text-lg font-semibold">{operationsCount}</Text>
          </div>
          <div className="bg-ui-bg-subtle rounded-lg p-4">
            <Text size="small" className="text-ui-fg-subtle">Connections</Text>
            <Text className="text-lg font-semibold">{connectionsCount}</Text>
          </div>
        </div>

        {operationsCount === 0 && (
          <div className="mt-4 text-center py-8 bg-ui-bg-subtle rounded-lg">
            <Text className="text-ui-fg-subtle">No operations configured yet</Text>
            <Text size="small" className="text-ui-fg-muted">
              Open the editor to add operations to your flow
            </Text>
          </div>
        )}

        {operationsCount > 0 && (
          <div className="mt-4">
            <Text size="small" weight="plus" className="mb-2">Operations</Text>
            <div className="space-y-2">
              {/* Get operations from either operations array or canvas_state nodes */}
              {(flow.operations?.length ? flow.operations : canvasNodes.filter((n: any) => n.id !== "trigger"))
                .slice(0, 5)
                .map((op: any, index: number) => {
                  // Handle both operation format and canvas node format
                  const name = op.name || op.data?.label || op.operation_type || op.data?.operationType
                  const type = op.operation_type || op.data?.operationType
                  return (
                    <div 
                      key={op.id} 
                      className="flex items-center justify-between bg-ui-bg-subtle rounded px-3 py-2"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-ui-fg-muted text-xs">{index + 1}</span>
                        <Text size="small">{name}</Text>
                      </div>
                      <Text size="small" className="text-ui-fg-subtle">
                        {type}
                      </Text>
                    </div>
                  )
                })}
              {operationsCount > 5 && (
                <Text size="small" className="text-ui-fg-muted text-center">
                  +{operationsCount - 5} more operations
                </Text>
              )}
            </div>
          </div>
        )}
      </div>
    </Container>
  )
}

import { useCallback, useState, useRef, useEffect } from "react"
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Edge,
  Node,
  NodeTypes,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import "./flow-editor.css"
import { Button, Text, toast } from "@medusajs/ui"
import { PlusMini } from "@medusajs/icons"
import { VisualFlow, VisualFlowUpdateInput, useOperationDefinitions } from "../../hooks/api/visual-flows"
import { OperationsPanel } from "./panels/operations-panel"
import { PropertiesPanel } from "./panels/properties-panel"
import { TriggerNode } from "./nodes/trigger-node"
import { OperationNode } from "./nodes/operation-node"

// Custom node types
const nodeTypes: NodeTypes = {
  trigger: TriggerNode,
  operation: OperationNode,
}

interface FlowEditorProps {
  flow: VisualFlow
  onUpdate: (data: VisualFlowUpdateInput) => void
}

// Convert flow data to React Flow format
function flowToReactFlow(flow: VisualFlow): { nodes: Node[]; edges: Edge[] } {
  // Check if we have canvas_state with nodes - use that as primary source
  // This handles the case where operations/connections aren't persisted to DB yet
  if (flow.canvas_state?.nodes?.length > 0) {
    const nodes: Node[] = flow.canvas_state.nodes.map((n: any) => ({
      id: n.id,
      type: n.id === "trigger" ? "trigger" : "operation",
      position: n.position,
      data: n.data,
    }))

    const edges: Edge[] = (flow.canvas_state.edges || []).map((e: any) => ({
      id: e.id,
      source: e.source,
      sourceHandle: e.sourceHandle || "default",
      target: e.target,
      targetHandle: e.targetHandle || "default",
      type: "smoothstep",
      animated: true,
      style: { stroke: "#6366f1" },
    }))

    return { nodes, edges }
  }

  // Fallback: build from operations/connections if canvas_state is empty
  const nodes: Node[] = []
  const edges: Edge[] = []

  // Add trigger node
  nodes.push({
    id: "trigger",
    type: "trigger",
    position: { x: 250, y: 50 },
    data: {
      label: "Trigger",
      triggerType: flow.trigger_type,
      triggerConfig: flow.trigger_config,
    },
  })

  // Add operation nodes
  for (const op of flow.operations || []) {
    nodes.push({
      id: op.id,
      type: "operation",
      position: { x: op.position_x, y: op.position_y },
      data: {
        label: op.name || op.operation_type,
        operationType: op.operation_type,
        operationKey: op.operation_key,
        options: op.options,
      },
    })
  }

  // Add edges from connections
  for (const conn of flow.connections || []) {
    edges.push({
      id: conn.id,
      source: conn.source_id,
      sourceHandle: conn.source_handle || "default",
      target: conn.target_id,
      targetHandle: conn.target_handle || "default",
      type: "smoothstep",
      animated: conn.connection_type === "success",
      style: {
        stroke: conn.connection_type === "failure" ? "#ef4444" : "#6366f1",
      },
      label: conn.label || undefined,
    })
  }

  return { nodes, edges }
}

function FlowEditorInner({ flow, onUpdate }: FlowEditorProps) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null)
  const { screenToFlowPosition } = useReactFlow()
  const { data: operationsData } = useOperationDefinitions()
  
  const initialData = flowToReactFlow(flow)
  const [nodes, setNodes, onNodesChange] = useNodesState(initialData.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialData.edges)
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  const [showOperationsPanel, setShowOperationsPanel] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)

  // Track changes
  useEffect(() => {
    setHasChanges(true)
  }, [nodes, edges])

  const onConnect = useCallback(
    (params: Connection) => {
      setEdges((eds) => addEdge({
        ...params,
        type: "smoothstep",
        animated: true,
        style: { stroke: "#6366f1" },
      }, eds))
    },
    [setEdges]
  )

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node)
  }, [])

  const onPaneClick = useCallback(() => {
    setSelectedNode(null)
  }, [])

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = "move"
  }, [])

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()

      const type = event.dataTransfer.getData("application/reactflow")
      if (!type) return

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      })

      const operationDef = operationsData?.operations.find(op => op.type === type)
      const newNodeId = `op_${Date.now()}`
      
      const newNode: Node = {
        id: newNodeId,
        type: "operation",
        position,
        data: {
          label: operationDef?.name || type,
          operationType: type,
          operationKey: `${type}_${Date.now()}`,
          options: operationDef?.defaultOptions || {},
        },
      }

      setNodes((nds) => nds.concat(newNode))
    },
    [screenToFlowPosition, setNodes, operationsData]
  )

  const handleSave = useCallback(() => {
    // Convert React Flow state back to flow format
    const operations = nodes
      .filter(n => n.type === "operation")
      .map((n, index) => ({
        id: n.id.startsWith("op_") ? undefined : n.id,
        operation_key: n.data.operationKey as string,
        operation_type: n.data.operationType as string,
        name: n.data.label as string,
        options: n.data.options || {},
        position_x: Math.round(n.position.x),
        position_y: Math.round(n.position.y),
        sort_order: index,
      }))

    const connections = edges.map(e => ({
      id: e.id.startsWith("reactflow") ? undefined : e.id,
      source_id: e.source,
      source_handle: e.sourceHandle || "default",
      target_id: e.target,
      target_handle: e.targetHandle || "default",
      connection_type: "default" as const,
      label: (e.label as string) || undefined,
    }))

    // Save operations, connections, and canvas state
    onUpdate({
      operations,
      connections,
      canvas_state: {
        nodes: nodes.map(n => ({ id: n.id, position: n.position, data: n.data })),
        edges: edges.map(e => ({ id: e.id, source: e.source, target: e.target })),
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    })

    setHasChanges(false)
    toast.success("Flow saved")
  }, [nodes, edges, onUpdate])

  const handleNodeUpdate = useCallback((nodeId: string, data: any) => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === nodeId) {
          return { ...node, data: { ...node.data, ...data } }
        }
        return node
      })
    )
  }, [setNodes])

  const handleDeleteNode = useCallback((nodeId: string) => {
    if (nodeId === "trigger") {
      toast.error("Cannot delete trigger node")
      return
    }
    setNodes((nds) => nds.filter((node) => node.id !== nodeId))
    setEdges((eds) => eds.filter((edge) => edge.source !== nodeId && edge.target !== nodeId))
    setSelectedNode(null)
  }, [setNodes, setEdges])

  return (
    <div className="flex h-full">
      {/* Operations Panel (Left Sidebar) */}
      {showOperationsPanel && (
        <div className="w-64 border-r bg-ui-bg-subtle overflow-y-auto">
          <OperationsPanel 
            operations={operationsData?.grouped || {}}
            onClose={() => setShowOperationsPanel(false)}
          />
        </div>
      )}

      {/* Main Canvas */}
      <div className="flex-1" ref={reactFlowWrapper}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          onDragOver={onDragOver}
          onDrop={onDrop}
          nodeTypes={nodeTypes}
          fitView
          snapToGrid
          snapGrid={[15, 15]}
        >
          <Background gap={15} size={1} />
          <Controls />
          <MiniMap />
          
          {/* Top Panel */}
          <Panel position="top-left">
            <div className="flex gap-2">
              <Button 
                variant="secondary" 
                size="small"
                onClick={() => setShowOperationsPanel(!showOperationsPanel)}
              >
                <PlusMini className="mr-1" />
                Add Operation
              </Button>
              {hasChanges && (
                <Button size="small" onClick={handleSave}>
                  Save Changes
                </Button>
              )}
            </div>
          </Panel>

          {/* Info Panel */}
          <Panel position="bottom-left">
            <div className="bg-ui-bg-base border rounded-lg px-3 py-2 text-sm">
              <Text className="text-ui-fg-subtle">
                {nodes.length - 1} operations • {edges.length} connections
              </Text>
            </div>
          </Panel>
        </ReactFlow>
      </div>

      {/* Properties Panel (Right Sidebar) */}
      {selectedNode && (
        <div className="w-80 border-l bg-ui-bg-subtle overflow-y-auto">
          <PropertiesPanel
            node={selectedNode}
            flowId={flow.id}
            onUpdate={(data: Record<string, any>) => handleNodeUpdate(selectedNode.id, data)}
            onDelete={() => handleDeleteNode(selectedNode.id)}
            onClose={() => setSelectedNode(null)}
          />
        </div>
      )}
    </div>
  )
}

export function FlowEditor(props: FlowEditorProps) {
  return (
    <ReactFlowProvider>
      <FlowEditorInner {...props} />
    </ReactFlowProvider>
  )
}

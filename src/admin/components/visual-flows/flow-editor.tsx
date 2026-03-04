import { useCallback, useState, useRef, useEffect, useMemo } from "react"
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
import { StackedModalProvider } from "../modal/stacked-modal/stacked-modal-provider"

// Custom node types
const nodeTypes: NodeTypes = {
  trigger: TriggerNode,
  operation: OperationNode,
}

interface FlowEditorProps {
  flow: VisualFlow
  onUpdate: (data: VisualFlowUpdateInput) => Promise<VisualFlow>
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

    const edges: Edge[] = (flow.canvas_state.edges || []).map((e: any) => {
      // Backward compatibility: older canvas_state edges may not include handle info.
      // When possible, enrich them from persisted connections.
      const matchingConn = (flow.connections || []).find((c) => {
        if (c.source_id !== e.source || c.target_id !== e.target) {
          return false
        }

        if (e.sourceHandle && c.source_handle !== e.sourceHandle) {
          return false
        }

        if (e.targetHandle && c.target_handle !== e.targetHandle) {
          return false
        }

        return true
      })

      const sourceHandle = e.sourceHandle || matchingConn?.source_handle || "default"
      const targetHandle = e.targetHandle || matchingConn?.target_handle || "default"

      const connectionType =
        matchingConn?.connection_type ||
        (sourceHandle === "success" || sourceHandle === "failure" ? sourceHandle : "default")

      return {
        id: e.id,
        source: e.source,
        sourceHandle,
        target: e.target,
        targetHandle,
        type: "smoothstep",
        animated: connectionType === "success",
        style: {
          stroke: connectionType === "failure" ? "#ef4444" : "#6366f1",
        },
      }
    })

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
  const { screenToFlowPosition, getViewport } = useReactFlow()
  const { data: operationsData } = useOperationDefinitions()
  const [isSaving, setIsSaving] = useState(false)

  const initialData = flowToReactFlow(flow)
  const [nodes, setNodes, onNodesChange] = useNodesState(initialData.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialData.edges)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  // Derive from nodes so it's always current after handleNodeUpdate mutates nodes state
  const selectedNode = useMemo(
    () => (selectedNodeId ? nodes.find(n => n.id === selectedNodeId) ?? null : null),
    [nodes, selectedNodeId]
  )
  const [showOperationsPanel, setShowOperationsPanel] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  // Use a ref so the initialization flag never causes a re-render and can't
  // race with a slow-loading flow prop.
  const isInitializedRef = useRef(false)

  // Track changes — skip the very first render where nodes/edges settle from props
  useEffect(() => {
    if (!isInitializedRef.current) {
      isInitializedRef.current = true
      return
    }
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
    setSelectedNodeId(node.id)
  }, [])

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null)
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

  const handleSave = useCallback(async () => {
    if (isSaving) return
    setIsSaving(true)

    // Convert React Flow state back to API format
    const operations = nodes
      .filter(n => n.type === "operation")
      .map((n, index) => ({
        // New nodes have a temporary "op_" prefixed ID — omit so the server creates them.
        // Existing nodes have a server-assigned UUID — include so the server updates them.
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
      // ReactFlow auto-generates IDs like "xy-edge__..." for new edges — omit so the server creates them.
      id: (e.id.startsWith("reactflow") || e.id.startsWith("xy-edge__")) ? undefined : e.id,
      source_id: e.source,
      source_handle: e.sourceHandle || "default",
      target_id: e.target,
      target_handle: e.targetHandle || "default",
      connection_type: ((e.sourceHandle === "success" || e.sourceHandle === "failure")
        ? e.sourceHandle
        : "default") as "success" | "failure" | "default",
      label: (e.label as string) || undefined,
    }))

    const viewport = getViewport()

    try {
      const savedFlow = await onUpdate({
        operations,
        connections,
        canvas_state: {
          nodes: nodes.map(n => ({ id: n.id, position: n.position, data: n.data })),
          edges: edges.map(e => ({
            id: e.id,
            source: e.source,
            sourceHandle: e.sourceHandle || "default",
            target: e.target,
            targetHandle: e.targetHandle || "default",
          })),
          viewport,
        },
      })

      // Remap temporary "op_" node IDs to the server-assigned UUIDs so that
      // subsequent saves update existing records instead of creating duplicates.
      if (savedFlow?.operations?.length) {
        setNodes(nds => nds.map(node => {
          if (!node.id.startsWith("op_")) return node
          const serverOp = savedFlow.operations!.find(
            op => op.operation_key === node.data.operationKey
          )
          if (!serverOp) return node
          return { ...node, id: serverOp.id }
        }))
        // Also remap edge source/target references
        setEdges(eds => eds.map(edge => {
          const updatedSource = savedFlow.operations!.find(
            op => nodes.find(n => n.id === edge.source)?.data.operationKey === op.operation_key
          )
          const updatedTarget = savedFlow.operations!.find(
            op => nodes.find(n => n.id === edge.target)?.data.operationKey === op.operation_key
          )
          return {
            ...edge,
            source: updatedSource?.id ?? edge.source,
            target: updatedTarget?.id ?? edge.target,
          }
        }))
      }

      setHasChanges(false)
      toast.success("Flow saved")
    } catch (err: any) {
      toast.error(err?.message || "Failed to save flow")
    } finally {
      setIsSaving(false)
    }
  }, [nodes, edges, onUpdate, getViewport, isSaving, setNodes, setEdges])

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
    setSelectedNodeId(null)
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
              <Button
                size="small"
                variant={hasChanges ? "primary" : "secondary"}
                onClick={handleSave}
                disabled={isSaving}
              >
                {isSaving ? "Saving…" : hasChanges ? "Save Changes*" : "Save"}
              </Button>
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
          <StackedModalProvider onOpenChange={() => {}}>
            <PropertiesPanel
              node={selectedNode}
              allNodes={nodes}
              edges={edges}
              flowId={flow.id}
              onUpdate={(data: Record<string, any>) => handleNodeUpdate(selectedNode.id, data)}
              onDelete={() => handleDeleteNode(selectedNode.id)}
              onClose={() => setSelectedNodeId(null)}
            />
          </StackedModalProvider>
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

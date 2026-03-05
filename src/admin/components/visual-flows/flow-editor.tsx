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
    const nodes: Node[] = flow.canvas_state.nodes.map((n: any) => {
      // Merge options from the persisted operation record — canvas_state nodes
      // created by seed scripts (or older saves) may not include options in data.
      const matchingOp = (flow.operations || []).find(
        (op: any) => op.operation_key === (n.data?.operationKey ?? n.id)
      )
      return {
        id: n.id,
        type: n.id === "trigger" ? "trigger" : "operation",
        position: n.position,
        data: {
          ...n.data,
          options: n.data?.options ?? matchingOp?.options ?? {},
        },
      }
    })

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

      const rawSourceHandle = e.sourceHandle || matchingConn?.source_handle || "default"
      const rawTargetHandle = e.targetHandle || matchingConn?.target_handle || "default"
      // "input" was used in older seeds/exports — normalise to the actual handle id
      const sourceHandle = rawSourceHandle === "input" ? "default" : rawSourceHandle
      const targetHandle = rawTargetHandle === "input" ? "default" : rawTargetHandle

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

// ─── Edge-insertion helpers ──────────────────────────────────────────────────

/** Minimum distance from a point to a line segment */
function pointToSegmentDist(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  const dx = bx - ax, dy = by - ay
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.hypot(px - ax, py - ay)
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/**
 * Returns the edge whose drawn path is closest to `pos` (within `threshold` px),
 * or null if none qualifies.
 *
 * Approximates each smoothstep edge as a straight line between the source's
 * bottom-centre handle and the target's top-centre handle — good enough for hit detection.
 */
function findEdgeUnderPoint(
  pos: { x: number; y: number },
  edges: Edge[],
  nodes: Node[],
  threshold = 30,
): Edge | null {
  let nearest: Edge | null = null
  let nearestDist = threshold

  for (const edge of edges) {
    const src = nodes.find(n => n.id === edge.source)
    const tgt = nodes.find(n => n.id === edge.target)
    if (!src || !tgt) continue

    const srcW = (src as any).measured?.width  ?? 200
    const srcH = (src as any).measured?.height ?? 60
    const tgtW = (tgt as any).measured?.width  ?? 200

    // source bottom-centre → target top-centre (matches default smoothstep handles)
    const sx = src.position.x + srcW / 2
    const sy = src.position.y + srcH
    const tx = tgt.position.x + tgtW / 2
    const ty = tgt.position.y

    const dist = pointToSegmentDist(pos.x, pos.y, sx, sy, tx, ty)
    if (dist < nearestDist) {
      nearest = edge
      nearestDist = dist
    }
  }
  return nearest
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
  /** ID of the edge the user is currently hovering over while dragging a node */
  const [dragOverEdgeId, setDragOverEdgeId] = useState<string | null>(null)
  /** Operation type currently being dragged (for edge-label hint) */
  const [draggingType, setDraggingType] = useState<string | null>(null)
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

    // Track what type is being dragged so we can show the right hint label
    const type = event.dataTransfer.getData("application/reactflow")
    if (type) setDraggingType(type)

    // Highlight the edge closest to the cursor so the user can see where the
    // node will be inserted if they drop here.
    const pos = screenToFlowPosition({ x: event.clientX, y: event.clientY })
    const hit = findEdgeUnderPoint(pos, edges, nodes)
    setDragOverEdgeId(hit?.id ?? null)
  }, [screenToFlowPosition, edges, nodes])

  const onDragLeave = useCallback(() => {
    setDragOverEdgeId(null)
    setDraggingType(null)
  }, [])

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      setDragOverEdgeId(null)
      setDraggingType(null)

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

      // ── Insert between nodes when dropped on an existing edge ──────────────
      if (dragOverEdgeId) {
        setEdges((eds) => {
          const splitEdge = eds.find(e => e.id === dragOverEdgeId)
          if (!splitEdge) return eds

          const connectionType =
            splitEdge.sourceHandle === "success" || splitEdge.sourceHandle === "failure"
              ? splitEdge.sourceHandle
              : "default"

          // Edge A: predecessor → new node (always safe, target handle is always "default")
          const edgeA: Edge = {
            id: `xy-edge__${splitEdge.source}-${newNodeId}`,
            source: splitEdge.source,
            sourceHandle: splitEdge.sourceHandle || "default",
            target: newNodeId,
            targetHandle: "default",
            type: "smoothstep",
            animated: connectionType === "success",
            style: { stroke: connectionType === "failure" ? "#ef4444" : "#6366f1" },
          }

          const newEdges = [...eds.filter(e => e.id !== dragOverEdgeId), edgeA]

          // Edge B: new node → original target.
          // Condition nodes only have "success"/"failure" source handles — NOT "default".
          // Creating an edge from a non-existent handle corrupts React Flow's internal
          // edge state, which cascades and orphans all unrelated edges in the canvas.
          // For condition nodes we therefore skip edgeB and let the user wire the
          // success/failure outputs manually.
          const isConditionNode = type === "condition"
          if (!isConditionNode) {
            const edgeB: Edge = {
              id: `xy-edge__${newNodeId}-${splitEdge.target}`,
              source: newNodeId,
              sourceHandle: "default",
              target: splitEdge.target,
              targetHandle: splitEdge.targetHandle || "default",
              type: "smoothstep",
              animated: false,
              style: { stroke: "#6366f1" },
            }
            newEdges.push(edgeB)
          }

          return newEdges
        })
      }
    },
    [screenToFlowPosition, setNodes, setEdges, operationsData, dragOverEdgeId]
  )

  /** Edges with the drag-target edge highlighted in amber */
  const displayEdges = useMemo(() => {
    if (!dragOverEdgeId) return edges
    const isConditionDrag = draggingType === "condition"
    return edges.map(e => {
      if (e.id !== dragOverEdgeId) return e
      return {
        ...e,
        style: { ...e.style, stroke: "#f59e0b", strokeWidth: 3 },
        animated: true,
        label: isConditionDrag ? "Insert — wire outputs manually" : "Insert here",
        labelStyle: { fontSize: 10, fill: "#92400e" },
        labelBgStyle: { fill: "#fef3c7", fillOpacity: 0.9 },
        labelBgPadding: [4, 2] as [number, number],
      }
    })
  }, [edges, dragOverEdgeId, draggingType])

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
        // Track ONLY the nodes that were actually remapped (op_ → server UUID).
        // Nodes with stable IDs (e.g. operation_key strings like "read_email")
        // must NOT be remapped, otherwise edges would reference UUIDs while
        // the nodes still carry their original string IDs → edges disappear.
        const remappedIds = new Map<string, string>()

        setNodes(nds => nds.map(node => {
          if (!node.id.startsWith("op_")) return node
          const serverOp = savedFlow.operations!.find(
            op => op.operation_key === node.data.operationKey
          )
          if (!serverOp) return node
          remappedIds.set(node.id, serverOp.id)
          return { ...node, id: serverOp.id }
        }))

        // Only remap edges for the nodes that were actually renamed above.
        if (remappedIds.size > 0) {
          setEdges(eds => eds.map(edge => ({
            ...edge,
            source: remappedIds.get(edge.source) ?? edge.source,
            target: remappedIds.get(edge.target) ?? edge.target,
          })))
        }
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
          edges={displayEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
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

import { memo } from "react"
import { Handle, Position, NodeProps } from "@xyflow/react"
import { Badge, Text } from "@medusajs/ui"
import { 
  PlusMini, 
  MagnifyingGlass, 
  PencilSquare, 
  Trash,
  ArrowPath,
  Clock,
  EnvelopeSolid,
  BellAlert,
  GlobeEurope,
  PlaySolid,
  DocumentText,
  Funnel,
} from "@medusajs/icons"

interface OperationNodeData {
  label: string
  operationType: string
  operationKey: string
  options: Record<string, any>
}

const operationIcons: Record<string, React.ComponentType<any>> = {
  condition: Funnel,
  create_data: PlusMini,
  read_data: MagnifyingGlass,
  update_data: PencilSquare,
  delete_data: Trash,
  http_request: GlobeEurope,
  run_script: PlaySolid,
  send_email: EnvelopeSolid,
  notification: BellAlert,
  transform: ArrowPath,
  trigger_workflow: PlaySolid,
  sleep: Clock,
  log: DocumentText,
}

const operationColors: Record<string, string> = {
  condition: "bg-yellow-500",
  create_data: "bg-green-500",
  read_data: "bg-blue-500",
  update_data: "bg-orange-500",
  delete_data: "bg-red-500",
  http_request: "bg-purple-500",
  run_script: "bg-pink-500",
  send_email: "bg-cyan-500",
  notification: "bg-amber-500",
  transform: "bg-indigo-500",
  trigger_workflow: "bg-violet-500",
  sleep: "bg-gray-500",
  log: "bg-slate-500",
}


export const OperationNode = memo(({ data, selected }: NodeProps) => {
  const nodeData = data as unknown as OperationNodeData
  const Icon = operationIcons[nodeData.operationType] || PlaySolid
  const bgColor = operationColors[nodeData.operationType] || "bg-gray-500"
  
  const isCondition = nodeData.operationType === "condition"

  return (
    <div
      className={`
        px-4 py-3 rounded-lg border-2 shadow-sm min-w-[180px]
        bg-ui-bg-base dark:bg-ui-bg-base
        ${selected ? "border-ui-border-interactive shadow-md" : "border-ui-border-base"}
      `}
    >
      {/* Input handle */}
      <Handle
        type="target"
        position={Position.Top}
        id="default"
      />

      <div className="flex items-center gap-2 mb-2">
        <div className={`p-1.5 rounded ${bgColor}`}>
          <Icon className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <Text weight="plus" className="text-sm truncate text-ui-fg-base">
            {nodeData.label}
          </Text>
          <Text className="text-xs text-ui-fg-muted truncate">
            {nodeData.operationKey}
          </Text>
        </div>
      </div>

      <Badge color="blue" size="small">
        {nodeData.operationType.replace(/_/g, " ")}
      </Badge>

      {/* Output handles */}
      {isCondition ? (
        <>
          <Handle
            type="source"
            position={Position.Bottom}
            id="success"
            style={{ left: "30%", background: "#22c55e" }}
          />
          <Handle
            type="source"
            position={Position.Bottom}
            id="failure"
            style={{ left: "70%", background: "#ef4444" }}
          />
          <div className="flex justify-between mt-2 text-xs text-ui-fg-subtle px-2">
            <span>True</span>
            <span>False</span>
          </div>
        </>
      ) : (
        <Handle
          type="source"
          position={Position.Bottom}
          id="default"
        />
      )}
    </div>
  )
})

OperationNode.displayName = "OperationNode"

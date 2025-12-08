import { memo } from "react"
import { Handle, Position, NodeProps } from "@xyflow/react"
import { Badge, Text } from "@medusajs/ui"
import { BoltSolid } from "@medusajs/icons"

interface TriggerNodeData {
  label: string
  triggerType: string
  triggerConfig: Record<string, any>
}

export const TriggerNode = memo(({ data, selected }: NodeProps) => {
  const nodeData = data as unknown as TriggerNodeData
  
  const getTriggerLabel = (type: string) => {
    const labels: Record<string, string> = {
      event: "Event Trigger",
      schedule: "Scheduled",
      webhook: "Webhook",
      manual: "Manual",
      another_flow: "Flow Trigger",
    }
    return labels[type] || type
  }

  const getTriggerColor = (type: string) => {
    const colors: Record<string, string> = {
      event: "bg-purple-500",
      schedule: "bg-blue-500",
      webhook: "bg-green-500",
      manual: "bg-orange-500",
      another_flow: "bg-pink-500",
    }
    return colors[type] || "bg-gray-500"
  }

  return (
    <div
      className={`
        px-4 py-3 rounded-lg border-2 shadow-sm min-w-[180px]
        bg-ui-bg-base dark:bg-ui-bg-base
        ${selected ? "border-ui-border-interactive shadow-md" : "border-ui-border-base"}
      `}
    >
      <div className="flex items-center gap-2 mb-2">
        <div className={`p-1.5 rounded ${getTriggerColor(nodeData.triggerType)}`}>
          <BoltSolid className="w-4 h-4 text-white" />
        </div>
        <Text weight="plus" className="text-sm text-ui-fg-base">
          {getTriggerLabel(nodeData.triggerType)}
        </Text>
      </div>
      
      <Badge color="purple" size="small">
        Trigger
      </Badge>

      {/* Output handle */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="default"
      />
    </div>
  )
})

TriggerNode.displayName = "TriggerNode"

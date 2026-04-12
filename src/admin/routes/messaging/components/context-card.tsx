import { Badge } from "@medusajs/ui"

const statusColor = (status: string) => {
  switch (status) {
    case "completed": return "green"
    case "in_progress": return "blue"
    case "sent_to_partner": return "orange"
    case "cancelled": return "red"
    default: return "grey"
  }
}

export const ContextCard = ({
  type,
  snapshot,
}: {
  type: string
  snapshot: Record<string, any>
}) => {
  if (type === "production_run") {
    return (
      <div className="rounded border border-ui-border-base bg-ui-bg-base p-2 text-xs text-ui-fg-base">
        <div className="flex items-center justify-between mb-1">
          <span className="font-medium">Production Run</span>
          <Badge color={statusColor(snapshot.status) as any} size="2xsmall">
            {snapshot.status}
          </Badge>
        </div>
        <div className="text-ui-fg-muted">
          {snapshot.design_name && <div>Design: {snapshot.design_name}</div>}
          {snapshot.run_type && <div>Type: {snapshot.run_type}</div>}
          {snapshot.quantity && <div>Qty: {snapshot.quantity}</div>}
        </div>
      </div>
    )
  }

  if (type === "design") {
    return (
      <div className="rounded border border-ui-border-base bg-ui-bg-base p-2 text-xs text-ui-fg-base">
        <div className="flex items-center justify-between mb-1">
          <span className="font-medium">Design</span>
          {snapshot.status && (
            <Badge color={statusColor(snapshot.status) as any} size="2xsmall">
              {snapshot.status}
            </Badge>
          )}
        </div>
        <div className="text-ui-fg-muted">
          {snapshot.name && <div>{snapshot.name}</div>}
          {snapshot.fabric_type && <div>Fabric: {snapshot.fabric_type}</div>}
          {snapshot.color && <div>Color: {snapshot.color}</div>}
        </div>
        {snapshot.thumbnail && (
          <img src={snapshot.thumbnail} alt={snapshot.name} className="mt-1 rounded max-h-20 object-cover" />
        )}
      </div>
    )
  }

  if (type === "inventory_item") {
    return (
      <div className="rounded border border-ui-border-base bg-ui-bg-base p-2 text-xs text-ui-fg-base">
        <div className="font-medium mb-1">Inventory Item</div>
        <div className="text-ui-fg-muted">
          {snapshot.title && <div>{snapshot.title}</div>}
          {snapshot.sku && <div>SKU: {snapshot.sku}</div>}
        </div>
      </div>
    )
  }

  return null
}

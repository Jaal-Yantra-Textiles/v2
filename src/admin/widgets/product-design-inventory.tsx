import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Container, Heading, Text, Badge, StatusBadge, Skeleton } from "@medusajs/ui"
import { DetailWidgetProps } from "@medusajs/framework/types"
import { useProduct } from "../hooks/api/products"
import { useDesignInventory } from "../hooks/api/designs"
import { useProductionRuns } from "../hooks/api/production-runs"

// ─── Types ───────────────────────────────────────────────────────────────────

type ProductWithDesigns = {
  id: string
  designs?: Array<{ id: string; name: string }>
  [key: string]: any
}

type InventoryItem = {
  id: string
  title?: string
  sku?: string
  planned_quantity?: number
  consumed_quantity?: number
  [key: string]: any
}

type ProductionRun = {
  id: string
  status: string
  quantity: number
  partner_id?: string | null
  [key: string]: any
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const RUN_STATUS_COLOR: Record<string, "green" | "blue" | "orange" | "grey" | "red" | "purple"> = {
  completed: "green",
  in_progress: "blue",
  approved: "blue",
  sent_to_partner: "orange",
  pending_review: "orange",
  draft: "grey",
  cancelled: "red",
}

function runStatusLabel(status: string) {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DesignInventorySection({ designId }: { designId: string }) {
  const { data, isLoading } = useDesignInventory(designId)

  if (isLoading) return <Skeleton className="h-16 w-full" />

  const items: InventoryItem[] = (data as any)?.inventory_items ?? []
  if (!items.length) return (
    <Text size="xsmall" className="text-ui-fg-muted px-1">No material inventory linked to this design.</Text>
  )

  return (
    <div className="flex flex-col divide-y divide-ui-border-base rounded-lg border border-ui-border-base overflow-hidden">
      <div className="grid grid-cols-4 px-3 py-1.5 bg-ui-bg-subtle">
        <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">Material</Text>
        <Text size="xsmall" weight="plus" className="text-ui-fg-subtle text-right">Planned</Text>
        <Text size="xsmall" weight="plus" className="text-ui-fg-subtle text-right">Consumed</Text>
        <Text size="xsmall" weight="plus" className="text-ui-fg-subtle text-right">Remaining</Text>
      </div>
      {items.map((item) => {
        const planned = item.planned_quantity ?? 0
        const consumed = item.consumed_quantity ?? 0
        const remaining = planned - consumed
        return (
          <div key={item.id} className="grid grid-cols-4 px-3 py-2 items-center">
            <div className="flex flex-col">
              <Text size="xsmall" weight="plus">{item.title || item.sku || item.id}</Text>
              {item.sku && item.title && (
                <Text size="xsmall" className="text-ui-fg-muted">{item.sku}</Text>
              )}
            </div>
            <Text size="xsmall" className="text-right text-ui-fg-base">{planned.toLocaleString()}</Text>
            <Text size="xsmall" className={`text-right ${consumed > 0 ? "text-ui-fg-base" : "text-ui-fg-muted"}`}>
              {consumed.toLocaleString()}
            </Text>
            <Text
              size="xsmall"
              className={`text-right font-medium ${remaining < 0 ? "text-ui-fg-error" : remaining === 0 ? "text-ui-fg-muted" : "text-ui-fg-base"}`}
            >
              {remaining.toLocaleString()}
            </Text>
          </div>
        )
      })}
    </div>
  )
}

function DesignProductionRunsSection({ designId }: { designId: string }) {
  const { production_runs: runs = [], isLoading } = useProductionRuns({ design_id: designId, limit: 20 })

  if (isLoading) return <Skeleton className="h-16 w-full" />

  if (!runs.length) return (
    <Text size="xsmall" className="text-ui-fg-muted px-1">No production runs linked to this design.</Text>
  )

  const totalProduced = runs
    .filter((r: ProductionRun) => r.status === "completed")
    .reduce((sum: number, r: ProductionRun) => sum + (r.quantity ?? 0), 0)

  const inProgress = runs
    .filter((r: ProductionRun) => ["in_progress", "sent_to_partner", "approved"].includes(r.status))
    .reduce((sum: number, r: ProductionRun) => sum + (r.quantity ?? 0), 0)

  return (
    <div className="flex flex-col gap-y-3">
      {/* Summary chips */}
      <div className="flex items-center gap-x-2 flex-wrap">
        {totalProduced > 0 && (
          <div className="flex items-center gap-x-1 rounded-full bg-ui-tag-green-bg px-2.5 py-0.5">
            <span className="h-1.5 w-1.5 rounded-full bg-ui-tag-green-icon" />
            <Text size="xsmall" className="text-ui-tag-green-text font-medium">
              {totalProduced.toLocaleString()} completed
            </Text>
          </div>
        )}
        {inProgress > 0 && (
          <div className="flex items-center gap-x-1 rounded-full bg-ui-tag-blue-bg px-2.5 py-0.5">
            <span className="h-1.5 w-1.5 rounded-full bg-ui-tag-blue-icon" />
            <Text size="xsmall" className="text-ui-tag-blue-text font-medium">
              {inProgress.toLocaleString()} in production
            </Text>
          </div>
        )}
        <Badge size="2xsmall" color="grey">{runs.length} run{runs.length !== 1 ? "s" : ""} total</Badge>
      </div>

      {/* Run table */}
      <div className="flex flex-col divide-y divide-ui-border-base rounded-lg border border-ui-border-base overflow-hidden">
        <div className="grid grid-cols-3 px-3 py-1.5 bg-ui-bg-subtle">
          <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">Status</Text>
          <Text size="xsmall" weight="plus" className="text-ui-fg-subtle text-right">Quantity</Text>
          <Text size="xsmall" weight="plus" className="text-ui-fg-subtle text-right">Partner</Text>
        </div>
        {(runs as ProductionRun[]).map((run) => (
          <div key={run.id} className="grid grid-cols-3 px-3 py-2 items-center">
            <StatusBadge color={RUN_STATUS_COLOR[run.status] ?? "grey"}>
              {runStatusLabel(run.status)}
            </StatusBadge>
            <Text size="xsmall" className="text-right">{(run.quantity ?? 0).toLocaleString()}</Text>
            <Text size="xsmall" className="text-right text-ui-fg-muted">
              {run.partner_id ? run.partner_id.slice(0, 8) + "…" : "—"}
            </Text>
          </div>
        ))}
      </div>
    </div>
  )
}

function DesignSection({ design }: { design: { id: string; name: string } }) {
  return (
    <div className="flex flex-col gap-y-4 py-4">
      <Text size="small" weight="plus" className="text-ui-fg-subtle px-6">
        {design.name}
      </Text>

      <div className="flex flex-col gap-y-2 px-6">
        <Text size="xsmall" weight="plus" className="text-ui-fg-subtle uppercase tracking-wide">
          Production Runs
        </Text>
        <DesignProductionRunsSection designId={design.id} />
      </div>

      <div className="flex flex-col gap-y-2 px-6">
        <Text size="xsmall" weight="plus" className="text-ui-fg-subtle uppercase tracking-wide">
          Material Inventory
        </Text>
        <DesignInventorySection designId={design.id} />
      </div>
    </div>
  )
}

// ─── Widget ───────────────────────────────────────────────────────────────────

// Merged into product-designs.tsx — this widget is intentionally disabled.
const ProductDesignInventoryWidget = (_: DetailWidgetProps<{ id: string }>) => null

export const config = defineWidgetConfig({
  zone: "product.details.before",
})

export default ProductDesignInventoryWidget

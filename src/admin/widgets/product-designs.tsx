import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Container, Text, Badge, StatusBadge, usePrompt, Skeleton, Button, Heading } from "@medusajs/ui"
import { DetailWidgetProps } from "@medusajs/framework/types"
import { useNavigate } from "react-router-dom"
import { ActionMenu } from "../components/common/action-menu"
import { PencilSquare, Plus, Trash } from "@medusajs/icons"
import { useProduct, useUnlinkProductDesign } from "../hooks/api/products"
import { useDesignInventory } from "../hooks/api/designs"
import { useProductionRuns } from "../hooks/api/production-runs"

const designStatusColor = (status: string): "green" | "blue" | "orange" | "grey" | "red" | "purple" => {
  switch (status) {
    case "Commerce_Ready":
      return "green"
    case "Approved":
      return "blue"
    case "In_Development":
      return "orange"
    case "Conceptual":
      return "grey"
    case "Rejected":
      return "red"
    case "On_Hold":
      return "purple"
    default:
      return "grey"
  }
}

type Design = {
  id: string
  name: string
  description?: string
  status: string
  priority: string
  design_type: string
  created_at: string
  updated_at: string
}

type AdminProduct = {
  id: string
  designs?: Design[]
}

type ProductWithDesigns = {
  id: string
  designs?: Design[]
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

const ProductDesignsWidget = ({ data }: DetailWidgetProps<AdminProduct>) => {
  const navigate = useNavigate()
  const prompt = usePrompt()
  const unlinkDesignMutation = useUnlinkProductDesign()

  const {
    product,
    isPending: isLoading,
    isError,
    error,
  } = useProduct(
    data.id!,
    {
      fields: "+designs.*",
    },
  ) as {
    product?: ProductWithDesigns
    isPending: boolean
    isError: boolean
    error?: Error
  }

  const handleUnlinkDesign = async (designId: string, designName: string) => {
    if (!designId) return
    const confirmed = await prompt({
      title: "Unlink Design",
      description: `Are you sure you want to unlink "${designName}" from this product? This action can be undone later.`,
    })

    if (!confirmed) {
      return
    }

    try {
      await unlinkDesignMutation.mutateAsync({
        productId: data.id!,
        payload: { designId }
      })
    } catch (error) {
      // Error handling is done in the mutation
    }
  }

  const getDesignActionGroups = (design: Design) => [
    {
      actions: [
        {
          label: "View Design",
          icon: <PencilSquare />,
          to: `/designs/${design.id}`,
        },
      ],
    },
    {
      actions: [
        {
          label: "Unlink",
          icon: <Trash />,
          variant: "danger" as const,
          onClick: () => handleUnlinkDesign(design.id, design.name),
        },
      ],
    },
  ]

  if (isLoading) {
    return (
      <Skeleton className="h-32"></Skeleton>
    )
  }

  if (isError) {
    return (
      <Container className="divide-y p-0">
        <div className="flex items-center justify-center h-40">
          <Text className="text-ui-fg-error">{error?.message || "An error occurred"}</Text>
        </div>
      </Container>
    )
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-4">
          <Heading level="h2">Linked Designs</Heading>
          {product?.designs && product.designs.length > 0 && (
            <Badge size="2xsmall" color="blue">
              {product.designs.length} design{product.designs.length !== 1 ? 's' : ''}
            </Badge>
          )}
        </div>
        <ActionMenu
          groups={[
            {
              actions: [
                {
                  label: "Link Design",
                  icon: <Plus />,
                  to: `link-design`,
                },
              ],
            },
          ]}
        />
      </div>

      <div className="p-0">
        {!product?.designs || product.designs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32">
            <p className="text-ui-fg-subtle mb-4">No designs linked yet</p>
            <Button
              variant="secondary"
              onClick={() => navigate(`/products/${data.id}/link-design`)}
            >
              <Plus className="w-4 h-4 mr-2" />
              Link Design
            </Button>
          </div>
        ) : (
          <div className="divide-y">
            {product.designs.map((design: Design) => (
              <div key={design.id} className="flex flex-col">
                {/* Design header row */}
                <div className="flex items-center justify-between px-6 py-4">
                  <div className="flex items-center gap-x-4">
                    <div className="flex flex-col">
                      <Text size="small" weight="plus" className="mb-1">
                        {design.name}
                      </Text>
                      {design.description && (
                        <Text size="xsmall" className="text-ui-fg-subtle">
                          {design.description}
                        </Text>
                      )}
                      <div className="flex items-center gap-x-2 mt-2">
                        <StatusBadge color={designStatusColor(design.status)}>
                          {design.status}
                        </StatusBadge>
                        <Badge size="2xsmall" color="grey">
                          {design.design_type}
                        </Badge>
                        <Badge size="2xsmall" color="purple">
                          {design.priority}
                        </Badge>
                      </div>
                    </div>
                  </div>
                  <ActionMenu groups={getDesignActionGroups(design)} />
                </div>

                {/* Inventory & Production sub-section */}
                <div className="flex flex-col gap-y-4 px-6 pb-5 bg-ui-bg-subtle border-t border-ui-border-base">
                  <div className="flex flex-col gap-y-2 pt-4">
                    <Text size="xsmall" weight="plus" className="text-ui-fg-subtle uppercase tracking-wide">
                      Production Runs
                    </Text>
                    <DesignProductionRunsSection designId={design.id} />
                  </div>
                  <div className="flex flex-col gap-y-2">
                    <Text size="xsmall" weight="plus" className="text-ui-fg-subtle uppercase tracking-wide">
                      Material Inventory
                    </Text>
                    <DesignInventorySection designId={design.id} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "product.details.side.before",
})

export default ProductDesignsWidget

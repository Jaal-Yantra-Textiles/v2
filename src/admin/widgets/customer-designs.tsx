import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Container, Text, Badge, StatusBadge, Skeleton, Heading, toast, Checkbox, CommandBar } from "@medusajs/ui"
import { DetailWidgetProps } from "@medusajs/framework/types"
import { useState, useMemo, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { ActionMenu } from "../components/common/action-menu"
import { BellAlert, PencilSquare, Plus, Link as LinkIcon, ShoppingBag } from "@medusajs/icons"
import {
  useDesigns,
  useNotifyDesignCustomer,
  usePreviewDesignOrder,
  useCreateDesignOrder,
  useCustomerOrderedDesigns,
  DesignEstimatePreview,
} from "../hooks/api/designs"
import { LinkDesignToCustomerDrawer } from "../components/designs/link-design-to-customer-drawer"
import { DesignOrderPreviewDrawer } from "../components/designs/design-order-preview-drawer"

const designStatusColor = (status: string): "green" | "blue" | "orange" | "grey" | "red" | "purple" => {
  switch (status) {
    case "Commerce_Ready": return "green"
    case "Approved": return "blue"
    case "In_Development": return "orange"
    case "Conceptual": return "grey"
    case "Rejected": return "red"
    case "On_Hold": return "purple"
    default: return "grey"
  }
}

type Customer = { id: string }

const DesignRow = ({
  design,
  selected,
  onToggle,
}: {
  design: any
  selected: boolean
  onToggle: (id: string) => void
}) => {
  const { mutate: notifyCustomer, isPending: isNotifying } = useNotifyDesignCustomer(design.id, {
    onSuccess: () => {
      toast.success("Notification sent", {
        description: `Customer has been notified about "${design.name}".`,
      })
    },
    onError: (err: any) => {
      toast.error("Failed to send notification", {
        description: err?.message || "An unexpected error occurred.",
      })
    },
  })

  const actionGroups = [
    {
      actions: [
        {
          label: "View Design",
          icon: <PencilSquare />,
          to: `/designs/${design.id}`,
        },
        {
          label: "Open Moodboard",
          icon: <PencilSquare />,
          to: `/designs/${design.id}/moodboard`,
        },
        {
          label: isNotifying ? "Sending…" : "Notify Customer",
          icon: <BellAlert />,
          onClick: () => notifyCustomer(),
          disabled: isNotifying,
        },
      ],
    },
  ]

  return (
    <div className="flex items-center gap-x-3 px-6 py-4">
      <Checkbox
        checked={selected}
        onCheckedChange={() => onToggle(design.id)}
      />
      <div className="flex flex-1 items-center justify-between min-w-0">
        <div className="flex flex-col">
          <Text size="small" weight="plus" className="mb-1">
            {design.name}
          </Text>
          {design.description && (
            <Text size="xsmall" className="text-ui-fg-subtle line-clamp-1">
              {design.description}
            </Text>
          )}
          <div className="flex items-center gap-x-2 mt-2">
            {design.status && (
              <StatusBadge color={designStatusColor(design.status)}>
                {design.status}
              </StatusBadge>
            )}
            {design.design_type && (
              <Badge size="2xsmall" color="grey">
                {design.design_type}
              </Badge>
            )}
          </div>
        </div>
        <ActionMenu groups={actionGroups} />
      </div>
    </div>
  )
}

const OrderedDesignRow = ({ design }: { design: any }) => {
  const navigate = useNavigate()

  const actionGroups = [
    {
      actions: [
        {
          label: "View Design",
          icon: <PencilSquare />,
          to: `/designs/${design.id}`,
        },
        ...(design.order_ids || []).map((orderId: string, i: number) => ({
          label: design.order_ids.length === 1 ? "View Order" : `View Order ${i + 1}`,
          icon: <ShoppingBag />,
          to: `/orders/${orderId}`,
        })),
      ],
    },
  ]

  return (
    <div className="flex items-center justify-between px-6 py-3">
      <div className="flex flex-col min-w-0">
        <Text size="small" weight="plus" className="truncate">{design.name}</Text>
        <div className="flex items-center gap-x-2 mt-1">
          {design.status && (
            <StatusBadge color={designStatusColor(design.status)}>
              {design.status}
            </StatusBadge>
          )}
          <Badge size="2xsmall" color="green">
            Ordered
          </Badge>
        </div>
      </div>
      <ActionMenu groups={actionGroups} />
    </div>
  )
}

const CustomerDesignsWidget = ({ data }: DetailWidgetProps<Customer>) => {
  const navigate = useNavigate()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selectedRows, setSelectedRows] = useState<Record<string, boolean>>({})

  // Preview state
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewData, setPreviewData] = useState<{
    estimates: DesignEstimatePreview[]
    currency_code: string
    total: number
  } | null>(null)
  const [previewDesignIds, setPreviewDesignIds] = useState<string[]>([])

  const { designs, isLoading, isError, error } = useDesigns({ customer_id: data.id } as any)
  const { designs: orderedDesigns, isLoading: isLoadingOrdered } = useCustomerOrderedDesigns(data.id)

  const linkedDesignIds = useMemo(() => designs.map((d: any) => d.id), [designs])

  const selectedIds = Object.keys(selectedRows).filter((id) => selectedRows[id])
  const selectedCount = selectedIds.length

  const toggleRow = useCallback((id: string) => {
    setSelectedRows((prev) => {
      const next = { ...prev }
      if (next[id]) {
        delete next[id]
      } else {
        next[id] = true
      }
      return next
    })
  }, [])

  const clearSelection = useCallback(() => setSelectedRows({}), [])

  const { mutate: previewOrder, isPending: isPreviewing } = usePreviewDesignOrder(data.id, {
    onSuccess: (resp) => {
      setPreviewData(resp)
      setPreviewOpen(true)
    },
    onError: (err: any) => {
      toast.error("Failed to estimate costs", {
        description: err?.message || "An unexpected error occurred.",
      })
    },
  })

  const { mutate: createDesignOrder, isPending: isCreatingOrder } = useCreateDesignOrder(data.id, {
    onSuccess: (resp) => {
      toast.success("Draft order created", {
        description: `Order created with ${previewDesignIds.length} design(s).`,
      })
      setPreviewOpen(false)
      setPreviewData(null)
      clearSelection()
      navigate(`/orders/${resp.order.id}`)
    },
    onError: (err: any) => {
      toast.error("Failed to create draft order", {
        description: err?.message || "An unexpected error occurred.",
      })
    },
  })

  const handlePreviewOrder = () => {
    if (selectedCount === 0) return
    setPreviewDesignIds(selectedIds)
    previewOrder({ design_ids: selectedIds })
  }

  const handleConfirmOrder = (priceOverrides: Record<string, number>) => {
    createDesignOrder({
      design_ids: previewDesignIds,
      price_overrides: Object.keys(priceOverrides).length > 0 ? priceOverrides : undefined,
    })
  }

  const headerActionGroups = [
    {
      actions: [
        {
          label: "Link Existing Design",
          icon: <LinkIcon />,
          onClick: () => setDrawerOpen(true),
        },
        {
          label: "Create New Design",
          icon: <Plus />,
          onClick: () => navigate("/designs/create", { state: { customer_id: data.id } }),
        },
      ],
    },
  ]

  if (isLoading) {
    return <Skeleton className="h-32" />
  }

  if (isError) {
    return (
      <Container className="divide-y p-0">
        <div className="flex items-center justify-center h-40">
          <Text className="text-ui-fg-error">{(error as any)?.message || "An error occurred"}</Text>
        </div>
      </Container>
    )
  }

  return (
    <>
      <Container className="divide-y p-0">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-x-4">
            <Heading level="h2">Customer Designs</Heading>
            {designs.length > 0 && (
              <Badge size="2xsmall" color="blue">
                {designs.length}
              </Badge>
            )}
          </div>
          <ActionMenu groups={headerActionGroups} />
        </div>

        {/* Active designs */}
        <div className="p-0">
          {designs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32">
              <p className="text-ui-fg-subtle mb-4">No active designs for this customer</p>
              <ActionMenu groups={headerActionGroups} />
            </div>
          ) : (
            <div className="divide-y">
              {designs.map((design: any) => (
                <DesignRow
                  key={design.id}
                  design={design}
                  selected={!!selectedRows[design.id]}
                  onToggle={toggleRow}
                />
              ))}
            </div>
          )}
        </div>

        {/* Ordered designs section */}
        {!isLoadingOrdered && orderedDesigns.length > 0 && (
          <>
            <div className="px-6 py-3 bg-ui-bg-subtle">
              <div className="flex items-center gap-x-3">
                <Text size="small" weight="plus" className="text-ui-fg-subtle">
                  Past Orders
                </Text>
                <Badge size="2xsmall" color="grey">
                  {orderedDesigns.length}
                </Badge>
              </div>
            </div>
            <div className="divide-y">
              {orderedDesigns.map((design: any) => (
                <OrderedDesignRow key={design.id} design={design} />
              ))}
            </div>
          </>
        )}
      </Container>

      <CommandBar open={selectedCount > 0}>
        <CommandBar.Bar>
          <CommandBar.Value>{selectedCount} selected</CommandBar.Value>
          <CommandBar.Seperator />
          <CommandBar.Command
            action={handlePreviewOrder}
            label={isPreviewing ? "Estimating..." : "Convert to Draft Order"}
            shortcut="o"
            disabled={isPreviewing}
          />
          <CommandBar.Seperator />
          <CommandBar.Command
            action={clearSelection}
            label="Clear"
            shortcut="esc"
          />
        </CommandBar.Bar>
      </CommandBar>

      <LinkDesignToCustomerDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        customerId={data.id}
        linkedDesignIds={linkedDesignIds}
      />

      {previewData && (
        <DesignOrderPreviewDrawer
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          estimates={previewData.estimates}
          currencyCode={previewData.currency_code}
          total={previewData.total}
          onConfirm={handleConfirmOrder}
          isConfirming={isCreatingOrder}
        />
      )}
    </>
  )
}

export const config = defineWidgetConfig({
  zone: "customer.details.side.before",
})

export default CustomerDesignsWidget

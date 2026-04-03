import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Container, Text, Badge, StatusBadge, Skeleton, Heading, toast, Checkbox, CommandBar, Button } from "@medusajs/ui"
import { DetailWidgetProps } from "@medusajs/framework/types"
import { useState, useMemo, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { ActionMenu } from "../components/common/action-menu"
import { BellAlert, PencilSquare, Plus, Link as LinkIcon, ShoppingBag, SquareTwoStack } from "@medusajs/icons"
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

/** Groups ordered designs by cart_id so designs in the same cart show as one row */
const useGroupedOrderedDesigns = (orderedDesigns: any[]) =>
  useMemo(() => {
    const groups = new Map<string, { designs: any[]; checkoutUrl: string | null; status: "pending" | "completed"; orderIds: string[] }>()
    for (const design of orderedDesigns) {
      const cartId = design.cart_ids?.[0] || design.id
      if (!groups.has(cartId)) {
        groups.set(cartId, {
          designs: [],
          checkoutUrl: design.checkout_url || null,
          status: design.checkout_status || "pending",
          orderIds: [],
        })
      }
      const group = groups.get(cartId)!
      group.designs.push(design)
      for (const oid of design.order_ids || []) {
        if (!group.orderIds.includes(oid)) group.orderIds.push(oid)
      }
      if (design.checkout_status === "completed") group.status = "completed"
    }
    return Array.from(groups.values())
  }, [orderedDesigns])

const OrderedDesignGroup = ({ group }: { group: { designs: any[]; checkoutUrl: string | null; status: string; orderIds: string[] } }) => {
  const isPending = group.status === "pending"
  const checkoutUrl = group.checkoutUrl
  const first = group.designs[0]
  const rest = group.designs.slice(1)

  const actionGroups = [
    {
      actions: [
        ...group.designs.map((d: any) => ({
          label: `View ${d.name}`,
          icon: <PencilSquare />,
          to: `/designs/${d.id}`,
        })),
        ...group.orderIds.map((orderId: string, i: number) => ({
          label: group.orderIds.length === 1 ? "View Order" : `View Order ${i + 1}`,
          icon: <ShoppingBag />,
          to: `/orders/${orderId}`,
        })),
        ...(checkoutUrl
          ? [
              {
                label: "Copy Checkout Link",
                icon: <SquareTwoStack />,
                onClick: () => {
                  navigator.clipboard.writeText(checkoutUrl)
                  toast.success("Checkout link copied")
                },
              },
            ]
          : []),
      ],
    },
  ]

  return (
    <div className="px-6 py-3">
      <div className="flex items-center justify-between">
        <div className="flex flex-col min-w-0 flex-1">
          <div className="flex items-center gap-x-1.5">
            <Text size="small" weight="plus" className="truncate">{first.name}</Text>
            {rest.length > 0 && (
              <Badge size="2xsmall" color="grey">
                +{rest.length} more
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-x-2 mt-1">
            <Badge size="2xsmall" color={isPending ? "orange" : "green"}>
              {isPending ? "Pending Checkout" : "Ordered"}
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-x-2">
          {isPending && checkoutUrl && (
            <Button
              variant="secondary"
              size="small"
              onClick={() => {
                navigator.clipboard.writeText(checkoutUrl)
                toast.success("Checkout link copied")
              }}
            >
              <SquareTwoStack className="w-3.5 h-3.5 mr-1" />
              Copy URL
            </Button>
          )}
          <ActionMenu groups={actionGroups} />
        </div>
      </div>
      {isPending && checkoutUrl && (
        <Text size="xsmall" className="text-ui-fg-subtle mt-1 truncate">
          {checkoutUrl}
        </Text>
      )}
    </div>
  )
}

const OrderedDesignsSection = ({ orderedDesigns }: { orderedDesigns: any[] }) => {
  const groups = useGroupedOrderedDesigns(orderedDesigns)

  return (
    <>
      <div className="px-6 py-3 bg-ui-bg-subtle">
        <div className="flex items-center gap-x-3">
          <Text size="small" weight="plus" className="text-ui-fg-subtle">
            Sent to Checkout
          </Text>
          <Badge size="2xsmall" color="grey">
            {groups.length}
          </Badge>
        </div>
      </div>
      <div className="divide-y">
        {groups.map((group, i) => (
          <OrderedDesignGroup key={group.designs[0]?.id || i} group={group} />
        ))}
      </div>
    </>
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

  const { designs: allLinkedDesigns, isLoading, isError, error } = useDesigns({ customer_id: data.id } as any)
  const { designs: orderedDesigns, isLoading: isLoadingOrdered } = useCustomerOrderedDesigns(data.id)

  // Split: active = linked but not in checkout/ordered; ordered = has cart/order
  const orderedDesignIds = useMemo(
    () => new Set(orderedDesigns.map((d: any) => d.id)),
    [orderedDesigns]
  )
  const designs = useMemo(
    () => allLinkedDesigns.filter((d: any) => !orderedDesignIds.has(d.id)),
    [allLinkedDesigns, orderedDesignIds]
  )

  // All linked IDs (active + ordered) for the drawer to exclude
  const linkedDesignIds = useMemo(() => allLinkedDesigns.map((d: any) => d.id), [allLinkedDesigns])

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
      setPreviewOpen(false)
      setPreviewData(null)
      clearSelection()
      toast.success("Checkout cart created", {
        description: "Share the checkout link with the customer to complete payment.",
      })
    },
    onError: (err: any) => {
      toast.error("Failed to create checkout cart", {
        description: err?.message || "An unexpected error occurred.",
      })
    },
  })

  const handlePreviewOrder = () => {
    if (selectedCount === 0) return
    setPreviewDesignIds(selectedIds)
    previewOrder({ design_ids: selectedIds })
  }

  const handleConfirmOrder = (priceOverrides: Record<string, number>, overrideCurrency?: string) => {
    createDesignOrder({
      design_ids: previewDesignIds,
      price_overrides: Object.keys(priceOverrides).length > 0 ? priceOverrides : undefined,
      override_currency: overrideCurrency,
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

        {/* Sent to Checkout section */}
        {!isLoadingOrdered && orderedDesigns.length > 0 && (
          <OrderedDesignsSection orderedDesigns={orderedDesigns} />
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

import { useParams, UIMatch } from "react-router-dom"
import {
  Container,
  Heading,
  Text,
  Badge,
  StatusBadge,
  Button,
  toast,
  usePrompt,
  Skeleton,
} from "@medusajs/ui"
import {
  CheckCircleSolid,
  XCircle,
  PencilSquare,
  SquareTwoStack,
  ShoppingBag,
} from "@medusajs/icons"
import { ActionMenu } from "../../../components/common/action-menu"
import { TwoColumnPage } from "../../../components/pages/two-column-pages"
import { TwoColumnPageSkeleton } from "../../../components/table/skeleton"
import {
  useDesignOrder,
  useApproveDesign,
  useCancelDesignOrder,
} from "../../../hooks/api/design-orders"

// ─── Status helpers ─────────────────────────────────────────────────────────

const getDesignStatusColor = (status: string): "green" | "blue" | "orange" | "grey" | "red" | "purple" => {
  switch (status) {
    case "Commerce_Ready": return "blue"
    case "Approved": return "green"
    case "In_Development": return "orange"
    case "Sample_Production": return "orange"
    case "Technical_Review": return "purple"
    case "Revision": case "Rejected": return "red"
    case "On_Hold": return "grey"
    default: return "grey"
  }
}

const getPaymentStatusColor = (status: string): "green" | "orange" | "red" | "grey" => {
  switch (status) {
    case "captured": case "partially_captured": return "green"
    case "awaiting": case "requires_action": return "orange"
    case "canceled": case "refunded": case "partially_refunded": return "red"
    default: return "grey"
  }
}

const formatCurrency = (amount: number, currencyCode = "inr") => {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: currencyCode.toUpperCase(),
    minimumFractionDigits: 2,
  }).format(amount)
}

const formatDate = (date: string) => {
  return new Date(date).toLocaleDateString("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

// ─── Header Section ─────────────────────────────────────────────────────────

const DesignOrderHeaderSection = ({ designOrder }: { designOrder: any }) => {
  const prompt = usePrompt()
  const { mutateAsync: approve, isPending: isApproving } = useApproveDesign(designOrder.design.id)
  const { mutateAsync: cancelOrder, isPending: isCanceling } = useCancelDesignOrder(designOrder.order?.id ?? "")

  const isApproved = designOrder.design.status === "Approved"
  const hasOrder = !!designOrder.order
  const isCanceled = !!designOrder.order?.canceled_at

  const handleApprove = async () => {
    const confirmed = await prompt({
      title: "Approve design?",
      description: `This will create a product and variant for "${designOrder.design.name}" and mark it as Approved.`,
      confirmText: "Approve",
      cancelText: "Cancel",
    })
    if (!confirmed) return
    await approve(undefined, {
      onSuccess: () => toast.success(`"${designOrder.design.name}" approved`),
      onError: (e) => toast.error(e.message),
    })
  }

  const handleCancel = async () => {
    const confirmed = await prompt({
      title: "Cancel order?",
      description: `This will cancel order #${designOrder.order?.display_id}. This cannot be undone.`,
      confirmText: "Cancel order",
      cancelText: "Go back",
    })
    if (!confirmed) return
    await cancelOrder(undefined, {
      onSuccess: () => toast.success(`Order #${designOrder.order?.display_id} canceled`),
      onError: (e) => toast.error(e.message),
    })
  }

  const actionGroups = [
    {
      actions: [
        {
          label: "View Design",
          icon: <PencilSquare />,
          to: `/designs/${designOrder.design.id}`,
        },
        ...(hasOrder
          ? [{
              label: "View Order",
              icon: <ShoppingBag />,
              to: `/orders/${designOrder.order.id}`,
            }]
          : []),
        {
          label: isApproved ? "Already Approved" : isApproving ? "Approving..." : "Approve Design",
          icon: <CheckCircleSolid />,
          onClick: handleApprove,
          disabled: isApproved || isApproving,
        },
        ...(hasOrder && !isCanceled
          ? [{
              label: isCanceling ? "Canceling..." : "Cancel Order",
              icon: <XCircle />,
              onClick: handleCancel,
              disabled: isCanceling,
            }]
          : []),
      ],
    },
  ]

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h1">{designOrder.design.name}</Heading>
          {designOrder.design.description && (
            <Text size="small" className="text-ui-fg-subtle mt-1">
              {designOrder.design.description}
            </Text>
          )}
        </div>
        <ActionMenu groups={actionGroups} />
      </div>
      <div className="grid grid-cols-2 gap-4 px-6 py-4">
        <div>
          <Text size="xsmall" className="text-ui-fg-subtle mb-1">Design Status</Text>
          <StatusBadge color={getDesignStatusColor(designOrder.design.status)}>
            {designOrder.design.status?.replace(/_/g, " ")}
          </StatusBadge>
        </div>
        {designOrder.design.design_type && (
          <div>
            <Text size="xsmall" className="text-ui-fg-subtle mb-1">Type</Text>
            <Badge size="2xsmall" color="grey">{designOrder.design.design_type}</Badge>
          </div>
        )}
      </div>
    </Container>
  )
}

// ─── Line Item Section ──────────────────────────────────────────────────────

const LineItemSection = ({ designOrder }: { designOrder: any }) => {
  const currencyCode = designOrder.order?.currency_code || "inr"

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">Line Item</Heading>
      </div>
      <div className="grid grid-cols-2 gap-4 px-6 py-4">
        <div>
          <Text size="xsmall" className="text-ui-fg-subtle mb-1">Title</Text>
          <Text size="small" weight="plus">{designOrder.title || designOrder.design.name}</Text>
        </div>
        <div>
          <Text size="xsmall" className="text-ui-fg-subtle mb-1">Unit Price</Text>
          <Text size="small" weight="plus">{formatCurrency(designOrder.price, currencyCode)}</Text>
        </div>
        <div>
          <Text size="xsmall" className="text-ui-fg-subtle mb-1">Quantity</Text>
          <Text size="small">{designOrder.quantity}</Text>
        </div>
        <div>
          <Text size="xsmall" className="text-ui-fg-subtle mb-1">Added</Text>
          <Text size="small">{designOrder.added_at ? formatDate(designOrder.added_at) : "—"}</Text>
        </div>
      </div>
      {designOrder.metadata?.cost_confidence && (
        <div className="px-6 py-3">
          <Text size="xsmall" className="text-ui-fg-subtle mb-1">Cost Confidence</Text>
          <Badge
            size="2xsmall"
            color={
              designOrder.metadata.cost_confidence === "exact" ? "green" :
              designOrder.metadata.cost_confidence === "estimated" ? "orange" :
              designOrder.metadata.cost_confidence === "manual" ? "blue" : "red"
            }
          >
            {designOrder.metadata.cost_confidence}
          </Badge>
        </div>
      )}
    </Container>
  )
}

// ─── Order Section ──────────────────────────────────────────────────────────

const OrderSection = ({ designOrder }: { designOrder: any }) => {
  const order = designOrder.order

  if (!order) {
    return (
      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading level="h2">Order</Heading>
        </div>
        <div className="px-6 py-4">
          <Badge size="2xsmall" color="orange">Pending Checkout</Badge>
          <Text size="small" className="text-ui-fg-subtle mt-2">
            The customer has not completed checkout yet.
          </Text>
        </div>
      </Container>
    )
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Order #{order.display_id}</Heading>
        <ActionMenu
          groups={[{
            actions: [{
              label: "View Order",
              icon: <ShoppingBag />,
              to: `/orders/${order.id}`,
            }],
          }]}
        />
      </div>
      <div className="grid grid-cols-2 gap-4 px-6 py-4">
        <div>
          <Text size="xsmall" className="text-ui-fg-subtle mb-1">Status</Text>
          <StatusBadge color={order.status === "completed" ? "green" : order.status === "canceled" ? "red" : "orange"}>
            {order.status}
          </StatusBadge>
        </div>
        {order.payment_status && (
          <div>
            <Text size="xsmall" className="text-ui-fg-subtle mb-1">Payment</Text>
            <Badge size="2xsmall" color={getPaymentStatusColor(order.payment_status)}>
              {order.payment_status.replace(/_/g, " ")}
            </Badge>
          </div>
        )}
        <div>
          <Text size="xsmall" className="text-ui-fg-subtle mb-1">Total</Text>
          <Text size="small" weight="plus">
            {formatCurrency(order.total, order.currency_code)}
          </Text>
        </div>
        <div>
          <Text size="xsmall" className="text-ui-fg-subtle mb-1">Created</Text>
          <Text size="small">{formatDate(order.created_at)}</Text>
        </div>
      </div>
    </Container>
  )
}

// ─── Customer Section ───────────────────────────────────────────────────────

const CustomerSection = ({ designOrder }: { designOrder: any }) => {
  const customer = designOrder.customer

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">Customer</Heading>
      </div>
      <div className="px-6 py-4">
        {customer ? (
          <div>
            <Text size="small" weight="plus">
              {customer.first_name} {customer.last_name}
            </Text>
            <Text size="small" className="text-ui-fg-subtle">{customer.email}</Text>
          </div>
        ) : (
          <Text size="small" className="text-ui-fg-subtle">No customer linked</Text>
        )}
      </div>
    </Container>
  )
}

// ─── Checkout Link Section ──────────────────────────────────────────────────

const CheckoutLinkSection = ({ designOrder }: { designOrder: any }) => {
  const checkoutUrl = designOrder.checkout_url

  if (!checkoutUrl) return null

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">Checkout Link</Heading>
      </div>
      <div className="px-6 py-4">
        <Text size="xsmall" className="text-ui-fg-subtle mb-2 truncate block">
          {checkoutUrl}
        </Text>
        <Button
          variant="secondary"
          size="small"
          onClick={() => {
            navigator.clipboard.writeText(checkoutUrl)
            toast.success("Checkout link copied")
          }}
        >
          <SquareTwoStack className="w-4 h-4 mr-1" />
          Copy Checkout Link
        </Button>
      </div>
    </Container>
  )
}

// ─── Design Thumbnail Section ───────────────────────────────────────────────

const DesignThumbnailSection = ({ designOrder }: { designOrder: any }) => {
  if (!designOrder.design.thumbnail_url) return null

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">Design Preview</Heading>
      </div>
      <div className="px-6 py-4">
        <img
          src={designOrder.design.thumbnail_url}
          alt={designOrder.design.name}
          className="w-full rounded-lg object-cover"
        />
      </div>
    </Container>
  )
}

// ─── Page ───────────────────────────────────────────────────────────────────

const DesignOrderDetailPage = () => {
  const { id } = useParams()
  const { designOrder, isLoading, isError, error } = useDesignOrder(id!)

  if (isLoading || !designOrder) {
    return <TwoColumnPageSkeleton mainSections={2} sidebarSections={3} />
  }

  if (isError) throw error

  return (
    <TwoColumnPage data={designOrder} hasOutlet={false} showJSON showMetadata={false}>
      <TwoColumnPage.Main>
        <DesignOrderHeaderSection designOrder={designOrder} />
        <LineItemSection designOrder={designOrder} />
        <OrderSection designOrder={designOrder} />
      </TwoColumnPage.Main>
      <TwoColumnPage.Sidebar>
        <CustomerSection designOrder={designOrder} />
        <CheckoutLinkSection designOrder={designOrder} />
        <DesignThumbnailSection designOrder={designOrder} />
      </TwoColumnPage.Sidebar>
    </TwoColumnPage>
  )
}

export default DesignOrderDetailPage

export const handle = {
  breadcrumb: (match: UIMatch<{ id: string }>) => {
    return match.params.id?.substring(0, 12) + "..."
  },
}

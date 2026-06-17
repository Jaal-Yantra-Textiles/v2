import { useState } from "react"
import { useParams, UIMatch } from "react-router-dom"
import {
  Container,
  Heading,
  Text,
  Badge,
  StatusBadge,
  Button,
  Input,
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
  CurrencyDollar,
  HandTruck,
  Link as LinkIcon,
} from "@medusajs/icons"
import { ActionMenu } from "../../../components/common/action-menu"
import { TwoColumnPage } from "../../../components/pages/two-column-pages"
import { TwoColumnPageSkeleton } from "../../../components/table/skeleton"
import {
  useDesignOrder,
  useApproveDesign,
  useCancelDesignOrder,
  useConvertDesignOrder,
  useGenerateShiprocketLabel,
  useAttachShiprocketAwb,
} from "../../../hooks/api/design-orders"
import {
  PARTNER_STATUS_LABELS,
  getPartnerWorkStatus,
  getStatusBadgeColor,
} from "../../../lib/work-status"

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

const getFulfillmentStatusColor = (status: string): "green" | "blue" | "orange" | "red" | "grey" => {
  switch (status) {
    case "delivered": return "green"
    case "shipped": case "fulfilled": return "blue"
    case "partially_fulfilled": case "partially_shipped": case "partially_delivered": return "orange"
    case "canceled": return "red"
    case "not_fulfilled": default: return "grey"
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
  const isCanceled =
    !!designOrder.order?.canceled_at ||
    designOrder.order?.status === "canceled"

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

// ─── Line Items Section ─────────────────────────────────────────────────────

const LineItemRow = ({ title, price, currencyCode, confidence }: {
  title: string
  price: number
  currencyCode: string
  confidence?: string
}) => (
  <div className="flex items-center justify-between px-6 py-3">
    <div className="flex items-center gap-x-2">
      <Text size="small" weight="plus">{title}</Text>
      {confidence && (
        <Badge
          size="2xsmall"
          color={
            confidence === "exact" ? "green" :
            confidence === "estimated" ? "orange" :
            confidence === "manual" ? "blue" : "red"
          }
        >
          {confidence}
        </Badge>
      )}
    </div>
    <Text size="small" weight="plus">{formatCurrency(price, currencyCode)}</Text>
  </div>
)

const LineItemSection = ({ designOrder }: { designOrder: any }) => {
  const currencyCode = designOrder.currency_code || designOrder.order?.currency_code || "inr"
  const siblings = designOrder.sibling_items || []
  const totalPrice = designOrder.total_price ?? designOrder.price

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Items</Heading>
        <Badge size="2xsmall" color="grey">{1 + siblings.length}</Badge>
      </div>
      <LineItemRow
        title={designOrder.title || designOrder.design.name}
        price={designOrder.price}
        currencyCode={currencyCode}
        confidence={designOrder.metadata?.cost_confidence}
      />
      {siblings.map((item: any) => (
        <LineItemRow
          key={item.line_item_id}
          title={item.design.name}
          price={item.price}
          currencyCode={currencyCode}
          confidence={item.metadata?.cost_confidence}
        />
      ))}
      {siblings.length > 0 && (
        <div className="flex items-center justify-between px-6 py-3 bg-ui-bg-subtle">
          <Text size="small" weight="plus">Total</Text>
          <Text size="small" weight="plus">{formatCurrency(totalPrice, currencyCode)}</Text>
        </div>
      )}
      <div className="grid grid-cols-2 gap-4 px-6 py-3">
        <div>
          <Text size="xsmall" className="text-ui-fg-subtle mb-1">Added</Text>
          <Text size="small">{designOrder.added_at ? formatDate(designOrder.added_at) : "—"}</Text>
        </div>
      </div>
    </Container>
  )
}

// ─── Order Section ──────────────────────────────────────────────────────────

const OrderSection = ({
  designOrder,
  lineItemId,
}: {
  designOrder: any
  lineItemId: string
}) => {
  const order = designOrder.order
  const prompt = usePrompt()
  const { mutateAsync: convert, isPending: isConverting } =
    useConvertDesignOrder(lineItemId)
  const { mutateAsync: genLabel, isPending: isLabeling } =
    useGenerateShiprocketLabel(order?.id ?? "")
  const { mutateAsync: attachAwb, isPending: isAttaching } =
    useAttachShiprocketAwb(order?.id ?? "")
  const [labelUrl, setLabelUrl] = useState<string | null>(null)
  const [attachOpen, setAttachOpen] = useState(false)
  const [awbValue, setAwbValue] = useState("")

  const handleConvert = async (paymentMode: "prepaid" | "cod") => {
    const confirmed = await prompt({
      title: paymentMode === "cod" ? "Convert as COD order?" : "Convert to paid order?",
      description:
        paymentMode === "cod"
          ? "Creates a real order marked unpaid (cash on delivery). It can then be shipped."
          : "Creates a real order and marks it paid. It can then be shipped.",
      confirmText: "Convert",
      cancelText: "Cancel",
    })
    if (!confirmed) return
    await convert(
      { payment_mode: paymentMode },
      {
        onSuccess: (res) =>
          toast.success(
            `Order #${res.design_order_conversion.display_id ?? ""} created (${paymentMode})`
          ),
        onError: (e) => toast.error(e.message),
      }
    )
  }

  if (!order) {
    return (
      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading level="h2">Order</Heading>
        </div>
        <div className="px-6 py-4">
          <Badge size="2xsmall" color="orange">Pending Checkout</Badge>
          <Text size="small" className="text-ui-fg-subtle mt-2 mb-4">
            The customer hasn't checked out. Convert this design order into a
            real order to fulfil and ship it.
          </Text>
          <div className="flex items-center gap-x-2">
            <Button
              variant="primary"
              size="small"
              isLoading={isConverting}
              onClick={() => handleConvert("prepaid")}
            >
              <CurrencyDollar className="w-4 h-4 mr-1" />
              Convert to Paid Order
            </Button>
            <Button
              variant="secondary"
              size="small"
              disabled={isConverting}
              onClick={() => handleConvert("cod")}
            >
              Convert as COD
            </Button>
          </div>
        </div>
      </Container>
    )
  }

  const isCanceled = !!order.canceled_at || order.status === "canceled"

  const handleGenerateLabel = async () => {
    await genLabel(undefined, {
      onSuccess: (res) => {
        setLabelUrl(res.shiprocket_label?.label_url || null)
        toast.success(
          res.shiprocket_label?.awb
            ? `Label generated (AWB ${res.shiprocket_label.awb})`
            : "Shipment created"
        )
      },
      onError: (e) => toast.error(e.message),
    })
  }

  const handleAttachAwb = async () => {
    const awb = awbValue.trim()
    if (!awb) return
    await attachAwb(awb, {
      onSuccess: (res) => {
        const state = res.shiprocket_awb?.synced_state
        toast.success(
          `AWB ${res.shiprocket_awb?.awb} attached${
            state && state !== "pending" ? ` (${state})` : ""
          }`
        )
        setAttachOpen(false)
        setAwbValue("")
      },
      onError: (e) => toast.error(e.message),
    })
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Order #{order.display_id}</Heading>
        <ActionMenu
          groups={[{
            actions: [
              {
                label: "View Order",
                icon: <ShoppingBag />,
                to: `/orders/${order.id}`,
              },
              ...(!isCanceled
                ? [
                    {
                      label: isLabeling ? "Generating…" : "Generate Shipping Label",
                      icon: <HandTruck />,
                      onClick: handleGenerateLabel,
                      disabled: isLabeling,
                    },
                    {
                      label: "Attach existing AWB",
                      icon: <LinkIcon />,
                      onClick: () => setAttachOpen(true),
                      disabled: isAttaching,
                    },
                  ]
                : []),
            ],
          }]}
        />
      </div>
      {attachOpen && (
        <div className="px-6 py-4 bg-ui-bg-subtle">
          <Text size="xsmall" className="text-ui-fg-subtle mb-2">
            Link an AWB already shipped via Shiprocket. Its status is fetched and
            the order is synced to match — no new shipment is created.
          </Text>
          <div className="flex items-center gap-x-2">
            <Input
              placeholder="Shiprocket AWB"
              value={awbValue}
              onChange={(e) => setAwbValue(e.target.value)}
              disabled={isAttaching}
              autoFocus
            />
            <Button
              variant="primary"
              size="small"
              isLoading={isAttaching}
              disabled={!awbValue.trim()}
              onClick={handleAttachAwb}
            >
              Attach
            </Button>
            <Button
              variant="secondary"
              size="small"
              disabled={isAttaching}
              onClick={() => {
                setAttachOpen(false)
                setAwbValue("")
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
      {labelUrl && (
        <div className="px-6 py-3">
          <Button variant="secondary" size="small" asChild>
            <a href={labelUrl} target="_blank" rel="noreferrer">
              <HandTruck className="w-4 h-4 mr-1" />
              Open Shipping Label
            </a>
          </Button>
        </div>
      )}
      {order.tracking?.awb && (
        <div className="px-6 py-3">
          <div className="flex items-center gap-x-2 mb-2">
            <Text size="xsmall" className="text-ui-fg-subtle">Tracking</Text>
            {order.tracking.carrier && (
              <Badge size="2xsmall" color="grey">{order.tracking.carrier}</Badge>
            )}
            {order.tracking.current_status && (
              <Badge size="2xsmall" color="blue">{order.tracking.current_status}</Badge>
            )}
          </div>
          <div className="flex items-center gap-x-2">
            <Text size="small" weight="plus" className="font-mono">{order.tracking.awb}</Text>
            {order.tracking.tracking_url && (
              <Button variant="transparent" size="small" asChild>
                <a href={order.tracking.tracking_url} target="_blank" rel="noreferrer">
                  <HandTruck className="w-4 h-4 mr-1" />
                  Track shipment
                </a>
              </Button>
            )}
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-4 px-6 py-4">
        <div>
          <Text size="xsmall" className="text-ui-fg-subtle mb-1">Status</Text>
          <StatusBadge color={order.status === "completed" ? "green" : order.status === "canceled" ? "red" : "orange"}>
            {order.status}
          </StatusBadge>
        </div>
        {order.fulfillment_status && (
          <div>
            <Text size="xsmall" className="text-ui-fg-subtle mb-1">Fulfillment</Text>
            <StatusBadge color={getFulfillmentStatusColor(order.fulfillment_status)} className="text-nowrap">
              {order.fulfillment_status.replace(/_/g, " ")}
            </StatusBadge>
          </div>
        )}
        {getPartnerWorkStatus(order) && (
          <div>
            <Text size="xsmall" className="text-ui-fg-subtle mb-1">Work status</Text>
            <StatusBadge color={getStatusBadgeColor(getPartnerWorkStatus(order))} className="text-nowrap">
              {PARTNER_STATUS_LABELS[getPartnerWorkStatus(order)!] ?? getPartnerWorkStatus(order)}
            </StatusBadge>
          </div>
        )}
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
        <OrderSection designOrder={designOrder} lineItemId={id!} />
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

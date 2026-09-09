import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Container, Text, Badge, Heading, Skeleton, StatusBadge } from "@medusajs/ui"
import { PencilSquare, SquareTwoStack } from "@medusajs/icons"
import { DetailWidgetProps } from "@medusajs/framework/types"
import { useQuery } from "@tanstack/react-query"
import { sdk } from "../lib/config"
import { ActionMenu } from "../components/common/action-menu"

/**
 * Custom designs on an order — a compact read-only list (#1918).
 *
 * ## Why there is no Approve button here
 *
 * There used to be one. This is the ORDER page: it answers "what did the
 * customer buy and where is it", not "is this drawing good enough to make".
 * Approving a design from here mixed a design-review decision into a commerce
 * screen, where the surrounding context gives no basis for making it.
 *
 * Approval lives on the design and on the design order, which is also where the
 * lines can be re-pointed. This widget's job is to say WHICH designs this order
 * involves, what state each is in, and where to go to act — nothing more.
 */

type DesignType = {
  id: string
  name: string
  status: string
  thumbnail_url?: string
  /** The cart line item its design-order screen is keyed on. May be null. */
  design_order_line_item_id?: string | null
}

type AdminOrder = { id: string }

const statusColor = (
  status: string
): "green" | "blue" | "orange" | "grey" | "red" | "purple" => {
  switch (status) {
    case "Commerce_Ready":
      return "green"
    case "Approved":
      return "blue"
    case "In_Development":
    case "Sample_Production":
      return "orange"
    case "Technical_Review":
      return "purple"
    case "Rejected":
    case "Revision":
      return "red"
    default:
      return "grey"
  }
}

const DesignRow = ({ design }: { design: DesignType }) => (
  <div className="flex items-center justify-between gap-x-3 px-6 py-3">
    <div className="flex min-w-0 items-center gap-x-3">
      {design.thumbnail_url ? (
        <img
          src={design.thumbnail_url}
          alt=""
          className="size-8 shrink-0 rounded object-cover"
        />
      ) : (
        <div className="bg-ui-bg-component size-8 shrink-0 rounded" />
      )}
      <Text size="small" className="truncate">
        {design.name}
      </Text>
    </div>
    <div className="flex shrink-0 items-center gap-x-2">
      <StatusBadge color={statusColor(design.status)}>
        {String(design.status ?? "").replace(/_/g, " ")}
      </StatusBadge>
      <ActionMenu
        groups={[
          {
            actions: [
              {
                label: "View design",
                icon: <PencilSquare />,
                to: `/designs/${design.id}`,
              },
              /*
                Only when we know the cart line item its design-order screen is
                keyed on. A link built from the order or design id would 404,
                and an action that navigates nowhere is worse than none.
              */
              ...(design.design_order_line_item_id
                ? [
                    {
                      label: "Edit lines on the design order",
                      icon: <SquareTwoStack />,
                      to: `/design-orders/${design.design_order_line_item_id}`,
                    },
                  ]
                : []),
            ],
          },
        ]}
      />
    </div>
  </div>
)

const OrderDesignWidget = ({ data: order }: DetailWidgetProps<AdminOrder>) => {
  const { data, isLoading } = useQuery({
    queryFn: () =>
      sdk.client.fetch<{ design: DesignType | null; designs: DesignType[] }>(
        `/admin/orders/${order.id}/design`,
        { method: "GET" }
      ),
    queryKey: ["order-design", order.id],
  })

  const designs = data?.designs || (data?.design ? [data.design] : [])

  // Nothing to say about an order with no designs — an empty card is noise.
  if (!isLoading && designs.length === 0) {
    return null
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Custom designs</Heading>
        {designs.length > 0 && (
          <Badge size="2xsmall" color="grey">
            {designs.length}
          </Badge>
        )}
      </div>
      {isLoading && !designs.length ? (
        <Skeleton className="mx-6 my-4 h-16" />
      ) : (
        <div className="divide-y">
          {designs.map((design) => (
            <DesignRow key={design.id} design={design} />
          ))}
        </div>
      )}
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "order.details.side.before",
})

export default OrderDesignWidget

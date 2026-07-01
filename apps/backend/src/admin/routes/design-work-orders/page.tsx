import { defineRouteConfig } from "@medusajs/admin-sdk"
import { SquareTwoStack, ShoppingBag } from "@medusajs/icons"
import { Badge, Button, Container, Heading, StatusBadge, Text } from "@medusajs/ui"
import { Link } from "react-router-dom"

import { useDesignWorkOrders } from "../../hooks/api/design-work-orders"
import { ProductionRunList } from "../../components/designs/design-order-production-section"

const statusColor = (s: string): "green" | "red" | "orange" =>
  s === "completed" ? "green" : s === "canceled" ? "red" : "orange"

const fmtDate = (d?: string) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "—"

/**
 * #826 — admin management view for COLLATED design work-orders, including the
 * no-customer "Send to Production" ones that have no cart/design-order and so
 * never show in the cart-grouped Design Orders list. Each order lists its
 * per-design runs (status + stepper + "Now → Partner's next"); lifecycle
 * actions deep-link to /production-runs/:id.
 */
const DesignWorkOrdersPage = () => {
  const { design_work_orders, designs, partners, count, isLoading } =
    useDesignWorkOrders({ limit: 50 })

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <Heading level="h1">Design Work Orders</Heading>
            <Text size="small" className="text-ui-fg-subtle mt-1">
              Collated orders sent to production (one order, many designs) —
              including those produced without a customer.
            </Text>
          </div>
          {count > 0 && (
            <Badge size="2xsmall" color="grey">
              {count}
            </Badge>
          )}
        </div>
      </Container>

      {isLoading && (
        <Container className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">
            Loading…
          </Text>
        </Container>
      )}

      {!isLoading && design_work_orders.length === 0 && (
        <Container className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">
            No design work orders yet. Produce a design order or use "Send to
            Production" from the Designs list.
          </Text>
        </Container>
      )}

      {design_work_orders.map((wo) => (
        <Container className="divide-y p-0" key={wo.id}>
          <div className="flex flex-wrap items-center justify-between gap-2 px-6 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <Heading level="h2">Order #{wo.display_id}</Heading>
              <Badge size="2xsmall" color="blue">
                {wo.design_count} design{wo.design_count === 1 ? "" : "s"}
              </Badge>
              <StatusBadge color={statusColor(wo.status)}>{wo.status}</StatusBadge>
              {wo.partner_status && (
                <Badge size="2xsmall" color="grey">
                  {wo.partner_status.replace(/_/g, " ")}
                </Badge>
              )}
              {wo.source_order_id ? (
                <Badge size="2xsmall" color="grey">
                  Commissioned
                </Badge>
              ) : (
                <Badge size="2xsmall" color="orange">
                  Direct (no customer)
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-x-3">
              <Text size="xsmall" className="text-ui-fg-subtle">
                {fmtDate(wo.created_at)}
              </Text>
              <Button size="small" variant="secondary" asChild>
                <Link to={`/orders/${wo.id}`}>
                  <ShoppingBag />
                  View order
                </Link>
              </Button>
            </div>
          </div>
          <ProductionRunList
            runs={wo.runs}
            designById={designs}
            partnerNameById={partners}
            currencyCode={wo.currency_code}
          />
        </Container>
      ))}
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Design Work Orders",
  icon: SquareTwoStack,
})

export default DesignWorkOrdersPage

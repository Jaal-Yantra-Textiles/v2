/**
 * Partner inspection mirror (#843, approach #2) — the read-only "what's going
 * on with this partner" view, rendered from the admin read-proxy routes rather
 * than from admin's own order tables, so it shows the partner's scoping (their
 * sales channel for retail, their work-order links for design/inventory).
 *
 * Read-only by construction: no action menus, no mutations. Acting on a
 * partner's behalf is the separate audited-impersonation track.
 */
import { Badge, Container, Heading, Table, Tabs, Text } from "@medusajs/ui"
import { useState } from "react"
import { Link } from "react-router-dom"
import { Skeleton } from "../table/skeleton"
import {
  PartnerOrderKind,
  usePartnerInspectionOrders,
  usePartnerOnboardingProfile,
} from "../../hooks/api/partner-inspection"

interface PartnerInspectionSectionProps {
  partnerId: string
}

const KINDS: { value: PartnerOrderKind; label: string }[] = [
  { value: "retail", label: "Retail" },
  { value: "design", label: "Design" },
  { value: "inventory", label: "Inventory" },
  { value: "all", label: "All" },
]

const PAGE_SIZE = 10

const formatTotal = (total?: number, currency?: string) => {
  if (typeof total !== "number") {
    return "—"
  }
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: (currency || "usd").toUpperCase(),
    }).format(total)
  } catch {
    return `${total} ${(currency || "").toUpperCase()}`.trim()
  }
}

const statusColor = (status?: string) => {
  switch (status) {
    case "completed":
    case "captured":
    case "fulfilled":
      return "green" as const
    case "canceled":
      return "red" as const
    case "pending":
    case "not_fulfilled":
      return "orange" as const
    default:
      return "grey" as const
  }
}

export const PartnerInspectionSection = ({
  partnerId,
}: PartnerInspectionSectionProps) => {
  const [kind, setKind] = useState<PartnerOrderKind>("retail")

  const { orders, count, isLoading, isError, error } =
    usePartnerInspectionOrders(partnerId, { kind, limit: PAGE_SIZE })

  const { onboardingProfile, isLoading: isProfileLoading } =
    usePartnerOnboardingProfile(partnerId)

  if (isError) {
    throw error
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-2">
          <Heading level="h2">Inspect</Heading>
          {count > 0 && (
            <Badge size="2xsmall" color="grey">
              {count}
            </Badge>
          )}
        </div>
        <Text size="small" className="text-ui-fg-muted">
          Read-only — as the partner sees it
        </Text>
      </div>

      <div className="px-6 py-4">
        <Tabs value={kind} onValueChange={(v) => setKind(v as PartnerOrderKind)}>
          <Tabs.List>
            {KINDS.map((k) => (
              <Tabs.Trigger key={k.value} value={k.value}>
                {k.label}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
        </Tabs>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-y-2 px-6 py-4">
          <Skeleton className="h-8 w-full rounded-md" />
          <Skeleton className="h-8 w-full rounded-md" />
          <Skeleton className="h-8 w-full rounded-md" />
        </div>
      ) : orders.length === 0 ? (
        <div className="px-6 py-8 text-center">
          <Text size="small" className="text-ui-fg-muted">
            No {kind === "all" ? "" : `${kind} `}orders for this partner
          </Text>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table className="w-full">
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Order</Table.HeaderCell>
                <Table.HeaderCell>Customer</Table.HeaderCell>
                <Table.HeaderCell>Status</Table.HeaderCell>
                <Table.HeaderCell>Payment</Table.HeaderCell>
                <Table.HeaderCell>Fulfillment</Table.HeaderCell>
                <Table.HeaderCell className="text-right">Total</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {orders.map((order) => (
                <Table.Row key={order.id}>
                  <Table.Cell>
                    <Link
                      to={`/orders/${order.id}`}
                      className="text-ui-fg-interactive"
                    >
                      #{order.custom_display_id || order.display_id || order.id}
                    </Link>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="small" className="text-ui-fg-subtle">
                      {order.customer
                        ? [order.customer.first_name, order.customer.last_name]
                            .filter(Boolean)
                            .join(" ") ||
                          order.customer.email ||
                          "—"
                        : order.email || "—"}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Badge size="2xsmall" color={statusColor(order.status)}>
                      {order.unified_order_status?.partner_status ||
                        order.status ||
                        "—"}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell>
                    <Badge
                      size="2xsmall"
                      color={statusColor(order.payment_status)}
                    >
                      {order.payment_status || "—"}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell>
                    <Badge
                      size="2xsmall"
                      color={statusColor(order.fulfillment_status)}
                    >
                      {order.fulfillment_status || "—"}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell className="text-right">
                    <Text size="small">
                      {formatTotal(order.total, order.currency_code)}
                    </Text>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </div>
      )}

      <div className="px-6 py-4">
        <Text size="small" weight="plus" className="mb-2">
          Onboarding profile
        </Text>
        {isProfileLoading ? (
          <Skeleton className="h-8 w-full rounded-md" />
        ) : !onboardingProfile ? (
          <Text size="small" className="text-ui-fg-muted">
            Not started — this partner has never saved the onboarding
            questionnaire.
          </Text>
        ) : (
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {Object.entries(onboardingProfile)
              .filter(
                ([key, value]) =>
                  !["id", "partner_id", "created_at", "updated_at", "deleted_at"].includes(
                    key
                  ) &&
                  value !== null &&
                  value !== undefined &&
                  value !== ""
              )
              .map(([key, value]) => (
                <div key={key} className="flex flex-col">
                  <Text size="xsmall" className="text-ui-fg-muted">
                    {key.replace(/_/g, " ")}
                  </Text>
                  <Text size="small" className="text-ui-fg-subtle">
                    {typeof value === "object"
                      ? JSON.stringify(value)
                      : String(value)}
                  </Text>
                </div>
              ))}
          </div>
        )}
      </div>
    </Container>
  )
}

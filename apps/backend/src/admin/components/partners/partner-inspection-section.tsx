/**
 * Partner inspection mirror (#843, approach #2) — the read-only "what's going
 * on with this partner" view, rendered from the admin read-proxy routes rather
 * than from admin's own tables, so it shows the partner's scoping (their sales
 * channel for retail, their work-order links for design/inventory, their own
 * design assignments and production runs).
 *
 * Read-only by construction: no action menus, no mutations. Acting on a
 * partner's behalf is the separate audited-impersonation track.
 *
 * The top-level tabs are the SURFACE (orders / designs / runs / products); the
 * order-kind discriminator is a sub-tab of Orders, since it only means anything
 * there.
 */
import { Badge, Container, Heading, Table, Tabs, Text } from "@medusajs/ui"
import { useState } from "react"
import { Link } from "react-router-dom"
import { Skeleton } from "../table/skeleton"
import {
  PartnerDesignBucket,
  PartnerOrderKind,
  usePartnerInspectionDesigns,
  usePartnerInspectionOrders,
  usePartnerInspectionProductionRuns,
  usePartnerInspectionProducts,
  usePartnerInspectionInventoryItems,
  usePartnerInspectionInventoryOrders,
  usePartnerOnboardingProfile,
} from "../../hooks/api/partner-inspection"

interface PartnerInspectionSectionProps {
  partnerId: string
}

type InspectionSurface =
  | "orders"
  | "designs"
  | "runs"
  | "products"
  | "inventory"

const SURFACES: { value: InspectionSurface; label: string }[] = [
  { value: "orders", label: "Orders" },
  { value: "designs", label: "Designs" },
  { value: "runs", label: "Production runs" },
  { value: "products", label: "Products" },
  { value: "inventory", label: "Inventory" },
]

/** Inventory splits two ways the partner portal itself splits them. */
type InventoryView = "items" | "orders"

const INVENTORY_VIEWS: { value: InventoryView; label: string }[] = [
  { value: "items", label: "Stock" },
  { value: "orders", label: "Inventory orders" },
]

const KINDS: { value: PartnerOrderKind; label: string }[] = [
  { value: "retail", label: "Retail" },
  { value: "design", label: "Design" },
  { value: "inventory", label: "Inventory" },
  { value: "all", label: "All" },
]

const BUCKETS: { value: PartnerDesignBucket; label: string }[] = [
  { value: "all", label: "All" },
  { value: "incoming", label: "Incoming" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "yours", label: "Theirs" },
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

const formatDate = (value?: string | null) =>
  value ? new Date(value).toLocaleDateString() : "—"

const statusColor = (status?: string) => {
  switch (status) {
    case "completed":
    case "captured":
    case "fulfilled":
      return "green" as const
    case "canceled":
    case "cancelled":
    case "rejected":
      return "red" as const
    case "pending":
    case "not_fulfilled":
    case "incoming":
    case "assigned":
      return "orange" as const
    case "in_progress":
    case "awaiting_review":
      return "blue" as const
    default:
      return "grey" as const
  }
}

const EmptyRow = ({ children }: { children: React.ReactNode }) => (
  <div className="px-6 py-8 text-center">
    <Text size="small" className="text-ui-fg-muted">
      {children}
    </Text>
  </div>
)

const LoadingRows = () => (
  <div className="flex flex-col gap-y-2 px-6 py-4">
    <Skeleton className="h-8 w-full rounded-md" />
    <Skeleton className="h-8 w-full rounded-md" />
    <Skeleton className="h-8 w-full rounded-md" />
  </div>
)

const OrdersPanel = ({ partnerId }: { partnerId: string }) => {
  const [kind, setKind] = useState<PartnerOrderKind>("retail")
  const { orders, isLoading, isError, error } = usePartnerInspectionOrders(
    partnerId,
    { kind, limit: PAGE_SIZE }
  )

  if (isError) {
    throw error
  }

  return (
    <>
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
        <LoadingRows />
      ) : orders.length === 0 ? (
        <EmptyRow>
          No {kind === "all" ? "" : `${kind} `}orders for this partner
        </EmptyRow>
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
    </>
  )
}

const DesignsPanel = ({ partnerId }: { partnerId: string }) => {
  const [bucket, setBucket] = useState<PartnerDesignBucket>("all")
  const { designs, facets, isLoading, isError, error } =
    usePartnerInspectionDesigns(partnerId, { bucket, limit: PAGE_SIZE })

  if (isError) {
    throw error
  }

  return (
    <>
      <div className="px-6 py-4">
        <Tabs
          value={bucket}
          onValueChange={(v) => setBucket(v as PartnerDesignBucket)}
        >
          <Tabs.List>
            {BUCKETS.map((b) => (
              <Tabs.Trigger key={b.value} value={b.value}>
                {b.label}
                {facets?.[b.value] ? (
                  <Badge size="2xsmall" color="grey" className="ml-2">
                    {facets[b.value]}
                  </Badge>
                ) : null}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
        </Tabs>
      </div>

      {isLoading ? (
        <LoadingRows />
      ) : designs.length === 0 ? (
        <EmptyRow>No designs in this view for this partner</EmptyRow>
      ) : (
        <div className="overflow-x-auto">
          <Table className="w-full">
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Design</Table.HeaderCell>
                <Table.HeaderCell>Source</Table.HeaderCell>
                <Table.HeaderCell>Partner status</Table.HeaderCell>
                <Table.HeaderCell>Design status</Table.HeaderCell>
                <Table.HeaderCell className="text-right">
                  Started
                </Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {designs.map((design) => (
                <Table.Row key={design.id}>
                  <Table.Cell>
                    <Link
                      to={`/designs/${design.id}`}
                      className="text-ui-fg-interactive"
                    >
                      {design.name || design.id}
                    </Link>
                  </Table.Cell>
                  <Table.Cell>
                    {/* Keyed on the per-viewer `is_owner` the proxy carries
                        through, never a bare owner_partner_id truthiness
                        check — that mislabels another partner's design as
                        theirs (#920). */}
                    <Badge
                      size="2xsmall"
                      color={design.is_owner ? "blue" : "grey"}
                    >
                      {design.is_owner ? "Theirs" : "Assigned"}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell>
                    <Badge
                      size="2xsmall"
                      color={statusColor(design.partner_info?.partner_status)}
                    >
                      {design.partner_info?.partner_status || "—"}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="small" className="text-ui-fg-subtle">
                      {design.status || "—"}
                    </Text>
                  </Table.Cell>
                  <Table.Cell className="text-right">
                    <Text size="small" className="text-ui-fg-subtle">
                      {formatDate(design.partner_info?.partner_started_at)}
                    </Text>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </div>
      )}
    </>
  )
}

const ProductionRunsPanel = ({ partnerId }: { partnerId: string }) => {
  const { productionRuns, isLoading, isError, error } =
    usePartnerInspectionProductionRuns(partnerId, { limit: PAGE_SIZE })

  if (isError) {
    throw error
  }

  if (isLoading) {
    return <LoadingRows />
  }

  if (productionRuns.length === 0) {
    return <EmptyRow>No production runs assigned to this partner</EmptyRow>
  }

  return (
    <div className="overflow-x-auto">
      <Table className="w-full">
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>Run</Table.HeaderCell>
            <Table.HeaderCell>Type</Table.HeaderCell>
            <Table.HeaderCell>Role</Table.HeaderCell>
            <Table.HeaderCell>Status</Table.HeaderCell>
            <Table.HeaderCell className="text-right">Qty</Table.HeaderCell>
            <Table.HeaderCell className="text-right">Created</Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {productionRuns.map((run) => (
            <Table.Row key={run.id}>
              <Table.Cell>
                <Link
                  to={`/production-runs/${run.id}`}
                  className="text-ui-fg-interactive"
                >
                  {run.id}
                </Link>
              </Table.Cell>
              <Table.Cell>
                <Text size="small" className="text-ui-fg-subtle">
                  {run.run_type || "—"}
                </Text>
              </Table.Cell>
              <Table.Cell>
                <Text size="small" className="text-ui-fg-subtle">
                  {run.role || "—"}
                </Text>
              </Table.Cell>
              <Table.Cell>
                <Badge size="2xsmall" color={statusColor(run.status)}>
                  {run.status || "—"}
                </Badge>
              </Table.Cell>
              <Table.Cell className="text-right">
                <Text size="small" className="text-ui-fg-subtle">
                  {typeof run.produced_quantity === "number" &&
                  typeof run.quantity === "number"
                    ? `${run.produced_quantity}/${run.quantity}`
                    : (run.quantity ?? "—")}
                </Text>
              </Table.Cell>
              <Table.Cell className="text-right">
                <Text size="small" className="text-ui-fg-subtle">
                  {formatDate(run.created_at)}
                </Text>
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>
    </div>
  )
}

const ProductsPanel = ({ partnerId }: { partnerId: string }) => {
  const { products, storeId, isLoading, isError, error } =
    usePartnerInspectionProducts(partnerId)

  if (isError) {
    throw error
  }

  if (isLoading) {
    return <LoadingRows />
  }

  // No store at all is a different fact from an empty catalog, and it is the
  // one an operator can act on (it's what the onboarding flow fixes) — so say
  // which it is rather than showing the same "nothing here" for both.
  if (!storeId) {
    return (
      <EmptyRow>
        This partner has not provisioned a store yet — no catalog to show.
      </EmptyRow>
    )
  }

  if (products.length === 0) {
    return <EmptyRow>No products in this partner&apos;s store</EmptyRow>
  }

  return (
    <div className="overflow-x-auto">
      <Table className="w-full">
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>Product</Table.HeaderCell>
            <Table.HeaderCell>Handle</Table.HeaderCell>
            <Table.HeaderCell>Status</Table.HeaderCell>
            <Table.HeaderCell>Collection</Table.HeaderCell>
            <Table.HeaderCell className="text-right">Variants</Table.HeaderCell>
            <Table.HeaderCell className="text-right">Created</Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {products.map((product) => (
            <Table.Row key={product.id}>
              <Table.Cell>
                <Link
                  to={`/products/${product.id}`}
                  className="text-ui-fg-interactive"
                >
                  {product.title || product.id}
                </Link>
              </Table.Cell>
              <Table.Cell>
                <Text size="small" className="text-ui-fg-subtle">
                  {product.handle || "—"}
                </Text>
              </Table.Cell>
              <Table.Cell>
                <Badge size="2xsmall" color={statusColor(product.status)}>
                  {product.status || "—"}
                </Badge>
              </Table.Cell>
              <Table.Cell>
                <Text size="small" className="text-ui-fg-subtle">
                  {product.collection?.title || "—"}
                </Text>
              </Table.Cell>
              <Table.Cell className="text-right">
                <Text size="small" className="text-ui-fg-subtle">
                  {product.variants?.length ?? 0}
                </Text>
              </Table.Cell>
              <Table.Cell className="text-right">
                <Text size="small" className="text-ui-fg-subtle">
                  {formatDate(product.created_at)}
                </Text>
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>
    </div>
  )
}

const InventoryItemsTable = ({ partnerId }: { partnerId: string }) => {
  const { inventoryItems, isLoading, isError, error } =
    usePartnerInspectionInventoryItems(partnerId, { limit: PAGE_SIZE })

  if (isError) {
    throw error
  }

  if (isLoading) {
    return <LoadingRows />
  }

  if (inventoryItems.length === 0) {
    return <EmptyRow>No stock at this partner&apos;s location</EmptyRow>
  }

  return (
    <div className="overflow-x-auto">
      <Table className="w-full">
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>Item</Table.HeaderCell>
            <Table.HeaderCell>SKU</Table.HeaderCell>
            <Table.HeaderCell className="text-right">Stocked</Table.HeaderCell>
            <Table.HeaderCell className="text-right">Reserved</Table.HeaderCell>
            <Table.HeaderCell className="text-right">Incoming</Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {inventoryItems.map((item) => (
            <Table.Row key={item.id}>
              <Table.Cell>
                <Link
                  to={`/inventory/${item.id}`}
                  className="text-ui-fg-interactive"
                >
                  {item.title || item.sku || item.id}
                </Link>
              </Table.Cell>
              <Table.Cell>
                <Text size="small" className="text-ui-fg-subtle">
                  {item.sku || "—"}
                </Text>
              </Table.Cell>
              {/* Quantities are aggregated over the partner's location only —
                  the global figure would be a different (and misleading)
                  number here. */}
              <Table.Cell className="text-right">
                <Text size="small">{item.stocked_quantity ?? 0}</Text>
              </Table.Cell>
              <Table.Cell className="text-right">
                <Text size="small" className="text-ui-fg-subtle">
                  {item.reserved_quantity ?? 0}
                </Text>
              </Table.Cell>
              <Table.Cell className="text-right">
                <Text size="small" className="text-ui-fg-subtle">
                  {item.incoming_quantity ?? 0}
                </Text>
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>
    </div>
  )
}

const InventoryOrdersTable = ({ partnerId }: { partnerId: string }) => {
  const { inventoryOrders, isLoading, isError, error } =
    usePartnerInspectionInventoryOrders(partnerId, { limit: PAGE_SIZE })

  if (isError) {
    throw error
  }

  if (isLoading) {
    return <LoadingRows />
  }

  if (inventoryOrders.length === 0) {
    return <EmptyRow>No inventory orders assigned to this partner</EmptyRow>
  }

  return (
    <div className="overflow-x-auto">
      <Table className="w-full">
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>Order</Table.HeaderCell>
            <Table.HeaderCell>Location</Table.HeaderCell>
            <Table.HeaderCell>Partner status</Table.HeaderCell>
            <Table.HeaderCell>Order status</Table.HeaderCell>
            <Table.HeaderCell className="text-right">Qty</Table.HeaderCell>
            <Table.HeaderCell className="text-right">Expected</Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {inventoryOrders.map((order) => (
            <Table.Row key={order.id}>
              <Table.Cell>
                <Link
                  to={`/inventory-orders/${order.id}`}
                  className="text-ui-fg-interactive"
                >
                  {order.id}
                </Link>
              </Table.Cell>
              <Table.Cell>
                <Text size="small" className="text-ui-fg-subtle">
                  {order.stock_location || "—"}
                </Text>
              </Table.Cell>
              <Table.Cell>
                {/* Derived from the partner_assignment tasks — this is the
                    column an operator opens this surface for. */}
                <Badge
                  size="2xsmall"
                  color={statusColor(order.partner_info?.partner_status)}
                >
                  {order.partner_info?.partner_status || "—"}
                </Badge>
              </Table.Cell>
              <Table.Cell>
                <Text size="small" className="text-ui-fg-subtle">
                  {order.status || "—"}
                </Text>
              </Table.Cell>
              <Table.Cell className="text-right">
                <Text size="small" className="text-ui-fg-subtle">
                  {order.quantity ?? "—"}
                </Text>
              </Table.Cell>
              <Table.Cell className="text-right">
                <Text size="small" className="text-ui-fg-subtle">
                  {formatDate(order.expected_delivery_date)}
                </Text>
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>
    </div>
  )
}

const InventoryPanel = ({ partnerId }: { partnerId: string }) => {
  const [view, setView] = useState<InventoryView>("items")

  return (
    <>
      <div className="px-6 py-4">
        <Tabs value={view} onValueChange={(v) => setView(v as InventoryView)}>
          <Tabs.List>
            {INVENTORY_VIEWS.map((v) => (
              <Tabs.Trigger key={v.value} value={v.value}>
                {v.label}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
        </Tabs>
      </div>

      {view === "items" ? (
        <InventoryItemsTable partnerId={partnerId} />
      ) : (
        <InventoryOrdersTable partnerId={partnerId} />
      )}
    </>
  )
}

export const PartnerInspectionSection = ({
  partnerId,
}: PartnerInspectionSectionProps) => {
  const [surface, setSurface] = useState<InspectionSurface>("orders")

  const { onboardingProfile, isLoading: isProfileLoading } =
    usePartnerOnboardingProfile(partnerId)

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Inspect</Heading>
        <Text size="small" className="text-ui-fg-muted">
          Read-only — as the partner sees it
        </Text>
      </div>

      <div className="px-6 py-4">
        <Tabs
          value={surface}
          onValueChange={(v) => setSurface(v as InspectionSurface)}
        >
          <Tabs.List>
            {SURFACES.map((s) => (
              <Tabs.Trigger key={s.value} value={s.value}>
                {s.label}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
        </Tabs>
      </div>

      {/* Each panel owns its own query, so switching surfaces doesn't refetch
          the others and an error in one can't blank the whole section. */}
      {surface === "orders" && <OrdersPanel partnerId={partnerId} />}
      {surface === "designs" && <DesignsPanel partnerId={partnerId} />}
      {surface === "runs" && <ProductionRunsPanel partnerId={partnerId} />}
      {surface === "products" && <ProductsPanel partnerId={partnerId} />}
      {surface === "inventory" && <InventoryPanel partnerId={partnerId} />}

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

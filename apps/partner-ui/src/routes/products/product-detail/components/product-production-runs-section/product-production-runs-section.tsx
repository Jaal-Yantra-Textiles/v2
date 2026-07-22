import { Badge, Container, Heading, StatusBadge, Text } from "@medusajs/ui"
import { useNavigate } from "react-router-dom"

// #1124 — mirror of the admin product "Production Runs" provenance trail on the
// partner product page: the runs that produced this product's sold-and-fulfilled
// stock (#1112 product-as-spine link). Product-only runs (design_id null) are
// the retail-fulfillment provenance; design-backed runs already surface under
// their design elsewhere, so they're excluded here to avoid double-listing.

type ProductionRun = {
  id: string
  status?: string | null
  order_id?: string | null
  design_id?: string | null
  quantity?: number | null
  produced_quantity?: number | null
}

type Props = {
  product: { production_runs?: ProductionRun[] } & Record<string, any>
}

const RUN_STATUS_COLOR: Record<string, "green" | "orange" | "grey" | "red"> = {
  completed: "green",
  in_progress: "orange",
  pending_review: "grey",
  draft: "grey",
  cancelled: "red",
}

const runStatusLabel = (status: string) =>
  status ? status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "—"

export const ProductProductionRunsSection = ({ product }: Props) => {
  const navigate = useNavigate()

  const productOnly = (product.production_runs || []).filter(
    (r) => !r.design_id
  )
  if (!productOnly.length) {
    return null
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center gap-x-2 px-6 py-4">
        <Heading level="h2">Production Runs</Heading>
        <Badge size="2xsmall" color="grey">
          {productOnly.length}
        </Badge>
        <Text size="small" className="text-ui-fg-muted">
          from fulfilled orders
        </Text>
      </div>

      <div className="px-6 py-4">
        <div className="flex flex-col divide-y divide-ui-border-base rounded-lg border border-ui-border-base overflow-hidden">
          <div className="grid grid-cols-3 px-3 py-1.5 bg-ui-bg-subtle">
            <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">
              Status
            </Text>
            <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">
              Order
            </Text>
            <Text
              size="xsmall"
              weight="plus"
              className="text-ui-fg-subtle text-right"
            >
              Produced
            </Text>
          </div>
          {productOnly.map((run) => (
            <div
              key={run.id}
              className="grid grid-cols-3 px-3 py-2 items-center"
            >
              <StatusBadge
                color={RUN_STATUS_COLOR[run.status ?? ""] ?? "grey"}
              >
                {runStatusLabel(run.status ?? "")}
              </StatusBadge>
              {run.order_id ? (
                <button
                  type="button"
                  onClick={() => navigate(`/orders/${run.order_id}`)}
                  className="text-left"
                >
                  <Text
                    size="xsmall"
                    className="text-ui-fg-interactive truncate"
                  >
                    {run.order_id.slice(0, 14)}…
                  </Text>
                </button>
              ) : (
                <Text size="xsmall" className="text-ui-fg-muted">
                  —
                </Text>
              )}
              <Text size="xsmall" className="text-right">
                {(run.produced_quantity ?? run.quantity ?? 0).toLocaleString()}
              </Text>
            </div>
          ))}
        </div>
      </div>
    </Container>
  )
}

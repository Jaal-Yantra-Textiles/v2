import { Badge, Container, Heading, Skeleton, Text } from "@medusajs/ui"
import { Link } from "react-router-dom"

import {
  AdminProductionRun,
  useProductionRuns,
} from "../../hooks/api/production-runs"
import { productionRunStatusColor as statusColor } from "../../lib/status-colors"

interface ProductionRunChildrenSectionProps {
  parentId: string
}

const formatStatus = (s?: string) => String(s || "-").replace(/_/g, " ")

export const ProductionRunChildrenSection = ({
  parentId,
}: ProductionRunChildrenSectionProps) => {
  const { production_runs, isLoading } = useProductionRuns({
    parent_run_id: parentId,
    limit: 100,
    offset: 0,
  })

  const children = (production_runs || []) as AdminProductionRun[]

  const total = children.length
  const dispatched = children.filter((c: any) =>
    ["sent_to_partner", "accepted", "in_progress"].includes(String(c.status))
  ).length
  const completed = children.filter((c: any) => c.status === "completed").length

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex flex-col gap-y-0.5">
          <Heading level="h2">Sub-runs</Heading>
          <Text size="xsmall" className="text-ui-fg-subtle">
            Dispatch happens on each sub-run. Open one to see its partner and tasks.
          </Text>
        </div>
        {!isLoading && total > 0 && (
          <Text size="small" className="text-ui-fg-subtle">
            {completed} completed · {dispatched} in flight · {total} total
          </Text>
        )}
      </div>

      <div className="px-3 py-3">
        {isLoading ? (
          <Skeleton className="h-7 w-full" />
        ) : !children.length ? (
          <div className="flex items-center justify-center py-4">
            <Text className="text-ui-fg-subtle" size="small">
              No sub-runs yet
            </Text>
          </div>
        ) : (
          <div className="flex flex-col gap-y-2">
            {children.map((child: any) => {
              const status = String(child.status || "-")
              const dispatchState = String(child.dispatch_state || "idle")
              const partnerName =
                child.snapshot?.provenance?.partner_name || child.partner_id || "No partner"
              return (
                <Link
                  key={String(child.id)}
                  to={`/production-runs/${child.id}`}
                  className="outline-none focus-within:shadow-borders-interactive-with-focus rounded-md [&:hover>div]:bg-ui-bg-component-hover"
                >
                  <div className="shadow-elevation-card-rest bg-ui-bg-component rounded-md px-4 py-3 transition-colors flex items-center justify-between gap-3">
                    <div className="flex flex-col overflow-hidden">
                      <span className="text-ui-fg-base font-medium truncate">
                        {child.run_type === "sample" ? "Sample" : "Production"} sub-run
                      </span>
                      <span className="text-ui-fg-subtle text-xs truncate">
                        {partnerName}
                        {child.quantity != null ? ` · Qty: ${child.quantity}` : ""}
                        {dispatchState !== "idle" ? ` · dispatch: ${dispatchState}` : ""}
                      </span>
                    </div>
                    <Badge color={statusColor(status)}>{formatStatus(status)}</Badge>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </Container>
  )
}

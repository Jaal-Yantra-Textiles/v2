import { Container, Heading, Skeleton, Text, Badge, Button, toast } from "@medusajs/ui"
import { Link } from "react-router-dom"

import { AdminDesign } from "../../hooks/api/designs"
import { useProductionRuns, useCancelProductionRun } from "../../hooks/api/production-runs"
import { productionRunStatusColor as statusColor } from "../../lib/status-colors"

interface DesignProductionRunsSectionProps {
  design: AdminDesign
}

export const DesignProductionRunsSection = ({ design }: DesignProductionRunsSectionProps) => {
  const { production_runs, isLoading } = useProductionRuns({
    design_id: design.id,
    limit: 50,
    offset: 0,
  })

  const runs = production_runs || []

  return (
    <Container className="p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Production Runs</Heading>
          <Text className="text-ui-fg-subtle" size="small">
            Runs created for this design
          </Text>
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-7 w-full" />
      ) : (
        <div className="txt-small flex flex-col gap-3 px-3 pb-4">
          {!runs.length ? (
            <div className="flex items-center justify-center py-4 w-full">
              <Text className="text-ui-fg-subtle">No production runs yet</Text>
            </div>
          ) : (
            runs.map((run: any) => (
              <ProductionRunRow key={String(run.id)} run={run} />
            ))
          )}
        </div>
      )}
    </Container>
  )
}

const ProductionRunRow = ({ run }: { run: any }) => {
  const id = String(run.id)
  const status = String(run.status || "-")
  const partnerId = run.partner_id ? String(run.partner_id) : "-"
  const quantity = run.quantity ?? "-"
  const canCancel = !["completed", "cancelled"].includes(status)

  const cancelRun = useCancelProductionRun(id)

  const handleCancel = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    try {
      await cancelRun.mutateAsync({ reason: "Admin cancelled from design page" })
      toast.success("Production run cancelled")
    } catch (err: any) {
      toast.error(err?.message || "Failed to cancel")
    }
  }

  return (
    <Link
      to={`/production-runs/${id}`}
      className="outline-none focus-within:shadow-borders-interactive-with-focus rounded-md [&:hover>div]:bg-ui-bg-component-hover"
    >
      <div className="shadow-elevation-card-rest bg-ui-bg-component rounded-md px-4 py-3 transition-colors">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col overflow-hidden">
            <span className="text-ui-fg-base font-medium truncate">
              {run.run_type === "sample" ? "Sample" : "Production"} Run
            </span>
            <span className="text-ui-fg-subtle text-xs truncate">
              {partnerId !== "-" ? `Partner: ${partnerId}` : "No partner assigned"}
              {quantity !== "-" ? ` · Qty: ${quantity}` : ""}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Badge color={statusColor(status)}>{status.replace(/_/g, " ")}</Badge>
            {canCancel && (
              <Button
                size="small"
                variant="danger"
                isLoading={cancelRun.isPending}
                onClick={handleCancel}
              >
                Cancel
              </Button>
            )}
          </div>
        </div>
      </div>
    </Link>
  )
}

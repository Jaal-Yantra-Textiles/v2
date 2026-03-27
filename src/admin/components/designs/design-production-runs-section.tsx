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

  const isInReview = design.status === "Technical_Review"

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

      {/* Review banner */}
      {isInReview && (
        <div className="mx-3 mb-3 rounded-md border border-ui-border-base bg-ui-bg-subtle px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <Text size="small" weight="plus" className="text-ui-fg-base">
                Awaiting Review
              </Text>
              <Text size="xsmall" className="text-ui-fg-subtle">
                Partner has marked work as finished. Review the notes below and approve when ready.
              </Text>
            </div>
            <Link to="edit">
              <Button size="small">
                Approve Design
              </Button>
            </Link>
          </div>
        </div>
      )}

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

  const finishNotes = run.finish_notes || run.metadata?.finish_notes
  const completionNotes = run.completion_notes || run.metadata?.completion_notes
  const partnerCost = run.partner_cost_estimate || run.metadata?.partner_cost_estimate
  const hasReviewInfo = finishNotes || completionNotes || partnerCost

  return (
    <div className="rounded-md shadow-elevation-card-rest bg-ui-bg-component transition-colors">
      <Link
        to={`/production-runs/${id}`}
        className="outline-none focus-within:shadow-borders-interactive-with-focus [&:hover>div]:bg-ui-bg-component-hover"
      >
        <div className="px-4 py-3">
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

      {/* Review info — shown when partner has submitted notes/cost */}
      {hasReviewInfo && (
        <div className="border-t px-4 py-2">
          {finishNotes && (
            <div className="mb-1">
              <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">Finish Notes</Text>
              <Text size="xsmall">{finishNotes}</Text>
            </div>
          )}
          {completionNotes && (
            <div className="mb-1">
              <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">Completion Notes</Text>
              <Text size="xsmall">{completionNotes}</Text>
            </div>
          )}
          {partnerCost && (
            <div>
              <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">Partner Cost Estimate</Text>
              <Text size="xsmall">{partnerCost}</Text>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

import { Container, Heading, Skeleton, Text, Badge } from "@medusajs/ui"

import { AdminDesign } from "../../hooks/api/designs"
import { useProductionRuns } from "../../hooks/api/production-runs"

interface DesignProductionRunsSectionProps {
  design: AdminDesign
}

const statusColor = (status?: string) => {
  switch (status) {
    case "draft":
      return "grey"
    case "pending_review":
      return "orange"
    case "approved":
      return "green"
    case "sent_to_partner":
      return "orange"
    case "in_progress":
      return "orange"
    case "completed":
      return "green"
    case "cancelled":
      return "red"
    default:
      return "grey"
  }
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
            runs.map((run: any) => {
              const id = String(run.id)
              const status = String(run.status || "-")
              const partnerId = run.partner_id ? String(run.partner_id) : "-"
              const quantity = run.quantity ?? "-"

              return (
                <div
                  key={id}
                  className="shadow-elevation-card-rest bg-ui-bg-component rounded-md px-4 py-3 transition-colors"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex flex-col overflow-hidden">
                      <span className="text-ui-fg-base font-medium truncate">{id}</span>
                      <span className="text-ui-fg-subtle text-xs truncate">
                        Partner: {partnerId}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge color={statusColor(status)}>{status}</Badge>
                      <Badge>{String(quantity)}</Badge>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}
    </Container>
  )
}

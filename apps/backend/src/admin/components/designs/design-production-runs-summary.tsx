import { Badge, Button, Container, Heading, Skeleton, Text } from "@medusajs/ui"
import { Plus, TriangleRightMini } from "@medusajs/icons"
import { Link } from "react-router-dom"

import { AdminDesign } from "../../hooks/api/designs"
import { useProductionRuns } from "../../hooks/api/production-runs"
import { productionRunStatusColor as statusColor } from "../../lib/status-colors"

interface Props {
  design: AdminDesign
}

const PREVIEW_COUNT = 2

/**
 * Compact production-runs card for the design detail page (roadmap #8).
 * Shows the count + the latest couple of runs and links to the dedicated
 * sub-page (/designs/:id/production-runs) for the full list. Keeps the
 * detail page light instead of stacking the whole runs section inline.
 */
export const DesignProductionRunsSummary = ({ design }: Props) => {
  const { production_runs, isLoading } = useProductionRuns({
    design_id: design.id,
    limit: 50,
    offset: 0,
  })

  const runs = production_runs || []
  const preview = runs.slice(0, PREVIEW_COUNT)

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-2">
          <Heading level="h2">Production Runs</Heading>
          {!isLoading && (
            <Badge size="2xsmall" color="grey" rounded="full">
              {runs.length}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-x-2">
          <Link to="production-run">
            <Button variant="secondary" size="small">
              <Plus className="mr-1" />
              New Run
            </Button>
          </Link>
          {runs.length > 0 && (
            <Button asChild variant="transparent" size="small">
              <Link to="production-runs">View all</Link>
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2 px-3 py-3">
        {isLoading ? (
          <>
            <Skeleton className="h-12 w-full rounded-md" />
            <Skeleton className="h-12 w-full rounded-md" />
          </>
        ) : runs.length === 0 ? (
          <div className="flex items-center justify-center py-4">
            <Text size="small" className="text-ui-fg-subtle">
              No production runs yet
            </Text>
          </div>
        ) : (
          <>
            {preview.map((run: any) => (
              <Link
                key={run.id}
                to={`production-runs`}
                className="outline-none focus-within:shadow-borders-interactive-with-focus rounded-md [&:hover>div]:bg-ui-bg-component-hover"
              >
                <div className="shadow-elevation-card-rest bg-ui-bg-component flex items-center justify-between rounded-md px-4 py-2.5 transition-colors">
                  <div className="flex flex-col">
                    <Text size="small" leading="compact" weight="plus">
                      {run.run_type === "sample" ? "Sample" : "Production"} ·{" "}
                      {run.quantity} pc{run.quantity !== 1 ? "s" : ""}
                    </Text>
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      {run.id}
                    </Text>
                  </div>
                  <div className="flex items-center gap-x-2">
                    <Badge size="2xsmall" color={statusColor(String(run.status))}>
                      {String(run.status).replace(/_/g, " ")}
                    </Badge>
                    <TriangleRightMini className="text-ui-fg-muted" />
                  </div>
                </div>
              </Link>
            ))}
            {runs.length > PREVIEW_COUNT && (
              <Link
                to="production-runs"
                className="text-ui-fg-interactive hover:text-ui-fg-interactive-hover px-1 py-1"
              >
                <Text size="small" leading="compact">
                  View all {runs.length} runs →
                </Text>
              </Link>
            )}
          </>
        )}
      </div>
    </Container>
  )
}

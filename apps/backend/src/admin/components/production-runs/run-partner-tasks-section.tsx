import { Badge, Heading, Text } from "@medusajs/ui"
import { Link } from "react-router-dom"

import { useProductionRunPartnerTasks } from "../../hooks/api/production-runs"

const STATUS_COLOR: Record<string, "grey" | "orange" | "green" | "blue" | "red"> = {
  pending: "grey",
  assigned: "blue",
  accepted: "blue",
  in_progress: "orange",
  completed: "green",
  cancelled: "red",
}

const money = (n: number | null | undefined, ccy?: string | null) =>
  n == null
    ? null
    : new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: (ccy || "inr").toUpperCase(),
      }).format(n)

/**
 * Partner tasks done FOR this run by any partner (a shoot, a finishing job).
 * Kept apart from the run's own Tasks: these never complete or block the run.
 */
export const RunPartnerTasksSection = ({ runId }: { runId: string }) => {
  const { data, isLoading } = useProductionRunPartnerTasks(runId)
  const tasks = data?.partner_tasks ?? []

  return (
    <>
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Partner tasks for this run</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Work other partners do for this run. Add one from the partner's page.
          </Text>
        </div>
        <Text size="small" className="text-ui-fg-subtle">
          {tasks.length} task{tasks.length === 1 ? "" : "s"}
        </Text>
      </div>
      <div className="px-6 py-4">
        {isLoading ? (
          <Text size="small" className="text-ui-fg-subtle">Loading…</Text>
        ) : !tasks.length ? (
          <Text size="small" className="text-ui-fg-subtle">None yet</Text>
        ) : (
          <div className="flex flex-col gap-y-2">
            {tasks.map((t) => {
              const cost = money(t.actual_cost ?? t.estimated_cost, t.cost_currency)
              return (
                <div
                  key={t.id}
                  className="flex items-center justify-between gap-x-3 rounded-md border px-3 py-2"
                >
                  <div className="min-w-0">
                    <Text size="small" weight="plus" className="truncate">
                      {t.title}
                    </Text>
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      {t.partner ? (
                        <Link to={`/partners/${t.partner.id}`} className="hover:underline">
                          {t.partner.name}
                        </Link>
                      ) : (
                        "No partner"
                      )}
                      {cost ? ` · ${cost}` : " · no cost set"}
                    </Text>
                  </div>
                  <Badge size="2xsmall" color={STATUS_COLOR[t.status] ?? "grey"}>
                    {t.status.replace(/_/g, " ")}
                  </Badge>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}

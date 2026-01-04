import { Badge, Button, Container, Heading, Text, toast } from "@medusajs/ui"
import { useMemo } from "react"
import { Link, useParams } from "react-router-dom"

import {
  ActivitiesSection,
  ActivityItem,
} from "../../../components/common/activities-section"
import { JsonViewSection } from "../../../components/common/json-view-section"
import { SectionRow } from "../../../components/common/section"
import { TwoColumnPage, SingleColumnPage } from "../../../components/layout/pages"
import { TwoColumnPageSkeleton } from "../../../components/common/skeleton"
import { getStatusBadgeColor } from "../../../lib/status-badge"
import {
  useAcceptPartnerProductionRun,
  usePartnerProductionRun,
} from "../../../hooks/api/partner-production-runs"

export const ProductionRunDetail = () => {
  const { id } = useParams()

  const runId = id ?? ""

  const { production_run, tasks, isPending, isError, error } = usePartnerProductionRun(runId)
  const accept = useAcceptPartnerProductionRun(runId, {
    onSuccess: () => {
      toast.success("Run accepted")
    },
  })

  const status = String(production_run?.status || "")
  const canAccept = status === "sent_to_partner"

  const activity = useMemo<ActivityItem[]>(() => {
    const items: ActivityItem[] = [
      {
        id: "created",
        title: "Run created",
        status: production_run?.created_at ? "Recorded" : "-",
        timestamp: production_run?.created_at,
      },
      {
        id: "updated",
        title: "Run updated",
        status: production_run?.updated_at ? "Recorded" : "-",
        timestamp: production_run?.updated_at,
      },
    ]

    const acceptance = (production_run?.metadata as any)?.acceptance
    if (acceptance?.accepted_at) {
      items.push({
        id: "accepted",
        title: "Accepted",
        status: "Recorded",
        timestamp: acceptance.accepted_at,
      })
    }

    const dispatch = (production_run?.metadata as any)?.dispatch
    if (dispatch?.started_at) {
      items.push({
        id: "dispatch_started",
        title: "Dispatch started",
        status: String(dispatch?.state || "-") || "-",
        timestamp: dispatch.started_at,
      })
    }

    if (dispatch?.completed_at) {
      items.push({
        id: "dispatch_completed",
        title: "Dispatch completed",
        status: "Recorded",
        timestamp: dispatch.completed_at,
      })
    }

    const completedCount = (tasks || []).filter(
      (t: any) => String(t?.status || "") === "completed"
    ).length
    const total = (tasks || []).length

    if (total) {
      items.push({
        id: "tasks_progress",
        title: "Tasks progress",
        status: `${completedCount} / ${total} completed`,
      })
    }

    return items
  }, [production_run, tasks])

  if (!id) {
    return (
      <SingleColumnPage widgets={{ before: [], after: [] }} hasOutlet={false}>
        <Container className="p-6">
          <Heading>Production Run</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Missing production run id
          </Text>
        </Container>
      </SingleColumnPage>
    )
  }

  if (isError) {
    throw error
  }

  if (isPending || !production_run) {
    return <TwoColumnPageSkeleton mainSections={3} sidebarSections={2} showJSON />
  }

  return (
    <TwoColumnPage widgets={{ before: [], after: [], sideBefore: [], sideAfter: [] }} hasOutlet>
      <TwoColumnPage.Main>
        <Container className="divide-y p-0">
          <div className="flex items-center justify-between px-6 py-4">
            <div>
              <Heading>Production Run</Heading>
              <div className="mt-2 flex items-center gap-2">
                <Text size="small" className="text-ui-fg-subtle">
                  Status
                </Text>
                {production_run?.status ? (
                  <Badge size="2xsmall" color={getStatusBadgeColor(production_run.status)}>
                    {String(production_run.status)}
                  </Badge>
                ) : (
                  <Text size="small" className="text-ui-fg-subtle">-</Text>
                )}
              </div>
              <Text size="small" className="text-ui-fg-subtle">
                Role: {production_run?.role || "-"}
              </Text>
            </div>
            {canAccept && (
              <Button
                size="small"
                isLoading={accept.isPending}
                onClick={() => accept.mutate()}
              >
                Accept
              </Button>
            )}
          </div>
        </Container>

        <Container className="divide-y p-0">
          <div className="px-6 py-4">
            <Heading level="h2">General</Heading>
          </div>
          <SectionRow title="Run ID" value={production_run?.id || "-"} />
          <SectionRow
            title="Status"
            value={
              production_run?.status ? (
                <Badge size="2xsmall" color={getStatusBadgeColor(production_run.status)}>
                  {String(production_run.status)}
                </Badge>
              ) : (
                "-"
              )
            }
          />
          <SectionRow title="Quantity" value={production_run?.quantity != null ? String(production_run.quantity) : "-"} />
          <SectionRow title="Design" value={production_run?.design_id || "-"} />
          <SectionRow title="Parent run" value={production_run?.parent_run_id || "-"} />
        </Container>

        <Container className="divide-y p-0">
          <div className="px-6 py-4">
            <Heading level="h2">Tasks</Heading>
          </div>
          <div className="px-6 py-4">
            {tasks?.length ? (
              <div className="flex flex-col gap-y-2">
                {tasks.map((t: any) => (
                  <Link
                    key={String(t.id)}
                    to={`tasks/${String(t.id)}`}
                    className="block w-full rounded-lg border bg-ui-bg-subtle p-4 hover:bg-ui-bg-base"
                  >
                    <div className="flex items-start justify-between gap-x-4">
                      <div className="min-w-0">
                        <Text size="small" weight="plus" className="truncate">
                          {String(t.title || t.id)}
                        </Text>
                        <Text size="xsmall" className="text-ui-fg-subtle">
                          {String(t.description || "")}
                        </Text>
                      </div>
                      <div className="shrink-0">
                        {t.status ? (
                          <Badge size="2xsmall" color={getStatusBadgeColor(String(t.status))}>
                            {String(t.status)}
                          </Badge>
                        ) : (
                          <Text size="xsmall" className="text-ui-fg-subtle">-</Text>
                        )}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <Text size="small" className="text-ui-fg-subtle">
                No tasks
              </Text>
            )}
          </div>
        </Container>

        {production_run && (
          <div className="xl:hidden">
            <JsonViewSection data={production_run as any} />
          </div>
        )}
      </TwoColumnPage.Main>

      <TwoColumnPage.Sidebar>
        <ActivitiesSection title="Activity" items={activity} />
        {production_run && (
          <div className="hidden xl:block">
            <JsonViewSection data={production_run as any} />
          </div>
        )}
      </TwoColumnPage.Sidebar>
    </TwoColumnPage>
  )
}

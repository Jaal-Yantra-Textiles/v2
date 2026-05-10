/**
 * Conversion Goal Detail Page
 *
 * Read-only summary of a single goal with edit / mapping / delete actions.
 * Uses Medusa's Outlet pattern so [id]/@edit and [id]/@google-ads-mapping
 * sub-routes render as drawers without unmounting the page.
 */

import {
  Badge,
  Button,
  Container,
  Heading,
  StatusBadge,
  Text,
  toast,
  usePrompt,
} from "@medusajs/ui"
import { Key, PencilSquare, Trash } from "@medusajs/icons"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Link,
  Outlet,
  useNavigate,
  useParams,
  UIMatch,
} from "react-router-dom"
import { useMemo } from "react"
import { sdk } from "../../../../lib/config"

type ConversionGoal = {
  id: string
  name: string
  description: string | null
  goal_type: string
  is_active: boolean
  priority: number
  default_value: number | null
  value_from_event: boolean
  website_id: string | null
  conditions: Record<string, any> | null
  metadata: Record<string, any> | null
  created_at: string
  updated_at: string
}

const GOAL_TYPE_COLORS: Record<
  string,
  "green" | "blue" | "orange" | "purple" | "grey"
> = {
  purchase: "green",
  lead_form: "blue",
  add_to_cart: "orange",
  page_view: "grey",
  time_on_page: "grey",
  scroll_depth: "purple",
  custom_event: "grey",
}

const ConversionGoalDetailPage = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const prompt = usePrompt()
  const qc = useQueryClient()

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["ad-planning", "goals", id],
    queryFn: () =>
      sdk.client.fetch<{ goal: ConversionGoal }>(
        `/admin/ad-planning/goals/${id}`,
        { method: "GET" }
      ),
    enabled: !!id,
  })

  const deleteMutation = useMutation({
    mutationFn: () =>
      sdk.client.fetch(`/admin/ad-planning/goals/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ad-planning", "goals"] })
      toast.success("Goal deleted")
      navigate("/ad-planning/goals", { replace: true })
    },
  })

  const handleDelete = async () => {
    const ok = await prompt({
      title: "Delete goal",
      description:
        "This permanently removes the goal. Existing conversions remain untouched.",
      confirmText: "Delete",
      cancelText: "Cancel",
    })
    if (!ok) return
    await deleteMutation.mutateAsync()
  }

  if (isLoading) {
    return (
      <Container className="p-6">
        <Text size="small" className="text-ui-fg-subtle">
          Loading…
        </Text>
      </Container>
    )
  }

  if (isError || !data?.goal) {
    return (
      <Container className="p-6">
        <Text size="small" className="text-ui-fg-error">
          {(error as Error)?.message || "Goal not found"}
        </Text>
      </Container>
    )
  }

  const g = data.goal

  return (
    <div className="flex flex-col gap-y-3">
      <GeneralSection goal={g} onDelete={handleDelete} />
      <CountersSection goal={g} />
      <ConditionsSection goal={g} />
      <GoogleAdsMappingSection goal={g} />
      <Outlet />
    </div>
  )
}

function GeneralSection({
  goal,
  onDelete,
}: {
  goal: ConversionGoal
  onDelete: () => void
}) {
  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex flex-col gap-y-1">
          <Heading level="h2">{goal.name}</Heading>
          {goal.description && (
            <Text size="small" className="text-ui-fg-subtle">
              {goal.description}
            </Text>
          )}
          <div className="flex items-center gap-x-2 mt-1">
            <Badge
              color={GOAL_TYPE_COLORS[goal.goal_type] || "grey"}
              size="2xsmall"
            >
              {goal.goal_type.replace(/_/g, " ")}
            </Badge>
            <StatusBadge color={goal.is_active ? "green" : "grey"}>
              {goal.is_active ? "active" : "inactive"}
            </StatusBadge>
            <Badge size="2xsmall" color="grey">
              priority {goal.priority}
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-x-2">
          <Button asChild size="small" variant="secondary">
            <Link to="edit">
              <PencilSquare /> Edit
            </Link>
          </Button>
          <Button
            size="small"
            variant="transparent"
            onClick={onDelete}
            className="text-ui-fg-error"
          >
            <Trash />
          </Button>
        </div>
      </div>
      <Field label="Default value" value={fmtNumber(goal.default_value)} />
      <Field
        label="Value from event"
        value={goal.value_from_event ? "Yes" : "No"}
      />
      <Field label="Website" value={goal.website_id || "All sites"} />
    </Container>
  )
}

function CountersSection({ goal }: { goal: ConversionGoal }) {
  const meta = (goal.metadata || {}) as Record<string, any>
  const count = meta.current_count ?? 0
  const value = meta.current_value ?? 0
  const last = meta.last_conversion_at as string | undefined
  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">Counters</Heading>
        <Text size="small" className="text-ui-fg-subtle mt-1">
          Tracked by track-conversion's updateGoalsStep on each matching
          conversion.
        </Text>
      </div>
      <Field label="Conversions" value={String(count)} />
      <Field label="Total value" value={fmtNumber(value)} />
      <Field
        label="Last conversion"
        value={last ? new Date(last).toLocaleString() : "—"}
      />
    </Container>
  )
}

function ConditionsSection({ goal }: { goal: ConversionGoal }) {
  const c = (goal.conditions || {}) as Record<string, any>
  const empty = Object.keys(c).every(
    (k) => c[k] === undefined || c[k] === null || c[k] === ""
  )
  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">Conditions</Heading>
        <Text size="small" className="text-ui-fg-subtle mt-1">
          AND-ed during goal matching.
        </Text>
      </div>
      {empty ? (
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">
            No conditions set — this goal matches by goal_type alone.
          </Text>
        </div>
      ) : (
        <>
          <Field label="Event name" value={c.event_name || "—"} />
          <Field label="Pathname pattern" value={c.pathname_pattern || "—"} />
          <Field
            label="Min time on page (s)"
            value={fmtNumber(c.min_time_seconds)}
          />
          <Field
            label="Min scroll (%)"
            value={fmtNumber(c.min_scroll_percent)}
          />
          {c.custom_conditions && (
            <FieldBlock
              label="Custom conditions"
              value={JSON.stringify(c.custom_conditions, null, 2)}
              mono
            />
          )}
        </>
      )}
    </Container>
  )
}

function GoogleAdsMappingSection({ goal }: { goal: ConversionGoal }) {
  const meta = (goal.metadata || {}) as Record<string, any>
  const ga = (meta.google_ads || {}) as Record<string, any>
  const customer = ga.customer_id as string | undefined
  const action = ga.conversion_action as string | undefined
  const mapped = !!(customer || action)

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Google Ads mapping</Heading>
          <Text size="small" className="text-ui-fg-subtle mt-1">
            Per-goal overrides for conversion uploads. Falls back to platform
            default when blank.
          </Text>
        </div>
        <div className="flex items-center gap-x-2">
          <StatusBadge color={mapped ? "green" : "grey"}>
            {mapped ? "mapped" : "not mapped"}
          </StatusBadge>
          <Button asChild size="small" variant="secondary">
            <Link to="google-ads-mapping">
              <Key /> Edit mapping
            </Link>
          </Button>
        </div>
      </div>
      <Field label="Customer (CID)" value={customer || "— platform default"} mono />
      <Field
        label="Conversion action"
        value={action || "— platform default"}
        mono
      />
    </Container>
  )
}

function Field({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
      <Text size="small" leading="compact" weight="plus">
        {label}
      </Text>
      <Text
        size="small"
        leading="compact"
        className={mono ? "font-mono truncate" : "truncate"}
        title={value}
      >
        {value || "—"}
      </Text>
    </div>
  )
}

function FieldBlock({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="text-ui-fg-subtle flex flex-col gap-y-1 px-6 py-4">
      <Text size="small" leading="compact" weight="plus">
        {label}
      </Text>
      <pre
        className={`${mono ? "font-mono" : ""} text-xs whitespace-pre-wrap break-all`}
      >
        {value}
      </pre>
    </div>
  )
}

function fmtNumber(v: any): string {
  if (v == null) return "—"
  const n = Number(v)
  return Number.isFinite(n) ? n.toLocaleString() : String(v)
}

export default ConversionGoalDetailPage

export const handle = {
  breadcrumb: (match: UIMatch<{ id: string }>) =>
    match.params.id || "Detail",
}

import type { TFunction } from "i18next"

/**
 * Label maps for the design/work enums (#2022).
 *
 * Every design screen used `String(value).replace(/_/g, " ")` — which produces
 * "Sample Production" in English and nothing anywhere else. These helpers map
 * the raw enum value to a real, individually-translatable key under
 * `partner.designs.*` so each status/priority/type renders through `t()`.
 *
 * A value with no mapping falls back to the raw string (space-separated), which
 * keeps an unseen enum value visible rather than silently blank.
 */

const statusKey: Record<string, string> = {
  Conceptual: "statusOptions.conceptual",
  In_Development: "statusOptions.inDevelopment",
  Technical_Review: "statusOptions.technicalReview",
  Sample_Production: "statusOptions.sampleProduction",
  Revision: "statusOptions.revision",
  Approved: "statusOptions.approved",
  Rejected: "statusOptions.rejected",
  On_Hold: "statusOptions.onHold",
  Commerce_Ready: "statusOptions.commerceReady",
  Superseded: "statusOptions.superseded",
}

const priorityKey: Record<string, string> = {
  low: "priorityOptions.low",
  medium: "priorityOptions.medium",
  high: "priorityOptions.high",
  urgent: "priorityOptions.urgent",
  Low: "priorityOptions.low",
  Medium: "priorityOptions.medium",
  High: "priorityOptions.high",
  Urgent: "priorityOptions.urgent",
}

const typeKey: Record<string, string> = {
  Original: "typeOptions.original",
  Derivative: "typeOptions.derivative",
  Custom: "typeOptions.custom",
  Collaboration: "typeOptions.collaboration",
}

const workStatusKey: Record<string, string> = {
  incoming: "workStatusOptions.incoming",
  assigned: "workStatusOptions.assigned",
  in_progress: "workStatusOptions.inProgress",
  awaiting_review: "workStatusOptions.awaitingReview",
  finished: "workStatusOptions.finished",
  completed: "workStatusOptions.completed",
  cancelled: "workStatusOptions.cancelled",
}

const runStatusKey: Record<string, string> = {
  draft: "runStatusOptions.draft",
  pending_review: "runStatusOptions.pendingReview",
  approved: "runStatusOptions.approved",
  sent_to_partner: "runStatusOptions.sentToPartner",
  in_progress: "runStatusOptions.inProgress",
  completed: "runStatusOptions.completed",
  cancelled: "runStatusOptions.cancelled",
  awaiting_reassignment: "runStatusOptions.awaitingReassignment",
}

const engagementKey: Record<string, string> = {
  owned: "engagementOptions.owned",
  assigned: "engagementOptions.assigned",
  shared: "engagementOptions.shared",
}

const runTypeKey: Record<string, string> = {
  production: "runTypeOptions.production",
  sample: "runTypeOptions.sample",
}

const confidenceKey: Record<string, string> = {
  exact: "confidenceOptions.exact",
  estimated: "confidenceOptions.estimated",
}

const fallbackLabel = (value: string): string => value.replace(/_/g, " ")

const label = (
  t: TFunction,
  value: string | null | undefined,
  map: Record<string, string>
): string => {
  if (value == null || value === "") return "—"
  const key = map[value]
  return key ? t(`partner.designs.${key}`) : fallbackLabel(value)
}

export const designStatusLabel = (t: TFunction, v?: string | null): string =>
  label(t, v, statusKey)

export const priorityLabel = (t: TFunction, v?: string | null): string =>
  label(t, v, priorityKey)

export const designTypeLabel = (t: TFunction, v?: string | null): string =>
  label(t, v, typeKey)

export const workStatusLabel = (t: TFunction, v?: string | null): string =>
  label(t, v, workStatusKey)

export const runStatusLabel = (t: TFunction, v?: string | null): string =>
  label(t, v, runStatusKey)

export const runTypeLabel = (t: TFunction, v?: string | null): string =>
  label(t, v, runTypeKey)

export const confidenceLabel = (t: TFunction, v?: string | null): string =>
  label(t, v, confidenceKey)

/** The `partner.designs.engagementOptions.*` key for a partner_engagement value. */
export const engagementKeyFor = (v?: string | null): string =>
  v ? engagementKey[v] ?? "engagementOptions.shared" : "engagementOptions.shared"
import type { TFunction } from "i18next"

/**
 * Label maps for the design/work enums (#2022).
 *
 * Every design screen used `String(value).replace(/_/g, " ")` — which produces
 * "Sample Production" in English and nothing anywhere else. These helpers map
 * the raw enum value to a real, individually-translatable key under
 * `partner.designs.*` so each status/priority/type renders through `t()`.
 *
 * Each map indexes literal `t("partner.designs.<key>")` calls (never a
 * template-literal key), because `t` is typed against the resource keys — a
 * computed key fails `tsc` and returns `unknown` at render. A value with no
 * mapping falls back to the raw string (space-separated), which keeps an
 * unseen enum value visible rather than silently blank.
 */

const DASH = "—"

const fallbackLabel = (value: string): string => value.replace(/_/g, " ")

export const designStatusLabel = (
  t: TFunction<"translation">,
  v?: string | null
): string => {
  if (v == null || v === "") return DASH
  const map: Record<string, string> = {
    Conceptual: t("partner.designs.statusOptions.conceptual"),
    In_Development: t("partner.designs.statusOptions.inDevelopment"),
    Technical_Review: t("partner.designs.statusOptions.technicalReview"),
    Sample_Production: t("partner.designs.statusOptions.sampleProduction"),
    Revision: t("partner.designs.statusOptions.revision"),
    Approved: t("partner.designs.statusOptions.approved"),
    Rejected: t("partner.designs.statusOptions.rejected"),
    On_Hold: t("partner.designs.statusOptions.onHold"),
    Commerce_Ready: t("partner.designs.statusOptions.commerceReady"),
    Superseded: t("partner.designs.statusOptions.superseded"),
  }
  return map[v] ?? fallbackLabel(v)
}

export const priorityLabel = (
  t: TFunction<"translation">,
  v?: string | null
): string => {
  if (v == null || v === "") return DASH
  const map: Record<string, string> = {
    low: t("partner.designs.priorityOptions.low"),
    medium: t("partner.designs.priorityOptions.medium"),
    high: t("partner.designs.priorityOptions.high"),
    urgent: t("partner.designs.priorityOptions.urgent"),
    Low: t("partner.designs.priorityOptions.low"),
    Medium: t("partner.designs.priorityOptions.medium"),
    High: t("partner.designs.priorityOptions.high"),
    Urgent: t("partner.designs.priorityOptions.urgent"),
  }
  return map[v] ?? fallbackLabel(v)
}

export const designTypeLabel = (
  t: TFunction<"translation">,
  v?: string | null
): string => {
  if (v == null || v === "") return DASH
  const map: Record<string, string> = {
    Original: t("partner.designs.typeOptions.original"),
    Derivative: t("partner.designs.typeOptions.derivative"),
    Custom: t("partner.designs.typeOptions.custom"),
    Collaboration: t("partner.designs.typeOptions.collaboration"),
  }
  return map[v] ?? fallbackLabel(v)
}

export const workStatusLabel = (
  t: TFunction<"translation">,
  v?: string | null
): string => {
  if (v == null || v === "") return DASH
  const map: Record<string, string> = {
    incoming: t("partner.designs.workStatusOptions.incoming"),
    assigned: t("partner.designs.workStatusOptions.assigned"),
    in_progress: t("partner.designs.workStatusOptions.inProgress"),
    awaiting_review: t("partner.designs.workStatusOptions.awaitingReview"),
    finished: t("partner.designs.workStatusOptions.finished"),
    completed: t("partner.designs.workStatusOptions.completed"),
    cancelled: t("partner.designs.workStatusOptions.cancelled"),
  }
  return map[v] ?? fallbackLabel(v)
}

export const runStatusLabel = (
  t: TFunction<"translation">,
  v?: string | null
): string => {
  if (v == null || v === "") return DASH
  const map: Record<string, string> = {
    draft: t("partner.designs.runStatusOptions.draft"),
    pending_review: t("partner.designs.runStatusOptions.pendingReview"),
    approved: t("partner.designs.runStatusOptions.approved"),
    sent_to_partner: t("partner.designs.runStatusOptions.sentToPartner"),
    in_progress: t("partner.designs.runStatusOptions.inProgress"),
    completed: t("partner.designs.runStatusOptions.completed"),
    cancelled: t("partner.designs.runStatusOptions.cancelled"),
    awaiting_reassignment: t("partner.designs.runStatusOptions.awaitingReassignment"),
  }
  return map[v] ?? fallbackLabel(v)
}

export const runTypeLabel = (
  t: TFunction<"translation">,
  v?: string | null
): string => {
  if (v == null || v === "") return DASH
  const map: Record<string, string> = {
    production: t("partner.designs.runTypeOptions.production"),
    sample: t("partner.designs.runTypeOptions.sample"),
  }
  return map[v] ?? fallbackLabel(v)
}

export const confidenceLabel = (
  t: TFunction<"translation">,
  v?: string | null
): string => {
  if (v == null || v === "") return DASH
  const map: Record<string, string> = {
    exact: t("partner.designs.confidenceOptions.exact"),
    estimated: t("partner.designs.confidenceOptions.estimated"),
  }
  return map[v] ?? fallbackLabel(v)
}

/** The `partner.designs.engagementOptions.*.label` for a partner_engagement value. */
export const engagementLabel = (
  t: TFunction<"translation">,
  v?: string | null
): string => {
  const map: Record<string, string> = {
    owned: t("partner.designs.engagementOptions.owned.label"),
    assigned: t("partner.designs.engagementOptions.assigned.label"),
    shared: t("partner.designs.engagementOptions.shared.label"),
  }
  return map[v ?? "shared"] ?? map["shared"]
}

/** The `partner.designs.engagementOptions.*.hint` for a partner_engagement value. */
export const engagementHint = (
  t: TFunction<"translation">,
  v?: string | null
): string => {
  const map: Record<string, string> = {
    owned: t("partner.designs.engagementOptions.owned.hint"),
    assigned: t("partner.designs.engagementOptions.assigned.hint"),
    shared: t("partner.designs.engagementOptions.shared.hint"),
  }
  return map[v ?? "shared"] ?? map["shared"]
}

/** The `partner.designs.bucketOptions.*` label for a design-list work bucket. */
export const bucketLabel = (
  t: TFunction<"translation">,
  v?: string | null
): string => {
  const map: Record<string, string> = {
    incoming: t("partner.designs.bucketOptions.incoming"),
    in_progress: t("partner.designs.bucketOptions.inProgress"),
    yours: t("partner.designs.bucketOptions.yours"),
    completed: t("partner.designs.bucketOptions.completed"),
    all: t("partner.designs.bucketOptions.all"),
  }
  return map[v ?? "all"] ?? map["all"]
}

/**
 * The next-action label for a partner work status, or null when the status has
 * no action (the caller renders "-").
 */
export const nextActionLabel = (
  t: TFunction<"translation">,
  v?: string | null
): string | null => {
  if (v == null || v === "") return null
  const map: Record<string, string> = {
    incoming: t("partner.designs.actionOptions.accept"),
    assigned: t("partner.designs.actionOptions.accept"),
    in_progress: t("partner.designs.actionOptions.working"),
    awaiting_review: t("partner.designs.actionOptions.complete"),
    finished: t("partner.designs.actionOptions.underReview"),
    completed: t("partner.designs.actionOptions.done"),
    cancelled: t("partner.designs.actionOptions.cancelled"),
  }
  return map[v] ?? null
}
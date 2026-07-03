/**
 * PURE audience classifier — given a raw contact from any of the three sources,
 * infer its `source`, `groups`, and `tags`. No IO; fully unit-testable.
 *
 * Grounded in the 2026-07-04 profiling of the real audience (#881): the person
 * list is dominated by a handloom WEAVER DIRECTORY bulk-imported on 2025-07-10
 * (weaver metadata: district / weave_practiced / technique / is_gi_product / …),
 * with a smaller tail of organic subscribers, plus 22 customers and ~1 lead.
 * There is no `person.source` column, so origin is inferred from these signals.
 */

export type MemberType = "person" | "customer" | "lead"

export type ClassifierInput = {
  member_type: MemberType
  email: string
  metadata?: Record<string, any> | null
  /** person only — "Onboarding" | "Onboarding Finished" | … */
  state?: string | null
  /** person only — active email subscription? */
  sub_active?: boolean
  /** ISO or Date — used to detect the bulk-import cohort. */
  created_at?: string | Date | null
}

export type Classification = {
  source: string
  groups: string[]
  tags: string[]
  mailable: boolean
}

export type ClassifierOptions = {
  /** YYYY-MM-DD of the weaver bulk import. Default 2025-07-10. */
  importDay?: string
  /** metadata keys that mark a weaver-directory person. */
  weaverKeys?: string[]
}

const DEFAULT_IMPORT_DAY = "2025-07-10"
const DEFAULT_WEAVER_KEYS = [
  "metadata_district",
  "metadata_District",
  "metadata_weave_practiced",
  "metadata_technique",
  "metadata_weaving_technique",
  "metadata_is_gi_product",
  "metadata_gi_product",
  "metadata_product",
  "metadata_award_received",
  "metadata_photo_of_weaver",
  "metadata_exclusive_handloom_products",
]

function dayOf(v: string | Date | null | undefined): string {
  if (!v) return ""
  const s = typeof v === "string" ? v : v.toISOString()
  return s.slice(0, 10)
}

function hasWeaverMeta(meta: Record<string, any>, keys: string[]): boolean {
  return keys.some((k) => k in meta)
}

export function classifyContact(
  input: ClassifierInput,
  opts: ClassifierOptions = {}
): Classification {
  const importDay = opts.importDay || DEFAULT_IMPORT_DAY
  const weaverKeys = opts.weaverKeys || DEFAULT_WEAVER_KEYS
  const meta = input.metadata || {}

  const tags = new Set<string>()
  let source: string
  const groups: string[] = []

  if (input.member_type === "customer") {
    source = "customer"
    groups.push("customers")
    tags.add("customer")
  } else if (input.member_type === "lead") {
    source = "ad-lead"
    groups.push("ad-leads")
    tags.add("ad-lead")
  } else {
    // person — weaver directory vs organic
    const weaver = hasWeaverMeta(meta, weaverKeys) || dayOf(input.created_at) === importDay
    if (weaver) {
      source = "weaver-directory"
      groups.push("weaver-directory")
      tags.add("weaver-directory")
      // GI-tagged handloom products are a notable sub-segment.
      if (meta.metadata_is_gi_product || meta.metadata_gi_product) tags.add("gi-product")
    } else {
      source = "organic"
      groups.push("organic")
      tags.add("organic")
    }
    if (input.state === "Onboarding Finished") tags.add("onboarding-finished")
    if (input.sub_active) tags.add("subscriber")
  }

  // Cross-cutting suppression flags — mailability depends on these.
  const bounced = !!meta.bounced
  const unsubscribed = !!meta.unsubscribed
  if (bounced) tags.add("bounced")
  if (unsubscribed) tags.add("unsubscribed")

  // Mailable = not suppressed, and for persons requires an active subscription
  // (customers/leads are mailed unconditionally by the send today).
  let mailable = !bounced && !unsubscribed
  if (input.member_type === "person") mailable = mailable && !!input.sub_active

  return { source, groups, tags: [...tags], mailable }
}

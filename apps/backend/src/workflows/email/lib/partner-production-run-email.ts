// Pure helpers for the partner "production run lifecycle" email (#576 slice B).
// Side-effect free so the template-key resolution + Handlebars data assembly are
// unit-testable without booting Medusa or a notification provider.
//
// Mirrors lib/partner-task-email.ts so partner task + run emails share one shape.

export type ProductionRunEmailAction = "completed" | "cancelled"

export interface PartnerProductionRunTemplateInput {
  partner: { name?: string | null; handle?: string | null }
  admin: { first_name?: string | null; last_name?: string | null }
  run: {
    id?: string | null
    status?: string | null
    quantity?: number | null
    produced_quantity?: number | null
    rejected_quantity?: number | null
    design_id?: string | null
    order_id?: string | null
  }
  action: ProductionRunEmailAction
  /** Free-text notes/reason surfaced in the body (completion notes or cancel reason). */
  notes?: string | null
  /** Storefront URL (FRONTEND_URL) surfaced in the footer. */
  storeUrl?: string
  /** Base URL for the "View Run" CTA; `${base}/${runId}` when both present. */
  runUrlBase?: string
  /** Override for deterministic tests; defaults to the current year. */
  year?: number
}

/**
 * DB template key for a production-run lifecycle email.
 * Only `completed` and `cancelled` have partner emails (#576 slice B); any other
 * action returns null so the workflow can skip without guessing a key.
 */
export function resolvePartnerProductionRunTemplateKey(
  action: string | null | undefined
): string | null {
  if (action === "completed") return "partner-production-run-completed"
  if (action === "cancelled") return "partner-production-run-cancelled"
  return null
}

/**
 * Partner email from-address: partner+<handle>@<domain>.
 * Mirrors derivePartnerFromEmail in partner-task-email.ts so all partner mail
 * shares one sender shape; re-declared here to keep this lib dependency-free.
 */
export function derivePartnerFromEmail(
  handle: string | null | undefined,
  fromDomain: string
): string {
  const safeHandle = (handle || "partner").toLowerCase().trim().replace(/\s+/g, "-")
  return `partner+${safeHandle}@${fromDomain}`
}

/**
 * Assemble the Handlebars data for the partner-production-run-* DB template.
 * All values are coerced to strings so an undefined/null field renders blank
 * rather than the literal "undefined".
 */
export function buildPartnerProductionRunTemplateData(
  input: PartnerProductionRunTemplateInput
): Record<string, string> {
  const { partner, admin, run, action } = input
  const adminName = `${admin.first_name || ""} ${admin.last_name || ""}`.trim()
  const runId = run.id || ""
  const base = (input.runUrlBase || "").replace(/\/$/, "")
  const runUrl = base && runId ? `${base}/${runId}` : ""

  const numOrEmpty = (v: number | null | undefined): string =>
    v === null || v === undefined ? "" : String(v)

  return {
    partner_name: partner.name || "Partner",
    partner_handle: partner.handle || "",
    admin_name: adminName,
    admin_first_name: admin.first_name || "",
    run_id: runId,
    run_action: action,
    run_status: run.status || "",
    run_quantity: numOrEmpty(run.quantity),
    produced_quantity: numOrEmpty(run.produced_quantity),
    rejected_quantity: numOrEmpty(run.rejected_quantity),
    design_id: run.design_id || "",
    order_id: run.order_id || "",
    notes: input.notes || "",
    run_url: runUrl,
    current_year: String(input.year ?? new Date().getFullYear()),
    store_url: input.storeUrl || "",
  }
}

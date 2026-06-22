// Pure helpers for the partner "task assigned" email.
// Kept side-effect free so the template-data assembly + from-address derivation
// are unit-testable without booting Medusa or a notification provider.

export interface PartnerTaskTemplateInput {
  partner: { name?: string | null; handle?: string | null }
  admin: { first_name?: string | null; last_name?: string | null }
  task: {
    id?: string | null
    title?: string | null
    description?: string | null
    priority?: string | null
    status?: string | null
  }
  /** Storefront URL (FRONTEND_URL) surfaced in the footer. */
  storeUrl?: string
  /** Base URL for the "View Task" CTA; `${base}/${taskId}` when both present. */
  taskUrlBase?: string
  /** Override for deterministic tests; defaults to the current year. */
  year?: number
}

/**
 * Partner email from-address: partner+<handle>@<domain>.
 * Mirrors resolvePartnerFromOrderStep so task + order emails share one sender shape.
 */
export function derivePartnerFromEmail(
  handle: string | null | undefined,
  fromDomain: string
): string {
  const safeHandle = (handle || "partner").toLowerCase().trim().replace(/\s+/g, "-")
  return `partner+${safeHandle}@${fromDomain}`
}

/**
 * Assemble the Handlebars data for the `partner-task-assigned` DB template.
 * All values are coerced to strings so an undefined/null field renders blank
 * rather than the literal "undefined".
 */
export function buildPartnerTaskTemplateData(
  input: PartnerTaskTemplateInput
): Record<string, string> {
  const { partner, admin, task } = input
  const adminName = `${admin.first_name || ""} ${admin.last_name || ""}`.trim()
  const taskId = task.id || ""
  const base = (input.taskUrlBase || "").replace(/\/$/, "")
  const taskUrl = base && taskId ? `${base}/${taskId}` : ""

  return {
    partner_name: partner.name || "Partner",
    partner_handle: partner.handle || "",
    admin_name: adminName,
    admin_first_name: admin.first_name || "",
    task_id: taskId,
    task_title: task.title || "",
    task_description: task.description || "",
    task_priority: task.priority || "",
    task_status: task.status || "",
    task_url: taskUrl,
    current_year: String(input.year ?? new Date().getFullYear()),
    store_url: input.storeUrl || "",
  }
}

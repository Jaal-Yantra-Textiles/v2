import { MedusaError } from "@medusajs/framework/utils"

import { EMAIL_TEMPLATES_MODULE } from "../../../../modules/email_templates"
import type {
  MaintenanceChange,
  MaintenanceJob,
  MaintenanceJobResult,
} from "./registry"

// Template DATA (not the seed default fns) imported from the existing seed
// scripts so the canonical content lives in ONE place. Importing the constants
// has no side effects — the seed's default export only runs under `medusa exec`.
import { emailTemplatesData } from "../../../../scripts/seed-email-templates"
import { additionalEmailTemplates } from "../../../../scripts/seed-additional-email-templates"
import { reengagementEmailTemplates } from "../../../../scripts/seed-reengagement-email-templates"
import { partnerEmailTemplates } from "../../../../scripts/seed-partner-email-templates"
import { TEMPLATE_DEFINITION as cartAbandonedTemplate } from "../../../../scripts/seed-cart-abandoned-email"
import { tourEmailTemplate } from "../../../../scripts/seed-tour-email-template"
import { visualFlowLifecycleTemplates } from "../../../../scripts/seed-visual-flow-lifecycle-email-templates"

/**
 * #457 Data Plumbing — SEED jobs.
 *
 * Exposes the idempotent email-template seed scripts through the guarded
 * maintenance-jobs registry so a fresh / empty admin can seed the reference
 * email templates from Settings → Data Plumbing (dry-run preview → apply)
 * without a shell or `medusa exec`. Mirrors the seeds' own idempotency
 * (skip-existing by `template_key`); dry-run writes NOTHING.
 *
 * Reference-data seeds (energy-rates, tax-regions, fx-rates, plans, …) each
 * have bespoke exists/create logic (and seed-plans reads the filesystem, the
 * tax/fx seeds do multi-step money writes) so they need per-seed preview logic —
 * deferred to a follow-up. See SEED_INVENTORY in apps/docs/notes for the full
 * expose/skip/defer map.
 */

export type EmailTemplateSpec = {
  template_key: string
  name?: string
  [key: string]: unknown
}

/** Selectable email-template sets, each wrapping one seed script's data. */
export const EMAIL_TEMPLATE_SETS: Array<{
  key: string
  label: string
  specs: EmailTemplateSpec[]
}> = [
  {
    key: "core",
    label: "core email templates",
    specs: emailTemplatesData as EmailTemplateSpec[],
  },
  {
    key: "additional",
    label: "additional customer/partner templates",
    specs: additionalEmailTemplates as EmailTemplateSpec[],
  },
  {
    key: "reengagement",
    label: "re-engagement templates",
    specs: reengagementEmailTemplates as EmailTemplateSpec[],
  },
  {
    key: "partner",
    label: "partner/admin templates",
    specs: partnerEmailTemplates as EmailTemplateSpec[],
  },
  {
    key: "cart-abandoned",
    label: "cart-abandoned template",
    specs: [cartAbandonedTemplate as EmailTemplateSpec],
  },
  {
    key: "tour",
    label: "tour itinerary template",
    specs: [tourEmailTemplate as EmailTemplateSpec],
  },
  {
    key: "visual-flow-lifecycle",
    label: "visual-flow lifecycle templates",
    specs: visualFlowLifecycleTemplates as EmailTemplateSpec[],
  },
]

export const EMAIL_TEMPLATE_SET_KEYS = EMAIL_TEMPLATE_SETS.map((s) => s.key)

/**
 * PURE: resolve a `set` param to the spec list. "" / "all" → every set.
 * Combines selected sets and dedupes by `template_key` (first occurrence wins,
 * e.g. "cart-abandoned" ships in both `core` and the `cart-abandoned` set).
 * Throws on an unknown set key (caller maps it to INVALID_DATA).
 */
export function resolveEmailTemplateSpecs(setParam?: string): {
  setKeys: string[]
  specs: EmailTemplateSpec[]
} {
  const raw = (setParam ?? "all").trim().toLowerCase()
  let chosen: typeof EMAIL_TEMPLATE_SETS
  if (raw === "" || raw === "all") {
    chosen = EMAIL_TEMPLATE_SETS
  } else {
    const found = EMAIL_TEMPLATE_SETS.find((s) => s.key === raw)
    if (!found) {
      throw new Error(
        `Unknown email-template set "${raw}". Valid: ${EMAIL_TEMPLATE_SET_KEYS.join(", ")}, all`
      )
    }
    chosen = [found]
  }

  const seen = new Set<string>()
  const specs: EmailTemplateSpec[] = []
  for (const set of chosen) {
    for (const spec of set.specs) {
      if (!spec?.template_key || seen.has(spec.template_key)) {
        continue
      }
      seen.add(spec.template_key)
      specs.push(spec)
    }
  }
  return { setKeys: chosen.map((s) => s.key), specs }
}

export type EmailTemplateSeedPlan = {
  total: number
  toCreate: EmailTemplateSpec[]
  existingKeys: string[]
}

/**
 * PURE: partition specs into create-vs-skip given the set of `template_key`s
 * already present. Exported for unit testing so the dry-run/apply decision is
 * verifiable without booting the DB.
 */
export function planEmailTemplateSeed(
  specs: EmailTemplateSpec[],
  existing: Set<string> | string[]
): EmailTemplateSeedPlan {
  const existingSet = existing instanceof Set ? existing : new Set(existing)
  const toCreate: EmailTemplateSpec[] = []
  const existingKeys: string[] = []
  for (const spec of specs) {
    if (existingSet.has(spec.template_key)) {
      existingKeys.push(spec.template_key)
    } else {
      toCreate.push(spec)
    }
  }
  return { total: specs.length, toCreate, existingKeys }
}

/**
 * PURE: turn a plan into a MaintenanceJobResult. `applied` is true only when
 * this was a real run (dry_run=false) that actually created at least one row.
 */
export function buildEmailTemplateSeedResult(
  jobId: string,
  dry_run: boolean,
  plan: EmailTemplateSeedPlan,
  setLabel: string
): MaintenanceJobResult {
  const verb = dry_run ? "Would create" : "Created"
  const changes: MaintenanceChange[] = plan.toCreate.map((spec) => ({
    entity: "email_template",
    id: spec.template_key,
    field: "template_key",
    before: null,
    after: spec.name ?? spec.template_key,
  }))
  const summary = `${verb} ${plan.toCreate.length} of ${plan.total} ${setLabel}; ${plan.existingKeys.length} already exist`
  return {
    job_id: jobId,
    dry_run,
    applied: !dry_run && plan.toCreate.length > 0,
    summary,
    changes,
  }
}

export const seedEmailTemplatesJob: MaintenanceJob = {
  id: "seed-email-templates",
  label: "Seed email templates",
  description:
    "Seed the reference email templates into a fresh / empty admin from the console — no shell or `medusa exec` needed (#457). Wraps the idempotent email-template seed scripts. Pick a set with the `set` param (core, additional, reengagement, partner, cart-abandoned, tour, visual-flow-lifecycle) or leave it blank / 'all' to seed every set. Dry-run reports exactly which template_keys WOULD be created vs already exist (writes nothing); apply creates ONLY the missing ones (skip-existing by template_key). Safe to re-run — never overwrites an admin-edited template.",
  params: [
    {
      name: "set",
      type: "string",
      required: false,
      description: `Which template set to seed: ${EMAIL_TEMPLATE_SET_KEYS.join(", ")}, or "all" (default). Idempotent: only missing template_keys are created; dry-run writes nothing.`,
    },
  ],
  run: async (container, { dry_run, params }) => {
    const setParam =
      params?.set != null ? String(params.set) : undefined

    let resolved: { setKeys: string[]; specs: EmailTemplateSpec[] }
    try {
      resolved = resolveEmailTemplateSpecs(setParam)
    } catch (e: any) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        e?.message ?? "Invalid email-template set"
      )
    }

    const svc: any = container.resolve(EMAIL_TEMPLATES_MODULE)
    // Existence check spans active AND inactive rows (broader than the seeds'
    // getTemplateByKey, which is active-only) so we never create a duplicate
    // template_key for a deactivated row.
    const existingRows = await svc.listEmailTemplates(
      {},
      { select: ["template_key"], take: 100000 }
    )
    const existing = new Set<string>(
      (existingRows ?? [])
        .map((r: any) => r?.template_key)
        .filter((k: unknown): k is string => typeof k === "string" && k.length > 0)
    )

    const plan = planEmailTemplateSeed(resolved.specs, existing)

    if (!dry_run) {
      for (const spec of plan.toCreate) {
        await svc.createEmailTemplates([spec])
      }
    }

    const setLabel =
      resolved.setKeys.length === EMAIL_TEMPLATE_SETS.length
        ? "email templates"
        : `${resolved.setKeys.join("+")} email templates`

    return buildEmailTemplateSeedResult(
      seedEmailTemplatesJob.id,
      dry_run,
      plan,
      setLabel
    )
  },
}

import { MedusaError } from "@medusajs/framework/utils"

import { SOCIALS_MODULE } from "../../../../modules/socials"
import type {
  MaintenanceChange,
  MaintenanceJob,
  MaintenanceJobResult,
} from "./registry"

/**
 * Data Plumbing — serve a new AI role from a provider we already configured.
 *
 * An AI role is one `social_platform` row (category "ai", metadata.role), and
 * its API key is stored ENCRYPTED on that row. Pointing a new role at the same
 * provider used to mean re-typing the key — which nobody has to hand, and which
 * should not travel through a chat or a shell. This copies the row server-side,
 * `api_config` byte-for-byte (the encrypted key included, never decrypted), with
 * the new role on it. First use: `ai_partner_website_scan` ← the free Z.ai GLM
 * row serving `ai_whatsapp_partner_chat` (#2249).
 *
 * Refuses when an ACTIVE platform already serves the target role: two defaults
 * for one role is a silent coin-toss (getAiPlatformForRole takes the first).
 */
export const cloneAiPlatformRoleJob: MaintenanceJob = {
  id: "clone-ai-platform-role",
  label: "Serve a new AI role from an existing AI platform",
  description:
    "Copy an existing AI platform (category 'ai') — provider, base URL, default model and its ENCRYPTED api key, never decrypted — into a new platform row tagged with `role`, marked default for that role. Refuses if an active platform already serves the role, or if the source is not an active AI platform with a key. Preview (default) shows the row that would be created.",
  params: [
    { name: "source_platform_id", type: "string", required: true, description: "The AI platform to copy, e.g. the Z.ai GLM row." },
    { name: "role", type: "string", required: true, description: "The role the copy will serve, e.g. 'ai_partner_website_scan'." },
    { name: "name", type: "string", required: false, description: "Name for the copy (default: '<source name> — <role>')." },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const sourceId = String(params.source_platform_id ?? "").trim()
    const role = String(params.role ?? "").trim()
    if (!sourceId || !/^ai_[a-z0-9_]+$/.test(role)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "source_platform_id is required and role must look like 'ai_something'"
      )
    }

    const socials: any = container.resolve(SOCIALS_MODULE)
    const [source] = await socials.listSocialPlatforms({ id: sourceId }, { take: 1 })
    if (!source || source.category !== "ai" || source.status !== "active") {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, `No active AI platform ${sourceId}`)
    }
    const cfg = (source.api_config ?? {}) as Record<string, unknown>
    if (!cfg.api_key_encrypted && !cfg.api_key) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, `Platform ${sourceId} holds no API key to copy`)
    }

    const existing = await socials.listSocialPlatforms(
      { category: "ai", status: "active", metadata: { role } } as any,
      { take: 5 }
    )
    if (existing?.length) {
      return {
        job_id: cloneAiPlatformRoleJob.id,
        dry_run,
        applied: false,
        summary: `Role ${role} is already served by ${existing.map((p: any) => `${p.name} (${p.id})`).join(", ")} — nothing copied.`,
        changes: [],
      }
    }

    const name = String(params.name ?? "").trim() || `${source.name} — ${role}`
    const row = {
      name,
      category: "ai",
      auth_type: source.auth_type,
      icon_url: source.icon_url ?? null,
      base_url: source.base_url ?? null,
      description: `Copy of ${source.name} (${source.id}) serving ${role}.`,
      api_config: cfg,
      status: "active",
      metadata: {
        ...(source.metadata ?? {}),
        role,
        is_default: true,
        source: "clone-ai-platform-role",
        cloned_from: source.id,
      },
    }

    const change: MaintenanceChange = {
      entity: "social_platform",
      id: "(new)",
      field: "metadata.role",
      before: null,
      after: role,
    } as MaintenanceChange

    if (dry_run) {
      return {
        job_id: cloneAiPlatformRoleJob.id,
        dry_run,
        applied: false,
        summary: `Would create "${name}" serving ${role}: provider ${(source.metadata as any)?.provider_type ?? "?"}, model ${String(cfg.default_model ?? "?")}, key copied encrypted from ${source.id}.`,
        changes: [change],
      }
    }

    const created = await socials.createSocialPlatforms(row)
    return {
      job_id: cloneAiPlatformRoleJob.id,
      dry_run,
      applied: true,
      summary: `Created "${name}" (${created.id}) serving ${role}, copied from ${source.id}.`,
      changes: [{ ...change, id: created.id }],
    }
  },
}

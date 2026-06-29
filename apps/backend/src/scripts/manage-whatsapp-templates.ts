/**
 * Manage WhatsApp templates across every configured SocialPlatform.
 *
 * Drives the Meta Graph API using each platform's own stored access token
 * and `waba_id`. Iterates templates × language variants × platforms,
 * applying the selected MODE.
 *
 * Modes:
 *   dry-run   — print the full plan, no network calls                   (default)
 *   upsert    — create anything that doesn't already exist               (safe)
 *   replace   — delete spec-named variants then create fresh             (destructive)
 *   cleanup   — delete legacy templates named without the spec's version
 *               suffix. Spec names end in "_v2"; cleanup deletes every
 *               variant of the stripped base name (e.g.
 *               "jyt_production_run_assigned") on every configured WABA.  (destructive)
 *
 * Usage:
 *   MODE=dry-run  npx medusa exec ./src/scripts/manage-whatsapp-templates.ts
 *   MODE=upsert   npx medusa exec ./src/scripts/manage-whatsapp-templates.ts
 *   MODE=replace CONFIRM_REPLACE=1 npx medusa exec ./src/scripts/manage-whatsapp-templates.ts
 *   MODE=cleanup CONFIRM_REPLACE=1 npx medusa exec ./src/scripts/manage-whatsapp-templates.ts
 *
 * Scope:
 *   PLATFORM_IDS=a,b    only run against these SocialPlatform rows
 *   POLL_SECONDS=90     extend the approval-status poll window (default 60)
 *   WHATSAPP_PLATFORM_LANGUAGES="AU=en;IN=en,hi"   per-label language override
 */

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { ALL_WHATSAPP_TEMPLATES } from "./whatsapp-templates/all-templates"
// Shared Meta template-sync core — single source for platform resolution +
// Graph API list/create/delete, reused by the sync-whatsapp-templates job.
import {
  GRAPH_API_BASE,
  type PlatformPlan,
  resolveWhatsAppPlatforms,
  fetchExistingTemplates,
  createTemplate,
  deleteTemplate,
} from "./whatsapp-templates/meta-template-sync"

const ALL_TEMPLATES = ALL_WHATSAPP_TEMPLATES

type Mode = "dry-run" | "upsert" | "replace" | "cleanup"

export default async function manageWhatsAppTemplates({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  const mode = ((process.env.MODE ?? "dry-run") as Mode)
  if (!["dry-run", "upsert", "replace", "cleanup"].includes(mode)) {
    logger.error(`Unknown MODE "${mode}". Allowed: dry-run | upsert | replace | cleanup`)
    return
  }

  if ((mode === "replace" || mode === "cleanup") && process.env.CONFIRM_REPLACE !== "1") {
    logger.error(
      `MODE=${mode} is destructive. Re-run with CONFIRM_REPLACE=1 to proceed.`
    )
    return
  }

  const pollSeconds = Math.max(0, Math.min(300, Number(process.env.POLL_SECONDS ?? 60)))
  const platformIdFilter = (process.env.PLATFORM_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)

  // Required for templates whose spec includes a media header — Meta's
  // resumable-upload endpoint is APP-scoped, so we need the Meta App ID
  // (the same number as the FACEBOOK_CLIENT_ID, since the App is what
  // the OAuth consent flow registered against). META_APP_ID overrides
  // when set, otherwise falls back to FACEBOOK_CLIENT_ID. Templates
  // without a header don't need this — the script tolerates its absence
  // and only complains when it actually has to upload.
  const metaAppId =
    process.env.META_APP_ID || process.env.FACEBOOK_CLIENT_ID || undefined

  // ── Resolve platform plans (shared lib — same social-provider keys) ─────────
  const { platforms, skipped } = await resolveWhatsAppPlatforms(container, {
    platformIdFilter,
  })
  for (const s of skipped) {
    logger.warn(`[${s.id}] skipped — ${s.reason}`)
  }

  if (platforms.length === 0) {
    logger.error("No usable WhatsApp platforms found. Configure at least one row with waba_id + access_token.")
    return
  }

  logger.info(`\n▶ Running mode=${mode} against ${platforms.length} platform(s):`)
  for (const p of platforms) {
    logger.info(`  - ${p.label} (${p.platformId}) waba=${p.wabaId} langs=[${p.languages.join(", ")}]`)
  }

  // ── Per-platform loop ─────────────────────────────────────────────────────
  const createdIds: Array<{ platform: string; templateId: string; name: string; language: string }> = []

  for (const platform of platforms) {
    logger.info(`\n── ${platform.label} (${platform.platformId}) ──`)

    const existing = await fetchExistingTemplates(platform)
    if ("error" in existing) {
      logger.error(`  list failed: ${existing.error}`)
      continue
    }
    logger.info(`  ${existing.data.length} template variants currently on this WABA`)

    for (const spec of ALL_TEMPLATES) {
      // Legacy = the same base name with any trailing _vN stripped. Used
      // exclusively by `cleanup` to delete pre-versioning templates after
      // a newer _vN is live.
      const legacyName = spec.name.replace(/_v\d+$/, "")

      for (const lang of spec.languages) {
        if (!platform.languages.includes(lang.language)) {
          logger.info(`  · ${spec.name} [${lang.language}] — skipped (not in platform language policy)`)
          continue
        }

        const targetName = mode === "cleanup" ? legacyName : spec.name

        if (mode === "cleanup" && legacyName === spec.name) {
          logger.info(
            `  · ${spec.name} [${lang.language}] — spec has no version suffix to strip, nothing to clean up`
          )
          continue
        }

        const matches = existing.data.filter(
          (t) => t.name === targetName && t.language === lang.language
        )

        switch (mode) {
          case "dry-run":
            if (matches.length) {
              logger.info(
                `  · ${targetName} [${lang.language}] — EXISTS (status=${matches[0].status}) — would skip`
              )
            } else {
              logger.info(`  · ${targetName} [${lang.language}] — MISSING — would create`)
            }
            break

          case "upsert":
            if (matches.length) {
              logger.info(
                `  · ${targetName} [${lang.language}] — exists (${matches[0].status}), skipping`
              )
            } else {
              const created = await createTemplate(platform, spec, lang, targetName, logger, metaAppId)
              if ("id" in created) {
                createdIds.push({
                  platform: platform.label,
                  templateId: created.id,
                  name: targetName,
                  language: lang.language,
                })
              }
            }
            break

          case "replace":
            for (const m of matches) {
              await deleteTemplate(platform, m, logger)
            }
            const recreated = await createTemplate(platform, spec, lang, targetName, logger, metaAppId)
            if ("id" in recreated) {
              createdIds.push({
                platform: platform.label,
                templateId: recreated.id,
                name: targetName,
                language: lang.language,
              })
            }
            break

          case "cleanup":
            if (matches.length === 0) {
              logger.info(
                `  · ${legacyName} [${lang.language}] — legacy not found (already clean)`
              )
            } else {
              for (const m of matches) {
                await deleteTemplate(platform, m, logger)
              }
            }
            break
        }
      }
    }
  }

  // ── Poll approval status briefly so the operator sees the outcome ─────────
  if (createdIds.length > 0 && pollSeconds > 0) {
    logger.info(`\n⏳ Polling Meta for approval status (${pollSeconds}s window)...`)
    const deadline = Date.now() + pollSeconds * 1000
    const pending = new Set(createdIds.map((c) => c.templateId))

    while (Date.now() < deadline && pending.size > 0) {
      await sleep(5000)
      for (const item of createdIds) {
        if (!pending.has(item.templateId)) continue
        const status = await fetchTemplateStatus(platforms, item.templateId)
        if (status && status !== "PENDING") {
          logger.info(
            `  ✔ ${item.name} [${item.language}] (${item.platform}) → ${status}`
          )
          pending.delete(item.templateId)
        }
      }
    }

    if (pending.size > 0) {
      logger.warn(
        `  ${pending.size} template(s) still PENDING after ${pollSeconds}s. ` +
          `Check Meta Business Manager or re-run dry-run later.`
      )
    }
  }

  logger.info(`\n✔ Done. mode=${mode}, created=${createdIds.length}`)
}

// ──────────────────────────────────────────────────────────────────────────────
// Meta Graph API helpers
// ──────────────────────────────────────────────────────────────────────────────

async function fetchTemplateStatus(
  platforms: PlatformPlan[],
  templateId: string
): Promise<string | null> {
  for (const p of platforms) {
    try {
      const resp = await fetch(
        `${GRAPH_API_BASE}/${templateId}?fields=id,status,name,language`,
        { headers: { Authorization: `Bearer ${p.accessToken}` } }
      )
      const json = (await resp.json()) as any
      if (resp.ok && typeof json.status === "string") {
        return json.status
      }
    } catch { /* try next platform's token */ }
  }
  return null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

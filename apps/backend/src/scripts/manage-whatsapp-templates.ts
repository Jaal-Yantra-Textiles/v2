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
import { SOCIALS_MODULE } from "../modules/socials"
import type SocialsService from "../modules/socials/service"
import { ENCRYPTION_MODULE } from "../modules/encryption"
import type EncryptionService from "../modules/encryption/service"
import type { EncryptedData } from "../modules/encryption"
import {
  PARTNER_RUN_TEMPLATES,
  languagesForPlatform,
  type TemplateSpec,
  type TemplateLanguageVariant,
} from "./whatsapp-templates/partner-run-templates"

const GRAPH_API_BASE = "https://graph.facebook.com/v21.0"

type Mode = "dry-run" | "upsert" | "replace" | "cleanup"

interface PlatformPlan {
  platformId: string
  label: string
  wabaId: string
  languages: string[]
  accessToken: string
}

interface MetaTemplate {
  id: string
  name: string
  language: string
  status: string
  category?: string
}

export default async function manageWhatsAppTemplates({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const socials = container.resolve(SOCIALS_MODULE) as unknown as SocialsService
  const encryption = container.resolve(ENCRYPTION_MODULE) as EncryptionService

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

  // ── Resolve platform plans ────────────────────────────────────────────────
  const allPlatforms = await socials.findWhatsAppPlatforms()
  const platforms: PlatformPlan[] = []

  for (const p of allPlatforms as any[]) {
    if (platformIdFilter.length && !platformIdFilter.includes(p.id)) continue

    const cfg = (p.api_config ?? {}) as Record<string, any>
    const wabaId = cfg.waba_id as string | undefined
    if (!wabaId) {
      logger.warn(`[${p.id}] skipped — no waba_id configured`)
      continue
    }

    const accessToken = decryptToken(cfg, encryption)
    if (!accessToken) {
      logger.warn(`[${p.id}] skipped — no access token`)
      continue
    }

    platforms.push({
      platformId: p.id,
      label: cfg.label ?? p.name ?? p.id,
      wabaId,
      languages: languagesForPlatform(p),
      accessToken,
    })
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

    for (const spec of PARTNER_RUN_TEMPLATES) {
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
              if (created) {
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
            if (recreated) {
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

type ListResult =
  | { data: MetaTemplate[] }
  | { error: string }

async function fetchExistingTemplates(platform: PlatformPlan): Promise<ListResult> {
  const all: MetaTemplate[] = []
  let url: string | null =
    `${GRAPH_API_BASE}/${platform.wabaId}/message_templates?limit=200&fields=id,name,language,status,category`

  try {
    while (url) {
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${platform.accessToken}` },
      })
      const body = (await resp.json()) as any
      if (!resp.ok) {
        return { error: body?.error?.message ?? `HTTP ${resp.status}` }
      }
      for (const t of body.data ?? []) {
        all.push({
          id: t.id,
          name: t.name,
          language: t.language,
          status: t.status,
          category: t.category,
        })
      }
      url = body.paging?.next ?? null
    }
    return { data: all }
  } catch (e: any) {
    return { error: e?.message ?? "network error" }
  }
}

async function createTemplate(
  platform: PlatformPlan,
  spec: TemplateSpec,
  lang: TemplateLanguageVariant,
  nameToUse: string,
  logger: any,
  metaAppId: string | undefined
): Promise<{ id: string } | null> {
  // For templates with a media header, Meta needs an uploaded media
  // *handle* in example.header_handle — not a public URL. The handle is
  // returned by Meta's app-scoped resumable upload API after we push the
  // image bytes. Do this once per (platform, language) before the
  // template create call. Without metaAppId we can't upload, so skip the
  // header gracefully and let buildComponents emit a body-only template
  // (Meta will then reject if the spec requires the header — that error
  // surfaces clearly).
  let headerHandle: string | undefined
  if (lang.header) {
    if (!metaAppId) {
      logger.error(
        `  ✗ ${nameToUse} [${lang.language}] (${platform.label}) — header configured but META_APP_ID/FACEBOOK_CLIENT_ID is not set; skipping`
      )
      return null
    }
    const handle = await uploadHeaderHandle(
      platform,
      lang.header.example_url,
      metaAppId,
      logger
    )
    if (!handle) {
      // uploadHeaderHandle already logged the specific failure.
      return null
    }
    headerHandle = handle
  }

  const components = buildComponents(lang, headerHandle)
  const body = {
    name: nameToUse,
    language: lang.language,
    category: spec.category,
    components,
  }

  try {
    const resp = await fetch(`${GRAPH_API_BASE}/${platform.wabaId}/message_templates`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${platform.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })
    const json = (await resp.json()) as any
    if (!resp.ok) {
      // Meta's generic "Invalid parameter" hides the real reason in the
      // subcode + error_user_msg fields — print them all so we can diagnose.
      const err = json?.error ?? {}
      const detail = [
        err.message && `msg="${err.message}"`,
        err.error_user_title && `title="${err.error_user_title}"`,
        err.error_user_msg && `user_msg="${err.error_user_msg}"`,
        err.code != null && `code=${err.code}`,
        err.error_subcode != null && `subcode=${err.error_subcode}`,
        err.fbtrace_id && `trace=${err.fbtrace_id}`,
      ]
        .filter(Boolean)
        .join(" ")
      logger.error(
        `  ✗ create ${nameToUse} [${lang.language}] (${platform.label}) — ${detail || `HTTP ${resp.status}`}`
      )
      // Also dump the request body on failure so the operator can reproduce
      // outside the script (paste into Meta's Graph API explorer).
      if (process.env.DEBUG_TEMPLATE_REQUESTS === "1") {
        logger.error(`    request body: ${JSON.stringify(body)}`)
      }
      return null
    }
    logger.info(
      `  ✚ created ${nameToUse} [${lang.language}] (${platform.label}) id=${json.id} status=${json.status ?? "PENDING"}`
    )
    return { id: json.id as string }
  } catch (e: any) {
    logger.error(`  ✗ create ${nameToUse} [${lang.language}] — ${e?.message}`)
    return null
  }
}

async function deleteTemplate(
  platform: PlatformPlan,
  template: MetaTemplate,
  logger: any
): Promise<void> {
  // Meta requires the `name` parameter on DELETE; `hsm_id` pins it to the
  // specific language so we don't wipe every translation at once.
  const url =
    `${GRAPH_API_BASE}/${platform.wabaId}/message_templates?` +
    `name=${encodeURIComponent(template.name)}&hsm_id=${encodeURIComponent(template.id)}`
  try {
    const resp = await fetch(url, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${platform.accessToken}` },
    })
    const json = (await resp.json()) as any
    if (!resp.ok) {
      logger.error(
        `  ✗ delete ${template.name} [${template.language}] (${platform.label}) — ${json?.error?.message ?? resp.status}`
      )
      return
    }
    logger.info(`  ✂ deleted ${template.name} [${template.language}] (${platform.label})`)
  } catch (e: any) {
    logger.error(`  ✗ delete ${template.name} [${template.language}] — ${e?.message}`)
  }
}

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

function buildComponents(
  lang: TemplateLanguageVariant,
  headerHandle?: string
): any[] {
  const components: any[] = []

  // HEADER must come first in Meta's components array. The IMAGE format
  // requires `example.header_handle` to be a HANDLE returned by Meta's
  // resumable-upload API — *not* a plain URL. Meta rejects URLs with
  // subcode 2388273 ("Templates with IMAGE header type need an
  // example/sample"). The handle is computed by uploadHeaderHandle()
  // before this is called and threaded in. VIDEO / DOCUMENT slot in
  // here when we need them, with the same handle approach.
  if (lang.header && headerHandle) {
    components.push({
      type: "HEADER",
      format: lang.header.format,
      example: { header_handle: [headerHandle] },
    })
  }

  const body: any = { type: "BODY", text: lang.body }
  if (lang.examples && lang.examples.length > 0) {
    body.example = { body_text: [lang.examples] }
  }
  components.push(body)

  if (lang.footer) {
    components.push({ type: "FOOTER", text: lang.footer })
  }

  if (lang.buttons && lang.buttons.length > 0) {
    components.push({
      type: "BUTTONS",
      buttons: lang.buttons.map((b) => {
        if (b.type === "URL") {
          return { type: "URL", text: b.text, url: b.url }
        }
        if (b.type === "PHONE_NUMBER") {
          return { type: "PHONE_NUMBER", text: b.text, phone_number: b.phone_number }
        }
        return { type: "QUICK_REPLY", text: b.text }
      }),
    })
  }

  return components
}

/**
 * Upload an image to Meta's app-scoped resumable-upload endpoint and
 * return the handle suitable for use in template `example.header_handle`.
 *
 * Two HTTP calls:
 *   1. POST /<APP_ID>/uploads?file_length=N&file_type=image/jpeg
 *      → { id: "upload:<session>" }
 *   2. POST /<session>  with header `file_offset: 0` and the binary body
 *      → { h: "<handle>" }
 *
 * Auth: the per-platform access_token (Meta system user / WABA-scoped)
 * is what we already use for template creates and lists. It needs the
 * `whatsapp_business_management` scope, which the platform's existing
 * tokens already have for create/list to work.
 *
 * Returns null on any failure; caller logs are sufficient (this helper
 * just relays Meta's error string).
 */
async function uploadHeaderHandle(
  platform: PlatformPlan,
  imageUrl: string,
  metaAppId: string,
  logger: any
): Promise<string | null> {
  try {
    // 1. Download the source image. Meta needs the binary, not the URL.
    const imgResp = await fetch(imageUrl)
    if (!imgResp.ok) {
      logger.error(
        `  ✗ image fetch failed (${imageUrl}): HTTP ${imgResp.status}`
      )
      return null
    }
    const imageBytes = Buffer.from(await imgResp.arrayBuffer())
    const contentType = imgResp.headers.get("content-type") || "image/jpeg"

    // 2. Open a resumable upload session.
    const sessionUrl =
      `${GRAPH_API_BASE}/${metaAppId}/uploads?` +
      `file_length=${imageBytes.length}` +
      `&file_type=${encodeURIComponent(contentType)}`
    const sessionResp = await fetch(sessionUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${platform.accessToken}` },
    })
    const sessionJson = (await sessionResp.json()) as any
    if (!sessionResp.ok || !sessionJson?.id) {
      const err = sessionJson?.error ?? {}
      logger.error(
        `  ✗ upload session failed (${platform.label}): ` +
          `${err.message ?? `HTTP ${sessionResp.status}`}` +
          (err.error_subcode ? ` subcode=${err.error_subcode}` : "")
      )
      return null
    }
    // sessionJson.id is "upload:..." — use as the next path segment.
    const uploadSessionId = String(sessionJson.id)

    // 3. PUT the bytes. Meta's docs use POST for this step (yes, POST
    // even though it semantically uploads). file_offset=0 since we're
    // sending the whole file in one request.
    const uploadResp = await fetch(
      `${GRAPH_API_BASE}/${uploadSessionId}`,
      {
        method: "POST",
        headers: {
          Authorization: `OAuth ${platform.accessToken}`,
          file_offset: "0",
          "Content-Type": "application/octet-stream",
        },
        body: imageBytes,
      }
    )
    const uploadJson = (await uploadResp.json()) as any
    if (!uploadResp.ok || !uploadJson?.h) {
      const err = uploadJson?.error ?? {}
      logger.error(
        `  ✗ upload binary failed (${platform.label}): ` +
          `${err.message ?? `HTTP ${uploadResp.status}`}` +
          (err.error_subcode ? ` subcode=${err.error_subcode}` : "")
      )
      return null
    }
    return uploadJson.h as string
  } catch (e: any) {
    logger.error(`  ✗ upload header handle threw: ${e?.message ?? e}`)
    return null
  }
}

function decryptToken(cfg: Record<string, any>, encryption: EncryptionService): string | null {
  if (cfg.access_token_encrypted) {
    try {
      return encryption.decrypt(cfg.access_token_encrypted as EncryptedData)
    } catch {
      return cfg.access_token || null
    }
  }
  return cfg.access_token || null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Shared Meta (WhatsApp Cloud API) template-sync core.
 *
 * Single source of truth for: resolving WhatsApp SocialPlatforms (waba_id +
 * decrypted access token from the socials module — the SAME credentials used to
 * send messages), listing/creating templates on Meta, and deciding which
 * template×language variants are missing.
 *
 * Consumed by BOTH the CLI script (`manage-whatsapp-templates.ts`) and the
 * Data-Plumbing job (`sync-whatsapp-templates`), so operators can push templates
 * either from the shell or the admin console without duplicating Graph API logic.
 */

import { SOCIALS_MODULE } from "../../modules/socials"
import type SocialsService from "../../modules/socials/service"
import { ENCRYPTION_MODULE } from "../../modules/encryption"
import type EncryptionService from "../../modules/encryption/service"
import type { EncryptedData } from "../../modules/encryption"
import {
  languagesForPlatform,
  type TemplateSpec,
  type TemplateLanguageVariant,
} from "./partner-run-templates"

export const GRAPH_API_BASE = "https://graph.facebook.com/v21.0"

export interface PlatformPlan {
  platformId: string
  label: string
  wabaId: string
  languages: string[]
  accessToken: string
}

export interface MetaTemplate {
  id: string
  name: string
  language: string
  status: string
  category?: string
}

// no-op logger so callers (jobs) that don't thread a logger still work.
const NOOP_LOGGER = {
  info: () => {},
  warn: () => {},
  error: () => {},
} as any

export function decryptToken(
  cfg: Record<string, any>,
  encryption: EncryptionService
): string | null {
  if (cfg.access_token_encrypted) {
    try {
      return encryption.decrypt(cfg.access_token_encrypted as EncryptedData)
    } catch {
      return cfg.access_token || null
    }
  }
  return cfg.access_token || null
}

/**
 * Resolve usable WhatsApp platforms (waba_id + decrypted token) from the socials
 * module — the existing Facebook/WhatsApp social-provider keys. Returns the plan
 * list plus a `skipped` roll-up (no waba_id / no token) for operator feedback.
 */
export async function resolveWhatsAppPlatforms(
  container: any,
  opts: { platformIdFilter?: string[] } = {}
): Promise<{ platforms: PlatformPlan[]; skipped: Array<{ id: string; reason: string }> }> {
  const socials = container.resolve(SOCIALS_MODULE) as unknown as SocialsService
  const encryption = container.resolve(ENCRYPTION_MODULE) as unknown as EncryptionService
  const filter = opts.platformIdFilter ?? []

  const all = await (socials as any).findWhatsAppPlatforms()
  const platforms: PlatformPlan[] = []
  const skipped: Array<{ id: string; reason: string }> = []

  for (const p of (all ?? []) as any[]) {
    if (filter.length && !filter.includes(p.id)) continue
    const cfg = (p.api_config ?? {}) as Record<string, any>
    const wabaId = cfg.waba_id as string | undefined
    if (!wabaId) {
      skipped.push({ id: p.id, reason: "no_waba_id" })
      continue
    }
    const accessToken = decryptToken(cfg, encryption)
    if (!accessToken) {
      skipped.push({ id: p.id, reason: "no_access_token" })
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
  return { platforms, skipped }
}

type ListResult = { data: MetaTemplate[] } | { error: string }

export async function fetchExistingTemplates(platform: PlatformPlan): Promise<ListResult> {
  const all: MetaTemplate[] = []
  let url: string | null =
    `${GRAPH_API_BASE}/${platform.wabaId}/message_templates?limit=200&fields=id,name,language,status,category`
  try {
    while (url) {
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${platform.accessToken}` },
      })
      const body = (await resp.json()) as any
      if (!resp.ok) return { error: body?.error?.message ?? `HTTP ${resp.status}` }
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

// ── Pure planning ───────────────────────────────────────────────────────────

export type TemplateActionKind = "create" | "exists" | "lang-skipped"

export interface PlannedTemplateAction {
  platformId: string
  platformLabel: string
  name: string
  language: string
  kind: TemplateActionKind
  existingStatus?: string
}

/**
 * Pure: for each platform × template × language, decide whether the variant is
 * missing (create), already on the WABA (exists), or not in the platform's
 * language policy (lang-skipped). No network — given the existing list. Unit
 * tested. The Data-Plumbing dry-run shows exactly this.
 */
export function planTemplateActions(
  platforms: PlatformPlan[],
  templates: TemplateSpec[],
  existingByPlatformId: Record<string, MetaTemplate[]>
): PlannedTemplateAction[] {
  const actions: PlannedTemplateAction[] = []
  for (const platform of platforms) {
    const existing = existingByPlatformId[platform.platformId] ?? []
    for (const spec of templates) {
      for (const lang of spec.languages) {
        if (!platform.languages.includes(lang.language)) {
          actions.push({
            platformId: platform.platformId,
            platformLabel: platform.label,
            name: spec.name,
            language: lang.language,
            kind: "lang-skipped",
          })
          continue
        }
        const match = existing.find(
          (t) => t.name === spec.name && t.language === lang.language
        )
        actions.push({
          platformId: platform.platformId,
          platformLabel: platform.label,
          name: spec.name,
          language: lang.language,
          kind: match ? "exists" : "create",
          existingStatus: match?.status,
        })
      }
    }
  }
  return actions
}

// ── Meta create (+ media header upload) ─────────────────────────────────────

export function buildComponents(
  lang: TemplateLanguageVariant,
  headerHandle?: string
): any[] {
  const components: any[] = []
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
  if (lang.footer) components.push({ type: "FOOTER", text: lang.footer })
  if (lang.buttons && lang.buttons.length > 0) {
    components.push({
      type: "BUTTONS",
      buttons: lang.buttons.map((b) => {
        if (b.type === "URL") return { type: "URL", text: b.text, url: b.url }
        if (b.type === "PHONE_NUMBER")
          return { type: "PHONE_NUMBER", text: b.text, phone_number: b.phone_number }
        return { type: "QUICK_REPLY", text: b.text }
      }),
    })
  }
  return components
}

/**
 * Upload an image to Meta's app-scoped resumable-upload endpoint, returning the
 * handle for `example.header_handle`. Only needed for templates with a media
 * header. Returns null on any failure (caller logs).
 */
export async function uploadHeaderHandle(
  platform: PlatformPlan,
  imageUrl: string,
  metaAppId: string,
  logger: any = NOOP_LOGGER
): Promise<string | null> {
  try {
    const imgResp = await fetch(imageUrl)
    if (!imgResp.ok) {
      logger.error(`  ✗ image fetch failed (${imageUrl}): HTTP ${imgResp.status}`)
      return null
    }
    const imageBytes = Buffer.from(await imgResp.arrayBuffer())
    const contentType = imgResp.headers.get("content-type") || "image/jpeg"

    const sessionUrl =
      `${GRAPH_API_BASE}/${metaAppId}/uploads?` +
      `file_length=${imageBytes.length}&file_type=${encodeURIComponent(contentType)}`
    const sessionResp = await fetch(sessionUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${platform.accessToken}` },
    })
    const sessionJson = (await sessionResp.json()) as any
    if (!sessionResp.ok || !sessionJson?.id) {
      const err = sessionJson?.error ?? {}
      logger.error(
        `  ✗ upload session failed (${platform.label}): ${err.message ?? `HTTP ${sessionResp.status}`}` +
          (err.error_subcode ? ` subcode=${err.error_subcode}` : "")
      )
      return null
    }
    const uploadSessionId = String(sessionJson.id)

    const uploadResp = await fetch(`${GRAPH_API_BASE}/${uploadSessionId}`, {
      method: "POST",
      headers: {
        Authorization: `OAuth ${platform.accessToken}`,
        file_offset: "0",
        "Content-Type": "application/octet-stream",
      },
      body: imageBytes,
    })
    const uploadJson = (await uploadResp.json()) as any
    if (!uploadResp.ok || !uploadJson?.h) {
      const err = uploadJson?.error ?? {}
      logger.error(
        `  ✗ upload binary failed (${platform.label}): ${err.message ?? `HTTP ${uploadResp.status}`}` +
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

export async function createTemplate(
  platform: PlatformPlan,
  spec: TemplateSpec,
  lang: TemplateLanguageVariant,
  nameToUse: string,
  logger: any = NOOP_LOGGER,
  metaAppId?: string
): Promise<{ id: string } | { error: string }> {
  let headerHandle: string | undefined
  if (lang.header) {
    if (!metaAppId) {
      const error = `header configured but META_APP_ID/FACEBOOK_CLIENT_ID not set`
      logger.error(`  ✗ ${nameToUse} [${lang.language}] (${platform.label}) — ${error}`)
      return { error }
    }
    const handle = await uploadHeaderHandle(platform, lang.header.example_url, metaAppId, logger)
    if (!handle) return { error: "header media upload failed" }
    headerHandle = handle
  }

  const components = buildComponents(lang, headerHandle)
  const reqBody = { name: nameToUse, language: lang.language, category: spec.category, components }

  try {
    const resp = await fetch(`${GRAPH_API_BASE}/${platform.wabaId}/message_templates`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${platform.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(reqBody),
    })
    const json = (await resp.json()) as any
    if (!resp.ok) {
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
      return { error: detail || `HTTP ${resp.status}` }
    }
    logger.info(
      `  ✚ created ${nameToUse} [${lang.language}] (${platform.label}) id=${json.id} status=${json.status ?? "PENDING"}`
    )
    return { id: json.id as string }
  } catch (e: any) {
    logger.error(`  ✗ create ${nameToUse} [${lang.language}] — ${e?.message}`)
    return { error: e?.message ?? "network error" }
  }
}

export async function deleteTemplate(
  platform: PlatformPlan,
  template: MetaTemplate,
  logger: any = NOOP_LOGGER
): Promise<void> {
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

// ── High-level orchestrator (used by the Data-Plumbing job) ─────────────────

export interface SyncTemplateResult {
  platformsUsed: Array<{ id: string; label: string }>
  platformsSkipped: Array<{ id: string; reason: string }>
  /** create actions that were applied (or would be on apply). */
  toCreate: PlannedTemplateAction[]
  existing: PlannedTemplateAction[]
  created: Array<{ platformId: string; name: string; language: string; id: string }>
  errors: Array<{ platformId: string; name: string; language: string; message: string }>
  /** per-platform list failures (couldn't read existing templates). */
  listErrors: Array<{ platformId: string; message: string }>
}

/**
 * Resolve platforms → list existing → plan → (optionally) create missing.
 * `apply=false` previews (no writes). Used by the sync-whatsapp-templates job.
 */
export async function syncWhatsAppTemplates(
  container: any,
  opts: {
    templates: TemplateSpec[]
    apply: boolean
    platformIdFilter?: string[]
    metaAppId?: string
    logger?: any
  }
): Promise<SyncTemplateResult> {
  const logger = opts.logger ?? NOOP_LOGGER
  const metaAppId =
    opts.metaAppId || process.env.META_APP_ID || process.env.FACEBOOK_CLIENT_ID || undefined

  const { platforms, skipped } = await resolveWhatsAppPlatforms(container, {
    platformIdFilter: opts.platformIdFilter,
  })

  const result: SyncTemplateResult = {
    platformsUsed: platforms.map((p) => ({ id: p.platformId, label: p.label })),
    platformsSkipped: skipped,
    toCreate: [],
    existing: [],
    created: [],
    errors: [],
    listErrors: [],
  }

  const existingByPlatformId: Record<string, MetaTemplate[]> = {}
  const reachable: PlatformPlan[] = []
  for (const platform of platforms) {
    const listed = await fetchExistingTemplates(platform)
    if ("error" in listed) {
      result.listErrors.push({ platformId: platform.platformId, message: listed.error })
      continue
    }
    existingByPlatformId[platform.platformId] = listed.data
    reachable.push(platform)
  }

  const actions = planTemplateActions(reachable, opts.templates, existingByPlatformId)
  result.toCreate = actions.filter((a) => a.kind === "create")
  result.existing = actions.filter((a) => a.kind === "exists")

  if (opts.apply) {
    const byId = new Map(reachable.map((p) => [p.platformId, p]))
    const specByName = new Map(opts.templates.map((t) => [t.name, t]))
    for (const a of result.toCreate) {
      const platform = byId.get(a.platformId)!
      const spec = specByName.get(a.name)!
      const lang = spec.languages.find((l) => l.language === a.language)!
      const res = await createTemplate(platform, spec, lang, spec.name, logger, metaAppId)
      if ("id" in res) {
        result.created.push({
          platformId: a.platformId,
          name: a.name,
          language: a.language,
          id: res.id,
        })
      } else {
        result.errors.push({
          platformId: a.platformId,
          name: a.name,
          language: a.language,
          message: res.error,
        })
      }
    }
  }

  return result
}

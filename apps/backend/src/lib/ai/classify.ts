/**
 * Pre-classification — ask a System One model a closed question, from anywhere
 * an LLM task makes a categorical choice (#2249).
 *
 * A generative model asked "which of these?" answers in prose we then parse,
 * rate-limits, or — as Cloudflare's glm-4.7-flash did on a capability scan —
 * reasons for 84s and returns nothing. A System One model (TypeSafe's Jev, or
 * Codiv's OpenJev on the same wire format) answers the choice as typed data
 * with a confidence, in about a second. Callers use this FIRST and keep their
 * existing path for when it answers `null`.
 *
 * ## Configured where every AI key already lives
 *
 * An AI platform row (`social_platform`, category `ai`) with:
 *   - `metadata.role = "ai_classification"` — its own role, so a System One row
 *     can never be picked up by the text-LLM resolver (which would reject the
 *     provider and silently fall back to free models);
 *   - `metadata.provider_type = "typesafe" | "codiv"`;
 *   - `metadata.pre_classification = true` — the switch. OFF unless set: a row
 *     that exists but is not switched on does nothing;
 *   - `metadata.scopes = ["partner_capability_scan", …]` or `["*"]` — which
 *     tasks it serves. An exact scope beats `*`; then `is_default`; then newest.
 *   - the key in `api_config` (encrypted by the socials subscriber), optional
 *     `api_config.base_url` / `default_model` overrides.
 *
 * Outside production, the TYPESAFE_API_KEY env var still works as a fallback
 * for local development. In production only a platform row can turn this on,
 * so there is one place to see and switch it.
 *
 * 🔴 `classify` never throws and answers `null` for off / unconfigured / failed:
 * pre-classification must never be able to fail the task it is helping.
 */
import { SOCIALS_MODULE } from "../../modules/socials"
import { decryptApiKey } from "../../modules/socials/utils/token-helpers"
import { askSystemOne, type Question, type SystemOneResult } from "./typesafe"

export const CLASSIFICATION_ROLE = "ai_classification"

export type SystemOneProvider = "typesafe" | "codiv"

export const SYSTEM_ONE_PROVIDERS: Record<SystemOneProvider, { url: string; model: string }> = {
  typesafe: { url: "https://api.typesafe.ai/v1/systemone", model: "jev-latest" },
  codiv: { url: "https://api.codiv.ai/v1/systemone", model: "openjev-latest" },
}

export type ResolvedClassifier = {
  provider: SystemOneProvider
  url: string
  model: string
  apiKey: string
  /** The platform row, or "env" for the local-development fallback. */
  platformId: string
}

const isOn = (v: unknown) => v === true || v === "true"

const scopesOf = (meta: Record<string, any>): string[] => {
  const raw = meta.scopes
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : []
  return list.map((s) => String(s).trim()).filter(Boolean)
}

/**
 * PURE. Pick the row that serves `scope`, or null. Exported for tests.
 * Only active, switched-on, System-One rows are candidates.
 */
export const pickClassifierRow = (rows: any[], scope: string): any | null => {
  const candidates = (rows ?? []).filter((r) => {
    const meta = (r?.metadata ?? {}) as Record<string, any>
    const provider = String(meta.provider_type ?? r?.api_config?.provider_type ?? "").toLowerCase()
    if (r?.status !== "active" || r?.category !== "ai") return false
    if (meta.role !== CLASSIFICATION_ROLE) return false
    if (!(provider in SYSTEM_ONE_PROVIDERS)) return false
    if (!isOn(meta.pre_classification)) return false
    const scopes = scopesOf(meta)
    return scopes.includes(scope) || scopes.includes("*")
  })
  const rank = (r: any) => {
    const meta = r.metadata ?? {}
    return [
      scopesOf(meta).includes(scope) ? 0 : 1, // exact scope beats "*"
      meta.is_default === true ? 0 : 1,
      -Date.parse(r.updated_at ?? r.created_at ?? 0) || 0,
    ]
  }
  candidates.sort((a, b) => {
    const [x, y] = [rank(a), rank(b)]
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]
    return 0
  })
  return candidates[0] ?? null
}

/**
 * The classifier serving `scope`, or null when pre-classification is off for
 * it. Never throws.
 */
export const resolveClassifier = async (
  container: any,
  scope: string
): Promise<ResolvedClassifier | null> => {
  try {
    const socials: any = container.resolve(SOCIALS_MODULE)
    const rows = await socials.listSocialPlatforms(
      { category: "ai", status: "active", metadata: { role: CLASSIFICATION_ROLE } } as any,
      { take: 20 }
    )
    const row = pickClassifierRow(rows, scope)
    if (row) {
      const meta = row.metadata ?? {}
      const cfg = (row.api_config ?? {}) as Record<string, any>
      const provider = String(meta.provider_type ?? cfg.provider_type).toLowerCase() as SystemOneProvider
      const apiKey = decryptApiKey(cfg, container)
      if (apiKey) {
        return {
          provider,
          url: String(cfg.base_url || row.base_url || SYSTEM_ONE_PROVIDERS[provider].url),
          model: String(cfg.default_model || SYSTEM_ONE_PROVIDERS[provider].model),
          apiKey,
          platformId: row.id,
        }
      }
    }
  } catch {
    /* fall through to the dev fallback / off */
  }

  const envKey = String(process.env.TYPESAFE_API_KEY ?? "").trim()
  if (envKey && process.env.NODE_ENV !== "production") {
    return { provider: "typesafe", ...SYSTEM_ONE_PROVIDERS.typesafe, apiKey: envKey, platformId: "env" }
  }
  return null
}

/**
 * Pre-classify: ask closed questions about `state` if a classifier serves
 * `scope`. Returns the typed answers plus which provider answered, or null —
 * the caller's cue to take its existing path.
 */
export const classify = async (
  container: any,
  input: {
    scope: string
    state: unknown
    questions: Record<string, Question>
    timeoutMs?: number
    /** Reuse a classifier resolved once for a batch of calls. */
    classifier?: ResolvedClassifier | null
  }
): Promise<(SystemOneResult & { provider: SystemOneProvider; platformId: string }) | null> => {
  const classifier = input.classifier === undefined ? await resolveClassifier(container, input.scope) : input.classifier
  if (!classifier) return null
  let logger: any
  try {
    logger = container.resolve("logger")
  } catch {
    /* optional */
  }
  const result = await askSystemOne(
    { state: input.state, questions: input.questions },
    { apiKey: classifier.apiKey, url: classifier.url, model: classifier.model, timeoutMs: input.timeoutMs, logger }
  )
  return result ? { ...result, provider: classifier.provider, platformId: classifier.platformId } : null
}

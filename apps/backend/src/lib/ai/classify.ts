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
 *     `api_config.base_url` / `default_model` overrides, and optional
 *     `metadata.options` (Codiv: `steps`, `samples`, `think`) over the
 *     provider defaults in SYSTEM_ONE_PROVIDERS.
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

/**
 * Per-provider defaults. `options` are extra request fields the provider
 * understands, overridable per row via `metadata.options`.
 *
 * 🔴 Codiv at its default ONE denoise step was confidently wrong on real
 * evidence (tussar → "home textile", ikat pashmina → "bag", a pattern-cutting
 * job → material "pashmina" at 0.82). At `steps: 4` the same items all came back
 * right at ~1.00, in 2.1s (measured 2026-09-24). `samples` fixes it too but
 * multiplies input tokens by the sample count.
 */
export const SYSTEM_ONE_PROVIDERS: Record<
  SystemOneProvider,
  {
    url: string
    model: string
    options: Record<string, number>
    allowed: string[]
    /**
     * Questions to put in ONE request. Measured 2026-09-24 on 9 real items ×
     * 3 choices: Codiv was 27/27 at 9 questions per request but 17/27 — ten of
     * them wrong AND confident — at 27 in one request, so a batch must stay
     * small. TypeSafe answered all 27 in one request, correctly.
     */
    maxQuestions: number
  }
> = {
  typesafe: { url: "https://api.typesafe.ai/v1/systemone", model: "jev-latest", options: {}, allowed: [], maxQuestions: 36 },
  codiv: {
    url: "https://api.codiv.ai/v1/systemone",
    model: "openjev-latest",
    options: { steps: 4 },
    allowed: ["steps", "samples", "think"],
    maxQuestions: 9,
  },
}

/** PURE. Provider defaults overlaid with a row's whitelisted, numeric options. */
export const optionsFor = (provider: SystemOneProvider, rowOptions: unknown): Record<string, number> => {
  const spec = SYSTEM_ONE_PROVIDERS[provider]
  const out: Record<string, number> = { ...spec.options }
  if (rowOptions && typeof rowOptions === "object") {
    for (const [k, v] of Object.entries(rowOptions as Record<string, unknown>)) {
      const n = Number(v)
      if (spec.allowed.includes(k) && Number.isInteger(n) && n >= 0) out[k] = n
    }
  }
  return out
}

export type ResolvedClassifier = {
  provider: SystemOneProvider
  url: string
  model: string
  apiKey: string
  /** Extra request fields (Codiv `steps`…), provider defaults + row overrides. */
  options?: Record<string, number>
  /** How many questions a caller may put in one request for this provider. */
  maxQuestions?: number
  /** The platform row, or "env" for the local-development fallback. */
  platformId: string
}

const isOn = (v: unknown) => v === true || v === "true"

const positiveInt = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : null
}

const scopesOf = (meta: Record<string, any>): string[] => {
  const raw = meta.scopes
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : []
  return list.map((s) => String(s).trim()).filter(Boolean)
}

/**
 * PURE. Pick the row that serves `scope`, or null. Exported for tests.
 * Only active, switched-on, System-One rows are candidates.
 */
export const pickClassifierRow = (rows: any[], scope: string): any | null =>
  rankClassifierRows(rows, scope)[0] ?? null

/**
 * PURE. Every row that serves `scope`, best first — the failover order.
 * Codiv answered 529 "temporarily unavailable" and hung for 60s on 2026-09-24;
 * with a second row for the same scope, an outage moves to it rather than
 * straight to the caller's fallback.
 */
export const rankClassifierRows = (rows: any[], scope: string): any[] => {
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
  return candidates
}

/** Turn one row into a usable classifier, or null (unknown provider, no key). */
const classifierFromRow = (row: any, container: any): ResolvedClassifier | null => {
  const meta = row.metadata ?? {}
  const cfg = (row.api_config ?? {}) as Record<string, any>
  const provider = String(meta.provider_type ?? cfg.provider_type).toLowerCase() as SystemOneProvider
  if (!(provider in SYSTEM_ONE_PROVIDERS)) return null
  const apiKey = decryptApiKey(cfg, container)
  if (!apiKey) return null
  return {
    provider,
    url: String(cfg.base_url || row.base_url || SYSTEM_ONE_PROVIDERS[provider].url),
    model: String(cfg.default_model || SYSTEM_ONE_PROVIDERS[provider].model),
    apiKey,
    options: optionsFor(provider, meta.options),
    maxQuestions: positiveInt(meta.max_questions) ?? SYSTEM_ONE_PROVIDERS[provider].maxQuestions,
    platformId: row.id,
  }
}

/**
 * Every classifier serving `scope`, best first (the failover order). Empty
 * when pre-classification is off for it. Never throws.
 */
export const resolveClassifiers = async (
  container: any,
  scope: string
): Promise<ResolvedClassifier[]> => {
  const out: ResolvedClassifier[] = []
  try {
    const socials: any = container.resolve(SOCIALS_MODULE)
    const rows = await socials.listSocialPlatforms(
      { category: "ai", status: "active", metadata: { role: CLASSIFICATION_ROLE } } as any,
      { take: 20 }
    )
    for (const row of rankClassifierRows(rows, scope)) {
      const c = classifierFromRow(row, container)
      if (c) out.push(c)
    }
  } catch {
    /* fall through to the dev fallback / off */
  }

  // Local development only: in production just a platform row can switch it on.
  const envKey = String(process.env.TYPESAFE_API_KEY ?? "").trim()
  if (!out.length && envKey && process.env.NODE_ENV !== "production") {
    const { url, model, maxQuestions } = SYSTEM_ONE_PROVIDERS.typesafe
    out.push({ provider: "typesafe", url, model, apiKey: envKey, options: {}, maxQuestions, platformId: "env" })
  }
  return out
}

/** The best classifier serving `scope`, or null when it is off. Never throws. */
export const resolveClassifier = async (
  container: any,
  scope: string
): Promise<ResolvedClassifier | null> => (await resolveClassifiers(container, scope))[0] ?? null

/**
 * Pre-classify: ask closed questions about `state` of the classifiers serving
 * `scope`, in failover order. Returns the typed answers plus which provider
 * answered, or null — the caller's cue to take its existing path.
 */
export const classify = async (
  container: any,
  input: {
    scope: string
    state: unknown
    questions: Record<string, Question>
    timeoutMs?: number
    /** Use exactly this classifier (a caller doing its own failover). */
    classifier?: ResolvedClassifier | null
  }
): Promise<(SystemOneResult & { provider: SystemOneProvider; platformId: string }) | null> => {
  const classifiers =
    input.classifier !== undefined
      ? input.classifier
        ? [input.classifier]
        : []
      : await resolveClassifiers(container, input.scope)
  let logger: any
  try {
    logger = container.resolve("logger")
  } catch {
    /* optional */
  }
  for (const c of classifiers) {
    const result = await askSystemOne(
      { state: input.state, questions: input.questions },
      { apiKey: c.apiKey, url: c.url, model: c.model, extra: c.options, timeoutMs: input.timeoutMs, logger }
    )
    if (result) return { ...result, provider: c.provider, platformId: c.platformId }
    logger?.warn?.(`[classify] ${c.provider} (${c.platformId}) did not answer for scope ${input.scope}; trying the next`)
  }
  return null
}

/**
 * TypeSafe System One — a typed judgment, instead of prose we have to parse.
 *
 * ## Why this sits beside `model-json.ts` rather than replacing it
 *
 * `lib/ai/model-json.ts` exists because this app runs on free/rotating models
 * that do not honour structured output: `stealth/ox-alpha` returned a correct
 * answer as markdown prose with `response.object` undefined, and *advertises*
 * `response_format` support. So every categorical answer has to survive a
 * balanced-brace scanner and, in `product-type.ts`, a regex for
 * `**product_type:** trousers`.
 *
 * That whole apparatus is recovery from a generative model being asked a
 * question whose answer was never open-ended. System One returns the answer as
 * data: one option from a list we supplied, plus the probability distribution
 * across all of them. There is nothing to parse, and the model cannot name a
 * garment we did not offer.
 *
 * 🔑 Prose generation is NOT in scope here and `model-json.ts` stays: newsletter
 * drafts, SEO metadata and design descriptions genuinely generate text. This is
 * only for the decisions that were always a choice.
 *
 * ## Deliberately no SDK dependency
 *
 * `@typesafe-ai/sdk` is the documented path. This uses the HTTP API and native
 * `fetch` instead, because `shamefully-hoist` gives this repo ONE version slot
 * per package across every workspace — adding a dependency is a decision with
 * blast radius, and a first integration should not need one to be evaluated.
 * Swap to the SDK once this has earned its place.
 *
 * API: POST https://api.typesafe.ai/v1/systemone
 */

const TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone"
const DEFAULT_MODEL = "jev-latest"
const DEFAULT_TIMEOUT_MS = 8000

/**
 * Criteria for one option: a bare description, or the structured form the docs
 * recommend when options are easily confused.
 */
export type OptionCriteria =
  | string
  | null
  | {
      what?: string
      not_for?: string
      examples?: string[]
    }

export type ChoiceQuestion = {
  type: "choice"
  instructions: string
  criteria: Record<string, OptionCriteria>
}

export type ChoiceAnswer = {
  type: "choice"
  choice: string
  probabilities: Record<string, number>
  confidence: number
}

export type SystemOneResult = {
  model: string
  answers: Record<string, ChoiceAnswer>
  usage?: { input_tokens?: number; output_tokens?: number }
}

/** PURE. A Choice question, shaped for the wire. */
export function choice(
  instructions: string,
  criteria: Record<string, OptionCriteria>
): ChoiceQuestion {
  return { type: "choice", instructions, criteria }
}

/** Is System One configured at all? Callers fall back when it is not. */
export function typeSafeConfigured(): boolean {
  return !!String(process.env.TYPESAFE_API_KEY ?? "").trim()
}

/**
 * Ask System One. Returns null when unconfigured, on any transport or HTTP
 * error, and on a malformed body.
 *
 * 🔴 Null, never a throw. Every caller so far runs inside something a person is
 * waiting on — a design being saved, an order being placed — and the rule those
 * paths already enforce is that inference must not be able to fail the thing
 * that triggered it. A caller that genuinely needs the distinction can check
 * `typeSafeConfigured()` first.
 *
 * ⚠️ The shape is validated rather than cast. A 200 carrying an error envelope,
 * or a future response shape, must read as "no answer" — not as an answer whose
 * `choice` is `undefined`, which would sail through a bare cast and be stored.
 */
export async function askSystemOne(
  input: {
    state: unknown
    questions: Record<string, ChoiceQuestion>
  },
  opts: { model?: string; timeoutMs?: number; logger?: any } = {}
): Promise<SystemOneResult | null> {
  const apiKey = String(process.env.TYPESAFE_API_KEY ?? "").trim()
  if (!apiKey) return null

  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  )

  try {
    const res = await fetch(TYPESAFE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        state: input.state,
        model: opts.model ?? DEFAULT_MODEL,
        questions: input.questions,
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      // The body often names the problem (a bad option key, a token overrun).
      // Truncated: this goes to a log line, not a report.
      const detail = await res.text().catch(() => "")
      opts.logger?.warn?.(
        `[typesafe] ${res.status} ${res.statusText}: ${detail.slice(0, 300)}`
      )
      return null
    }

    return readSystemOneResult(await res.json())
  } catch (err) {
    opts.logger?.warn?.(
      `[typesafe] request failed: ${
        err instanceof Error ? err.message : String(err)
      }`
    )
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * PURE. Validate a System One body into the shape callers may rely on.
 * Exported for tests — this is the whole trust boundary.
 */
export function readSystemOneResult(body: unknown): SystemOneResult | null {
  if (!body || typeof body !== "object") return null
  const raw = body as Record<string, unknown>

  const answers = raw.answers
  if (!answers || typeof answers !== "object") return null

  const out: Record<string, ChoiceAnswer> = {}
  for (const [id, value] of Object.entries(answers as Record<string, unknown>)) {
    const answer = readChoiceAnswer(value)
    if (answer) out[id] = answer
  }

  // Every answer unreadable is the same as no answer: a caller looking up its
  // one question id would find undefined and have to guess why.
  if (!Object.keys(out).length) return null

  return {
    model: typeof raw.model === "string" ? raw.model : "",
    answers: out,
    usage: (raw.usage as SystemOneResult["usage"]) ?? undefined,
  }
}

/** PURE. One answer, or null if it is not a usable choice. */
function readChoiceAnswer(value: unknown): ChoiceAnswer | null {
  if (!value || typeof value !== "object") return null
  const v = value as Record<string, unknown>

  const picked = typeof v.choice === "string" ? v.choice.trim() : ""
  if (!picked) return null

  /**
   * Two traps, one guard, and the tests for both were written before the code
   * was right — each caught a real defect in the first draft.
   *
   * 🔴 The TYPE is checked before any coercion. `Number(null)` is `0`, and `0`
   * is a legitimate confidence, so coercing first lets a null through as
   * "perfectly flat distribution" and stores it. Same for `""` and `[]`.
   *
   * ⚠️ And the range check uses `Number.isFinite`, never a truthiness test. A
   * genuinely flat distribution answers `0`, and `!0` is true — a truthy guard
   * would reject exactly the answer a caller most needs to see and make total
   * uncertainty look like a transport failure.
   */
  if (typeof v.confidence !== "number") return null
  const confidence = v.confidence
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return null
  }

  const probabilities: Record<string, number> = {}
  if (v.probabilities && typeof v.probabilities === "object") {
    for (const [key, p] of Object.entries(
      v.probabilities as Record<string, unknown>
    )) {
      const n = Number(p)
      if (Number.isFinite(n)) probabilities[key] = n
    }
  }

  return { type: "choice", choice: picked, probabilities, confidence }
}

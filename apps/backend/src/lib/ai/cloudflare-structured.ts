/**
 * Cloudflare Workers AI — a model tier that actually honours a JSON schema.
 *
 * ## Why this exists
 *
 * The design-type inference (#938) first ran on `dynamicFreeTextModel`, which
 * rotates through OpenRouter's FREE pool. That pool is ranked by context length
 * and filtered only for text output, so it picked `stealth/ox-alpha` — which
 * **advertises `response_format` in `supported_parameters` and then ignores
 * it**, returning markdown prose with `response.object` undefined. Every call
 * failed.
 *
 * 🔑 The lesson worth keeping: a model's advertised capability is a CLAIM, not
 * a guarantee. Filtering the free pool on `supported_parameters` would not have
 * avoided that failure, because the model that broke it advertises the flag.
 *
 * Cloudflare Workers AI was measured, not assumed: four models were probed and
 * all four returned clean schema-conforming JSON. Its free allowance (10k
 * neurons/day) is real, and a classification call this small is cheap.
 *
 * ## Why plain fetch and not an AI SDK provider
 *
 * Cloudflare exposes an OpenAI-compatible endpoint, but the hoisted
 * `@ai-sdk/openai-compatible` in this workspace is a v3-spec provider while the
 * backend is on `ai@5` (v2 spec) — `generateObject` rejects it with
 * "Unsupported model version v3". Rather than perturb the dependency graph for
 * one classification call, this speaks the REST API directly. No new dependency,
 * no version conflict, and the request shape is four lines.
 *
 * This is deliberately NOT a general-purpose model provider. It is a narrow
 * "ask a small model for a small JSON object" helper. Anything conversational
 * should keep using the Mastra agents.
 */

/** Ordered by measured quality on the classification probe. */
export const CLOUDFLARE_STRUCTURED_MODELS = [
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/mistralai/mistral-small-3.1-24b-instruct",
  "@cf/qwen/qwen2.5-coder-32b-instruct",
  "@cf/meta/llama-3.1-8b-instruct",
] as const

export type JsonSchema = Record<string, unknown>

/** True when the account id and token are both present. */
export function isCloudflareAiConfigured(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return Boolean(env.CLOUDFLARE_AI_ACCOUNT_ID && env.CLOUDFLARE_AI_TOKEN)
}

/**
 * PURE. Pull the model's answer out of a Workers AI response envelope.
 *
 * Workers AI wraps everything in `{ success, result, errors }`, and `result`
 * may carry the answer as an already-parsed object OR as a JSON string,
 * depending on the model. Both were seen on the same probe run, so both are
 * handled rather than whichever one happened to come back first.
 */
export function readCloudflareResult(body: unknown): unknown {
  if (!body || typeof body !== "object") return null
  const envelope = body as Record<string, any>
  if (envelope.success === false) return null

  const result = envelope.result
  if (result === undefined || result === null) return null

  const response = typeof result === "object" ? result.response ?? result : result

  if (typeof response === "string") {
    try {
      return JSON.parse(response)
    } catch {
      // A string that is not JSON is still worth handing back — the caller's
      // tolerant parser can read labelled prose out of it.
      return response
    }
  }
  return response
}

export type CloudflareStructuredResult = {
  /** Parsed object, or a raw string when the model answered in prose. */
  value: unknown
  model: string
}

/**
 * Ask Workers AI for an object matching `schema`.
 *
 * Walks `CLOUDFLARE_STRUCTURED_MODELS` in order and returns the first usable
 * answer. Returns null — never throws — when nothing is configured or every
 * model fails, so a caller can fall through to another tier. An inference is
 * never worth failing the request that triggered it.
 */
export async function generateStructuredWithCloudflare(args: {
  prompt: string
  schema: JsonSchema
  models?: readonly string[]
  timeoutMs?: number
  env?: NodeJS.ProcessEnv
  logger?: { warn?: (m: string) => void }
}): Promise<CloudflareStructuredResult | null> {
  const env = args.env ?? process.env
  if (!isCloudflareAiConfigured(env)) return null

  const accountId = env.CLOUDFLARE_AI_ACCOUNT_ID
  const token = env.CLOUDFLARE_AI_TOKEN
  const models = args.models ?? CLOUDFLARE_STRUCTURED_MODELS
  const timeoutMs = args.timeoutMs ?? 15_000

  for (const model of models) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messages: [{ role: "user", content: args.prompt }],
            response_format: { type: "json_schema", json_schema: args.schema },
          }),
          signal: controller.signal,
        }
      )

      if (!res.ok) {
        args.logger?.warn?.(
          `[cloudflare-ai] ${model} returned ${res.status}; trying next model`
        )
        continue
      }

      const value = readCloudflareResult(await res.json())
      if (value === null) {
        args.logger?.warn?.(`[cloudflare-ai] ${model} returned no usable result`)
        continue
      }
      return { value, model }
    } catch (err) {
      args.logger?.warn?.(
        `[cloudflare-ai] ${model} failed: ${
          err instanceof Error ? err.message : String(err)
        }`
      )
    } finally {
      clearTimeout(timer)
    }
  }

  return null
}

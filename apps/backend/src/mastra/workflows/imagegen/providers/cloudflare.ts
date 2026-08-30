/**
 * Cloudflare Workers AI image generation.
 *
 * Uses the `@cf/black-forest-labs/flux-1-schnell` text-to-image model through
 * the Workers AI REST API (returns base64 PNG). Credentials come from the
 * resolved `ai_image_gen` External Platform (Cloudflare) — account id + bearer
 * token — passed down from the Medusa workflow (the Mastra runtime has no
 * container, so the caller hands us the config).
 *
 * @see https://developers.cloudflare.com/workers-ai/models/flux-1-schnell/
 */

export type CloudflareImageConfig = {
  api_key: string
  account_id: string
  /** Model id; defaults to the fast FLUX schnell model. */
  model?: string | null
}

export type CloudflareGenerationResult = {
  success: boolean
  imageUrl?: string
  provider: "cloudflare"
  modelUsed?: string
  error?: string
  errorCode?: "RATE_LIMITED" | "SERVER_ERROR" | "NETWORK_ERROR" | "UNKNOWN"
}

const DEFAULT_MODEL = "@cf/black-forest-labs/flux-1-schnell"

const classifyError = (status: number): CloudflareGenerationResult["errorCode"] => {
  if (status === 429) return "RATE_LIMITED"
  if (status >= 500) return "SERVER_ERROR"
  return "UNKNOWN"
}

export const generateWithCloudflare = async (
  prompt: string,
  config: CloudflareImageConfig
): Promise<CloudflareGenerationResult> => {
  const model = config.model || DEFAULT_MODEL
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${config.account_id}/ai/run/${model}`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 60_000)

  let resp: Response
  try {
    resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.api_key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt, num_steps: 4 }),
      signal: controller.signal,
    })
  } catch (err: any) {
    clearTimeout(timeout)
    return {
      success: false,
      provider: "cloudflare",
      modelUsed: model,
      error: err?.message || String(err),
      errorCode: "NETWORK_ERROR",
    }
  }
  clearTimeout(timeout)

  if (!resp.ok) {
    const text = await resp.text().catch(() => "")
    const code = classifyError(resp.status)
    if (code === "RATE_LIMITED") {
      return {
        success: false,
        provider: "cloudflare",
        modelUsed: model,
        error: `Cloudflare rate limited (${resp.status}): ${text.slice(0, 200)}`,
        errorCode: "RATE_LIMITED",
      }
    }
    return {
      success: false,
      provider: "cloudflare",
      modelUsed: model,
      error: `Cloudflare returned ${resp.status}: ${text.slice(0, 200)}`,
      errorCode: code,
    }
  }

  const data = (await resp.json()) as any
  const base64 = data?.result?.image as string | undefined

  if (!base64 || typeof base64 !== "string") {
    // Workers AI may return a URL for some models — accept either.
    if (typeof data?.result?.image_url === "string") {
      return {
        success: true,
        imageUrl: data.result.image_url,
        provider: "cloudflare",
        modelUsed: model,
      }
    }
    return {
      success: false,
      provider: "cloudflare",
      modelUsed: model,
      error: "Cloudflare returned no image",
      errorCode: "UNKNOWN",
    }
  }

  const mime = base64.startsWith("data:") ? "" : "data:image/png;base64,"
  return {
    success: true,
    imageUrl: `${mime}${base64}`,
    provider: "cloudflare",
    modelUsed: model,
  }
}
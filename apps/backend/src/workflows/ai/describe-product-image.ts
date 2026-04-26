import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { MedusaError } from "@medusajs/framework/utils"
import { SOCIALS_MODULE } from "../../modules/socials"
import type SocialsService from "../../modules/socials/service"
import { decryptApiKey } from "../../modules/socials/utils/token-helpers"

export type DescribeProductImageInput = {
  imageUrl: string
  hint?: string
  // Well-known slug to identify the AI provider platform. We match on
  // metadata.role first, then fall back to name (case-insensitive contains).
  providerRole?: string // default: "ai_product_description"
  providerNameContains?: string // default: "qwen"
}

export type DescribeProductImageOutput = {
  title: string
  description: string
  provider_platform_id: string
}

const DEFAULT_SYSTEM_PROMPT = [
  "You write product copy for a handmade crafts marketplace.",
  "Given an image (and optional hint), respond with JSON only, no prose:",
  '{ "title": "short product title, 4-8 words", "description": "2-3 sentences, friendly, accurate to what you see, no marketing fluff" }',
  "Keep language simple. Never invent measurements or materials you can't see.",
].join(" ")

const findAiProviderStep = createStep(
  "describe-image-find-provider",
  async (input: DescribeProductImageInput, { container }) => {
    const socials = container.resolve(SOCIALS_MODULE) as unknown as SocialsService
    const role = input.providerRole || "ai_product_description"
    const nameMatch = (input.providerNameContains || "qwen").toLowerCase()

    // Prefer an explicit role tag in metadata; fall back to a name match.
    const byRoleRows = await socials.listSocialPlatforms(
      { metadata: { role } } as any,
      { take: 1 }
    )

    // `let` with an explicit nullable type — destructured array elements
    // infer as non-undefined, so reassigning the `find()` result (which
    // returns T | undefined) trips TS otherwise.
    let platform: any = byRoleRows?.[0]
    if (!platform) {
      const all = await socials.listSocialPlatforms({ status: "active" }, {})
      platform = all.find((p: any) =>
        (p.name || "").toLowerCase().includes(nameMatch)
      )
    }

    if (!platform) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        "No AI description provider configured. Ask an admin to add one in Settings → External Platforms."
      )
    }

    const apiKey = decryptApiKey(
      platform.api_config || {},
      container
    )
    if (!apiKey) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "AI provider is configured but has no api_key set."
      )
    }

    const apiConfig = platform.api_config || {}
    const baseUrl =
      apiConfig.base_url ||
      platform.base_url ||
      "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
    const model = apiConfig.model || "qwen-vl-max"

    return new StepResponse({
      platformId: platform.id,
      apiKey,
      baseUrl,
      model,
    })
  }
)

const callVisionApiStep = createStep(
  "describe-image-call-vision",
  async (
    input: {
      providerInfo: {
        platformId: string
        apiKey: string
        baseUrl: string
        model: string
      }
      imageUrl: string
      hint?: string
    },
    { container: _container }
  ) => {
    const { providerInfo, imageUrl, hint } = input

    const userParts: Array<Record<string, any>> = [
      { type: "image_url", image_url: { url: imageUrl } },
    ]
    if (hint?.trim()) {
      userParts.push({
        type: "text",
        text: `Hint: ${hint.trim()}`,
      })
    } else {
      userParts.push({
        type: "text",
        text: "Describe this product.",
      })
    }

    const endpoint = providerInfo.baseUrl.replace(/\/$/, "") + "/chat/completions"
    const body = {
      model: providerInfo.model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: DEFAULT_SYSTEM_PROMPT },
        { role: "user", content: userParts },
      ],
      temperature: 0.2,
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 45_000)

    let resp: Response
    try {
      resp = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${providerInfo.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    } catch (err: any) {
      clearTimeout(timeout)
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `AI provider request failed: ${err?.message || err}`
      )
    }
    clearTimeout(timeout)

    if (!resp.ok) {
      const text = await resp.text().catch(() => "")
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `AI provider returned ${resp.status}: ${text.slice(0, 400)}`
      )
    }

    const data = (await resp.json()) as any
    const raw = data?.choices?.[0]?.message?.content
    if (!raw || typeof raw !== "string") {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "AI provider returned an empty message."
      )
    }

    // The model is instructed to return JSON; be forgiving about stray
    // whitespace or code fences.
    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/i, "")
      .trim()

    let parsed: { title?: string; description?: string }
    try {
      parsed = JSON.parse(cleaned)
    } catch {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `AI provider returned non-JSON content: ${cleaned.slice(0, 200)}`
      )
    }

    const title = (parsed.title || "").trim()
    const description = (parsed.description || "").trim()

    if (!title || !description) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "AI provider response is missing title or description."
      )
    }

    return new StepResponse({
      title,
      description,
      provider_platform_id: providerInfo.platformId,
    })
  }
)

export const describeProductImageWorkflow = createWorkflow(
  "describe-product-image",
  (input: DescribeProductImageInput) => {
    const providerInfo = findAiProviderStep(input)
    const result = callVisionApiStep({
      providerInfo,
      imageUrl: input.imageUrl,
      hint: input.hint,
    })
    return new WorkflowResponse(result)
  }
)

export default describeProductImageWorkflow

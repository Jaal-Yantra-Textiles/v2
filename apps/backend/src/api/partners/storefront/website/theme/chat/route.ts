/**
 * POST /partners/storefront/website/theme/chat
 *
 * Streaming chat endpoint for the theme editor LLM panel (#339).
 *
 * Pipeline:
 *   1. Validate body (via middlewares.ts → ThemeChatSchema).
 *   2. Resolve the chat model — DB-configured platform for role
 *      `ai_theme_editor` first, then OpenRouter free fallback.
 *   3. Build the system prompt with the safe-token allowlist injected.
 *   4. Bind tools:
 *      - `update_theme` — propose a scoped theme patch (no persist).
 *      - `list_media` — list uploaded images from the media library
 *        so the LLM can suggest images by URL.
 *   5. `streamText(...)` and pipe the AI-SDK UI message stream straight
 *      into the Express response.
 *
 * Authenticated as a partner route.
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { convertToModelMessages, streamText, stepCountIs, tool } from "ai"
import { z } from "@medusajs/framework/zod"
import { resolveRoleTextModel, logAiUsage } from "../../../../../../mastra/services/ai-platforms"
import { foldSystemForProvider } from "../../../../../store/ai/chat/system-fold-lib"
import { safeThemePatchSchema, SAFE_TOKEN_DESCRIPTION } from "../safe-patch-schema"
import { S3_LISTING_MODULE } from "../../../../../../modules/custom-s3-provider"
import type { ThemeChatReq } from "./validators"

const SYSTEM_PROMPT = `You are a theme design assistant inside a storefront theme editor. The user describes changes in natural language and you propose structured theme edits.

${SAFE_TOKEN_DESCRIPTION}

## Media Library
When the user wants to add or change an image (hero background, logo, banner, text-with-image, etc.), call the \`list_media\` tool to see what images they've already uploaded. Pick the most relevant one and use its URL in the \`update_theme\` tool. If no images are available, tell the user to upload images first via the Upload button in the editor.

## Section Arrangement
You can rearrange homepage sections by setting \`home_sections.sections_order\` to a new array. Valid section keys: "hero", "trust_banner", "collections", "text_with_image", "categories", "testimonials", "banner", "newsletter". Include only the sections the user wants — omitting a section hides it.

Rules:
- Call the \`update_theme\` tool with ONLY the tokens the user wants to change. Omit tokens you are not changing.
- Never invent token names or values outside the allowed enums.
- After calling the tool, briefly explain what you changed in one short sentence.
- If the user asks for something outside the allowed tokens, explain politely that it's not available in this version and suggest the closest alternative within the allowed set.
- Keep responses concise — this is a tool, not a chatbot.`

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const body = (req as any).validatedBody as ThemeChatReq

  const resolved = await resolveRoleTextModel(req.scope as any, "ai_theme_editor")
  if (resolved.source === "free" && !process.env.OPENROUTER_API_KEY) {
    res.status(503).json({
      error:
        "AI theme editor is not configured. Add a platform with role ai_theme_editor in Settings → External Platforms, or set OPENROUTER_API_KEY.",
    })
    return
  }

  // Resolve the media listing service (S3 or local file fallback)
  let mediaService: any = null
  try {
    mediaService = (req.scope as any).resolve(S3_LISTING_MODULE)
  } catch {
    // Module not registered — media listing will be unavailable
  }

  const tools = {
    update_theme: tool({
      description:
        "Propose a theme edit. Pass only the tokens you want to change. The patch will be deep-merged with the existing theme — omitted sections are preserved. The user must click Apply to confirm.",
      inputSchema: safeThemePatchSchema,
      execute: async (input) => {
        return { proposed: true, patch: input }
      },
    }),

    list_media: tool({
      description:
        "List images from the partner's media library. Returns up to 20 image URLs. Use this when the user wants to add or change an image (hero background, logo, banner, etc.) so you can pick from existing uploads. Call this BEFORE proposing an image_url in update_theme.",
      inputSchema: z.object({
        limit: z.number().min(1).max(50).default(20).describe("Number of images to return"),
        offset: z.number().min(0).default(0).describe("Pagination offset"),
      }),
      execute: async (input) => {
        if (!mediaService || typeof mediaService.listAllFiles !== "function") {
          return { files: [], count: 0, note: "Media library is not configured." }
        }
        try {
          const result = await mediaService.listAllFiles({
            limit: input.limit,
            offset: input.offset,
          })
          // Filter to image-like files only
          const imageExts = /\.(jpg|jpeg|png|gif|webp|svg|ico)$/i
          const images = (result.files || []).filter((f: any) =>
            imageExts.test(f.url || f.id || "")
          )
          return {
            files: images,
            count: images.length,
            note: images.length === 0
              ? "No images found in the media library. Ask the user to upload images first."
              : `${images.length} image(s) available.`,
          }
        } catch {
          return { files: [], count: 0, note: "Failed to list media library." }
        }
      },
    }),
  }

  // Normalise inbound UI messages — strip tool parts from history
  const messages = body.messages.map((m: any) => {
    const parts = Array.isArray(m.parts) ? m.parts : null
    const textParts = parts
      ? parts
          .filter((p: any) => p?.type === "text" && typeof p.text === "string" && p.text.length > 0)
          .map((p: any) => ({ type: "text", text: p.text }))
      : [{ type: "text", text: String(m.content ?? "") }]

    return {
      role: m.role,
      parts: textParts.length
        ? textParts
        : [{ type: "text", text: "" }],
    }
  })

  const folded = foldSystemForProvider(resolved.providerType, SYSTEM_PROMPT, messages)

  const startedAt = Date.now()

  let result
  try {
    result = streamText({
      model: resolved.model,
      ...(folded.system ? { system: folded.system } : {}),
      messages: convertToModelMessages(folded.messages as any),
      tools,
      stopWhen: stepCountIs(5),
      temperature: 0.4,
      onFinish: ({ usage: u }: any) => {
        logAiUsage(logger, {
          feature: "partners/storefront/website/theme/chat",
          role: "ai_theme_editor",
          provider: resolved.providerType,
          source: resolved.source,
          platformId: resolved.platformId,
          model: resolved.modelId,
          ok: true,
          ms: Date.now() - startedAt,
          tokens: u?.totalTokens,
        })
      },
      onError: (err: any) => {
        logAiUsage(logger, {
          feature: "partners/storefront/website/theme/chat",
          role: "ai_theme_editor",
          provider: resolved.providerType,
          source: resolved.source,
          platformId: resolved.platformId,
          model: resolved.modelId,
          ok: false,
          ms: Date.now() - startedAt,
          error: err?.error ?? err,
        })
      },
    })
  } catch (e: any) {
    logAiUsage(logger, {
      feature: "partners/storefront/website/theme/chat",
      role: "ai_theme_editor",
      provider: resolved.providerType,
      source: resolved.source,
      platformId: resolved.platformId,
      model: resolved.modelId,
      ok: false,
      ms: Date.now() - startedAt,
      error: e,
    })
    res.status(502).json({ error: "theme chat provider failed" })
    return
  }

  result.pipeUIMessageStreamToResponse(res as any)
}

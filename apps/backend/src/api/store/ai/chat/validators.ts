import { z } from "@medusajs/framework/zod"

/**
 * Body schema for POST /store/ai/chat.
 *
 * `messages` is the AI-SDK UIMessage shape — what `useChat()` posts.
 * We only require the minimum (role, content/parts) and let the AI SDK
 * normalize the rest via `convertToModelMessages`.
 *
 * `prefs` is the onboarding capture (colors, materials, price range,
 * size/fit). Stored in localStorage on the storefront and re-sent each
 * turn so the agent can personalise responses without server-side
 * persistence (Phase 2 will move this server-side).
 *
 * `visitor_id` is mandatory — same id as `jyt_visitor_id` in storefront
 * localStorage. Already used by cart + analytics; reusing it here keeps
 * the chat → product → purchase funnel joinable in analytics, and lets
 * Phase 2 attach customer_id at sign-in by id-match (cart pattern).
 */
const RoleSchema = z.enum(["system", "user", "assistant"])

const UiMessageSchema = z
  .object({
    id: z.string().optional(),
    role: RoleSchema,
    // The AI-SDK v5 UIMessage uses `parts: [{type:"text", text}]`. Older
    // clients send `content: string`. Accept both — the route normalises.
    content: z.string().optional(),
    parts: z
      .array(
        z.object({
          type: z.string(),
          text: z.string().optional(),
        })
      )
      .optional(),
  })
  .passthrough()

const PrefsSchema = z
  .object({
    colors: z.array(z.string().min(1).max(30)).max(10).optional(),
    styles: z.array(z.string().min(1).max(30)).max(10).optional(),
    materials: z.array(z.string().min(1).max(30)).max(10).optional(),
    price_range: z
      .object({
        min: z.number().int().nonnegative().optional(),
        max: z.number().int().nonnegative().optional(),
      })
      .optional(),
    body: z
      .object({
        size: z.string().min(1).max(8).optional(),
        fit: z.enum(["relaxed", "fitted"]).optional(),
      })
      .optional(),
    notes: z.string().max(280).optional(),
  })
  .partial()

export const StoreAiChatSchema = z.object({
  // Capped at 40 turns (20 round-trips) — more than that and the system
  // prompt + brand corpus would dominate tokens anyway.
  messages: z.array(UiMessageSchema).min(1).max(40),
  prefs: PrefsSchema.optional(),
  visitor_id: z.string().min(1).max(80),
})

export type StoreAiChatReq = z.infer<typeof StoreAiChatSchema>
export type StoreAiChatPrefs = z.infer<typeof PrefsSchema>

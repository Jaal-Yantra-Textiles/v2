import { z } from "@medusajs/framework/zod"

/**
 * Body schema for POST /partners/storefront/website/theme/chat.
 *
 * Mirrors the storefront chat validator shape (AI-SDK v5 UIMessage) but
 * without visitor_id / prefs — the partner portal is authenticated.
 */
const RoleSchema = z.enum(["system", "user", "assistant"])

const UiMessageSchema = z
  .object({
    id: z.string().optional(),
    role: RoleSchema,
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

export const ThemeChatSchema = z.object({
  messages: z.array(UiMessageSchema).min(1).max(40),
  // AI SDK v6 (`useChat`) sends these extra top-level fields.
  id: z.string().optional(),
  trigger: z.string().optional(),
})

export type ThemeChatReq = z.infer<typeof ThemeChatSchema>

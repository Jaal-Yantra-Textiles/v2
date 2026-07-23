import { z } from "@medusajs/framework/zod"

/**
 * UI message shape sent by the AI-SDK `useChat` transport. Kept permissive
 * (passthrough) — we normalise to text parts server-side before modelling.
 */
const UiMessageSchema = z
  .object({
    id: z.string().optional(),
    role: z.enum(["system", "user", "assistant"]),
    content: z.string().optional(),
    parts: z
      .array(
        z
          .object({
            type: z.string(),
            text: z.string().optional(),
          })
          .passthrough()
      )
      .optional(),
  })
  .passthrough()

export const PartnerAssistantChatSchema = z.object({
  messages: z.array(UiMessageSchema).min(1).max(60),
  id: z.string().optional(),
  trigger: z.string().optional(),
})

export type PartnerAssistantChatReq = z.infer<typeof PartnerAssistantChatSchema>

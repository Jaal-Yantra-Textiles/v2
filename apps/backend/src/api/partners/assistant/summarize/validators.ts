/**
 * POST /partners/assistant/summarize
 *
 * Validator for the context-compaction endpoint. The client sends the
 * current message history when the chat approaches the context-window
 * threshold; the route returns a short summary that the client stores in
 * place of the older turns so the conversation can continue without
 * exceeding the model's context limit.
 */
import { z } from "zod"

const UiMessageSchema = z
  .object({
    role: z.enum(["system", "user", "assistant"]),
    content: z.string().optional(),
    parts: z
      .array(z.object({ type: z.string(), text: z.string().optional() }).passthrough())
      .optional(),
  })
  .passthrough()

export const PartnerAssistantSummarizeSchema = z.object({
  messages: z.array(UiMessageSchema).min(2).max(200),
})

export type PartnerAssistantSummarizeReq = z.infer<
  typeof PartnerAssistantSummarizeSchema
>

/**
 * POST /admin/assistant/summarize
 *
 * Validator for the admin assistant's context-compaction endpoint. The twin of
 * `partners/assistant/summarize/validators` — the client sends the current
 * message history once its token estimate crosses the warn threshold, and gets
 * back a short summary it stores in place of the older turns.
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

export const AdminAssistantSummarizeSchema = z.object({
  messages: z.array(UiMessageSchema).min(2).max(200),
})

export type AdminAssistantSummarizeReq = z.infer<
  typeof AdminAssistantSummarizeSchema
>

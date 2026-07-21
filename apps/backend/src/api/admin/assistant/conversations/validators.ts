import { z } from "@medusajs/framework/zod"

/**
 * A persisted UI message (AI-SDK shape). Kept permissive (passthrough) — the
 * chat endpoint owns the canonical normalisation; here we only store what the
 * client sends so a conversation replays exactly.
 */
const StoredMessageSchema = z
  .object({
    id: z.string().optional(),
    role: z.enum(["system", "user", "assistant"]),
    content: z.string().optional(),
    parts: z.array(z.object({ type: z.string() }).passthrough()).optional(),
  })
  .passthrough()

export const CreateConversationSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  messages: z.array(StoredMessageSchema).max(200).optional(),
})

export const UpdateConversationSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    messages: z.array(StoredMessageSchema).max(200).optional(),
  })
  .refine((v) => v.title !== undefined || v.messages !== undefined, {
    message: "Provide at least one of title or messages",
  })

export type CreateConversationInput = z.infer<typeof CreateConversationSchema>
export type UpdateConversationInput = z.infer<typeof UpdateConversationSchema>

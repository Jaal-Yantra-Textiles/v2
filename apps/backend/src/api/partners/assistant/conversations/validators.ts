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

/**
 * Conversation-level metadata.
 *
 * `thread_key` is the stable id tying this conversation's turns to the photos
 * uploaded during it — the assistant recovers a conversation's photos by
 * matching it against the `conversation_id` stamped on each upload. It is
 * written on the first save and never changes, which is what lets a reopened
 * conversation still see the photos shared in it.
 */
const ConversationMetadataSchema = z
  .object({
    thread_key: z.string().trim().min(1).max(100).optional(),
  })
  .passthrough()

export const CreateConversationSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  messages: z.array(StoredMessageSchema).max(200).optional(),
  metadata: ConversationMetadataSchema.optional(),
})

export const UpdateConversationSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    messages: z.array(StoredMessageSchema).max(200).optional(),
    metadata: ConversationMetadataSchema.optional(),
  })
  .refine(
    (v) =>
      v.title !== undefined ||
      v.messages !== undefined ||
      v.metadata !== undefined,
    { message: "Provide at least one of title, messages or metadata" }
  )

export type CreateConversationInput = z.infer<typeof CreateConversationSchema>
export type UpdateConversationInput = z.infer<typeof UpdateConversationSchema>

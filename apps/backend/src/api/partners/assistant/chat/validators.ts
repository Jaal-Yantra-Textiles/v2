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

/**
 * A photo the partner attached to this message, already uploaded via
 * POST /partners/assistant/attachments.
 *
 * The model is TOLD an attachment exists (name, type, url) and is never sent
 * the pixels — the partner assistant's model may be text-only, and the ones
 * that aren't accept an image part and then silently drop it at 200 OK.
 * Looking at an image is a separate, deliberate act: `describe_image`.
 */
const AttachmentSchema = z.object({
  url: z.string().trim().min(1),
  name: z.string().trim().min(1).max(300).optional(),
  mime_type: z.string().trim().min(1).max(100).optional(),
  media_id: z.string().trim().min(1).max(100).optional(),
})

export const PartnerAssistantChatSchema = z.object({
  messages: z.array(UiMessageSchema).min(1).max(60),
  id: z.string().optional(),
  trigger: z.string().optional(),
  // Sent by the transport on `regenerate`. Unused server-side, but declared so
  // a strict wrapper can never reject a regenerate turn.
  messageId: z.string().optional(),
  attachments: z.array(AttachmentSchema).max(10).optional(),
})

export type PartnerAssistantAttachment = z.infer<typeof AttachmentSchema>

export type PartnerAssistantChatReq = z.infer<typeof PartnerAssistantChatSchema>

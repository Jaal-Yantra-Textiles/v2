import { z } from "@medusajs/framework/zod"

/**
 * UI message shape sent by the AI-SDK `useChat` transport. Kept permissive
 * (passthrough) — we normalise to text parts server-side before modelling.
 * Mirrors the partner assistant validator.
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
 * An image the operator attached to this turn. Already uploaded — this is a
 * reference, not the bytes.
 *
 * The model is TOLD an attachment exists (name, type, url) but is never sent the
 * pixels: the assistant's own model may well be text-only, and the ones that are
 * accept an image part and silently ignore it. Reading an image is an explicit,
 * separate act — the `read_image` tool.
 */
const AttachmentSchema = z.object({
  url: z.string().trim().min(1),
  name: z.string().trim().min(1).max(300).optional(),
  mime_type: z.string().trim().min(1).max(100).optional(),
})

export const AdminAssistantChatSchema = z.object({
  messages: z.array(UiMessageSchema).min(1).max(60),
  id: z.string().optional(),
  trigger: z.string().optional(),
  attachments: z.array(AttachmentSchema).max(8).optional(),
})

export type AdminAssistantAttachment = z.infer<typeof AttachmentSchema>

export type AdminAssistantChatReq = z.infer<typeof AdminAssistantChatSchema>

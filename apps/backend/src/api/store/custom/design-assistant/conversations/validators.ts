import { z } from "@medusajs/framework/zod"

/**
 * Body schemas for the storefront design-assistant conversation API
 * (`/store/custom/design-assistant/conversations`).
 *
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

const ScopeSchema = z.object({
  // The maker's email — the flow's gate. Scopes every read/write.
  customer_email: z.string().trim().min(3).max(200),
  // Base-product thread scope matching the storefront thread keys
  // (`product:{id}` or `custom`).
  thread_key: z.string().trim().min(1).max(80),
})

export const CreateDesignConversationSchema = ScopeSchema.and(
  z.object({
    title: z.string().trim().min(1).max(200).optional(),
    design_id: z.string().min(1).max(60).optional(),
    messages: z.array(StoredMessageSchema).max(200).optional(),
  })
)

export const UpdateDesignConversationSchema = ScopeSchema.and(
  z
    .object({
      title: z.string().trim().min(1).max(200).optional(),
      design_id: z.string().min(1).max(60).optional(),
      messages: z.array(StoredMessageSchema).max(200).optional(),
    })
    .refine(
      (v) =>
        v.title !== undefined ||
        v.design_id !== undefined ||
        v.messages !== undefined,
      { message: "Provide at least one of title, design_id or messages" }
    )
)

export const DeleteDesignConversationSchema = ScopeSchema

export type CreateDesignConversationInput = z.infer<
  typeof CreateDesignConversationSchema
>
export type UpdateDesignConversationInput = z.infer<
  typeof UpdateDesignConversationSchema
>
export type DeleteDesignConversationInput = z.infer<
  typeof DeleteDesignConversationSchema
>

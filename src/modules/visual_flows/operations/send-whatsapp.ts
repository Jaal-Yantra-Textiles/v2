import { z } from "@medusajs/framework/zod"
import { OperationDefinition, OperationContext, OperationResult } from "./types"
import { interpolateString, interpolateVariables } from "./utils"
import { SOCIAL_PROVIDER_MODULE } from "../../social-provider"
import type SocialProviderService from "../../social-provider/service"
import { SOCIALS_MODULE } from "../../socials"
import type SocialsService from "../../socials/service"
import { MESSAGING_MODULE } from "../../messaging"

/**
 * Send a WhatsApp message from a visual flow — template (preferred) or text.
 *
 * Routing: when no `platform_id` is given, auto-routes to the SocialPlatform
 * whose `country_codes` match the recipient's E.164 prefix (longest wins).
 * Falls back to `is_default: true`, then the first WhatsApp row, then env-var
 * defaults. Single-number deployments can ignore `platform_id` entirely.
 *
 * Persistence: on a successful send, writes a `messaging_message` row the
 * same way the hard-coded partner-notification subscriber does, linking to
 * an existing conversation (by partner_id + phone, or by phone alone).
 * Creates the conversation if one doesn't exist.
 *
 * Idempotency: when both `context_type` and `context_id` are set, skips if an
 * outbound message with the same triplet exists within the dedup window
 * (default 60 minutes). Caller sets the window via `dedup_window_minutes: 0`
 * to disable.
 */
export const sendWhatsAppOperation: OperationDefinition = {
  type: "send_whatsapp",
  name: "Send WhatsApp",
  description:
    "Send a WhatsApp message via a configured SocialPlatform — template or free text. " +
    "Auto-routes by recipient country code, persists to the messaging module, " +
    "and dedupes on (context_type, context_id).",
  icon: "chat-bubble-left-right",
  category: "communication",

  optionsSchema: z.object({
    to: z.string().min(1).describe("Recipient E.164 phone. Supports {{ }} interpolation."),
    platform_id: z
      .string()
      .optional()
      .describe(
        "SocialPlatform row id to send from. Omit to auto-route by country code."
      ),

    mode: z.enum(["template", "text"]).default("template"),

    // Template-mode fields
    template_name: z
      .string()
      .optional()
      .describe('Required when mode="template". Meta-approved template name.'),
    language_code: z
      .string()
      .optional()
      .describe(
        "BCP-47 code (e.g. en, hi, en_US). Defaults to the conversation's stored " +
          "language, then WHATSAPP_TEMPLATE_LANG env, then hi."
      ),
    variables: z
      .array(z.string())
      .optional()
      .describe(
        'Template body placeholder values (strings). Each supports {{ }} interpolation. ' +
          "Order matches {{1}}, {{2}}, ... in the template body."
      ),

    // Text-mode field
    body: z
      .string()
      .optional()
      .describe(
        'Required when mode="text". Only delivers inside Meta\'s 24-hour window.'
      ),

    // Audit / dedup
    partner_id: z
      .string()
      .optional()
      .describe("Optional partner id — used when linking/creating the conversation."),
    context_type: z
      .string()
      .optional()
      .describe('Audit row field. Enables dedup when paired with context_id. E.g. "production_run".'),
    context_id: z
      .string()
      .optional()
      .describe("Audit row field. Typically a domain entity id."),
    dedup_window_minutes: z
      .number()
      .int()
      .min(0)
      .default(60)
      .describe("Skip if a matching outbound message was sent within this window. 0 disables."),

    require_partner: z
      .boolean()
      .default(true)
      .describe(
        "When true (default), refuses to send if the recipient phone doesn't " +
          "map to a known Partner. Protects production notifications from " +
          "leaking to arbitrary numbers. Set false for admin alerts or test " +
          "sends where any recipient is acceptable."
      ),
  }),

  defaultOptions: {
    to: "",
    mode: "template",
    template_name: "",
    variables: [],
    dedup_window_minutes: 60,
    require_partner: true,
  },

  hasMultipleOutputs: true,
  outputHandles: [
    { id: "success", label: "Sent", type: "success" },
    { id: "failure", label: "Skipped / Failed", type: "failure" },
  ],

  execute: async (options, context: OperationContext): Promise<OperationResult> => {
    const { container, dataChain } = context

    // 1. Interpolate caller-supplied strings against the flow data chain.
    const to = interpolateString(options.to, dataChain).trim()
    if (!to) {
      return failed("Recipient phone (to) is empty after interpolation")
    }

    const mode = options.mode ?? "template"
    const platformIdInput = options.platform_id
      ? interpolateString(options.platform_id, dataChain).trim() || undefined
      : undefined
    const partnerId = options.partner_id
      ? interpolateString(options.partner_id, dataChain).trim() || undefined
      : undefined
    const contextType = options.context_type
      ? interpolateString(options.context_type, dataChain).trim() || undefined
      : undefined
    const contextId = options.context_id
      ? interpolateString(options.context_id, dataChain).trim() || undefined
      : undefined
    const dedupWindowMin = Number(options.dedup_window_minutes ?? 60)
    const requirePartner = options.require_partner !== false

    try {
      const socialProvider = container.resolve(SOCIAL_PROVIDER_MODULE) as SocialProviderService
      const socials = container.resolve(SOCIALS_MODULE) as unknown as SocialsService
      const messagingService = container.resolve(MESSAGING_MODULE) as any

      // 2. Dedup check (before any network call).
      if (contextType && contextId && dedupWindowMin > 0) {
        const dup = await findRecentOutboundByContext(
          messagingService,
          contextType,
          contextId,
          dedupWindowMin
        )
        if (dup) {
          return {
            success: true,
            data: {
              sent: false,
              reason: "duplicate_within_window",
              dedup_window_minutes: dedupWindowMin,
              existing_wa_message_id: dup.wa_message_id,
              existing_message_id: dup.id,
              _branch: "failure",
            },
          }
        }
      }

      // 2b. Partner-required guard. Run BEFORE the Meta send so we never
      // leak templates to arbitrary recipients when require_partner is true.
      //   - explicit partner_id on the node wins
      //   - else: lookup by phone (verified whatsapp_number → admin.phone)
      //   - else: existing conversation's partner_id (handles cases where an
      //     admin manually linked a phone to a partner earlier)
      // If none match and require_partner is true, refuse to send.
      let resolvedPartnerId: string | null = partnerId ?? null
      if (!resolvedPartnerId) {
        resolvedPartnerId = await resolvePartnerIdByPhone(container, to)
      }
      if (!resolvedPartnerId) {
        resolvedPartnerId = await findConversationPartnerIdByPhone(messagingService, to)
      }
      if (requirePartner && !resolvedPartnerId) {
        return {
          success: true,
          data: {
            sent: false,
            reason: "no_partner_for_recipient",
            to,
            require_partner: true,
            hint:
              "Pass partner_id explicitly on the node, link the recipient's " +
              "phone to a Partner (partner.whatsapp_number or an active " +
              "admin's phone), or set require_partner: false to allow " +
              "unmatched recipients (e.g. admin alerts).",
            _branch: "failure",
          },
        }
      }

      // 3. Resolve sender platform:
      //    explicit platform_id → conversation's pinned sender → country-code
      //    auto-route → default.
      //
      // The "pinned sender" step lets admins pick a specific WhatsApp
      // number via the conversation-header picker (sender-picker.tsx) and
      // have every outbound message from any reply-style flow honor that
      // choice. For proactive production-run sends there's usually no pin,
      // so we fall straight through to country-code routing.
      let platform: any = null
      if (platformIdInput) {
        platform = await socials.findWhatsAppPlatformById(platformIdInput)
        if (!platform) {
          return failed(`platform_id ${platformIdInput} not found or not a WhatsApp platform`)
        }
      } else {
        const pinnedId = await findPinnedSenderPlatformId(
          messagingService,
          resolvedPartnerId,
          to
        )
        if (pinnedId) {
          platform = await socials.findWhatsAppPlatformById(pinnedId)
        }
        if (!platform) {
          platform = await socials.findWhatsAppPlatformForRecipient(to)
        }
      }

      const whatsapp = platform
        ? await socialProvider.getWhatsAppForPlatform(container, platform.id)
        : socialProvider.getWhatsApp(container) // falls back to env-var-configured default

      // 4. Send.
      let waResponse: any = null
      let messageType: "template" | "text" = "template"
      let contentPreview = ""

      if (mode === "template") {
        const templateName = options.template_name
          ? interpolateString(options.template_name, dataChain).trim()
          : ""
        if (!templateName) {
          return failed('mode="template" requires template_name')
        }

        const lang =
          (options.language_code && interpolateString(options.language_code, dataChain).trim()) ||
          (await resolveLanguageFromConversation(messagingService, partnerId, to)) ||
          inferLanguageFromPhonePrefix(to) ||
          process.env.WHATSAPP_TEMPLATE_LANG ||
          "hi"

        const variableValues: string[] = Array.isArray(options.variables)
          ? options.variables.map((v: any) =>
              typeof v === "string" ? interpolateString(v, dataChain) : String(interpolateVariables(v, dataChain) ?? "")
            )
          : []

        const components =
          variableValues.length > 0
            ? [
                {
                  type: "body" as const,
                  parameters: variableValues.map((text) => ({ type: "text", text })),
                },
              ]
            : []

        waResponse = await whatsapp.sendTemplateMessage(to, templateName, lang, components)
        messageType = "template"
        contentPreview = `[template:${templateName}] ${variableValues.join(" · ")}`.slice(0, 500)
      } else {
        const body = options.body ? interpolateString(options.body, dataChain) : ""
        if (!body.trim()) {
          return failed('mode="text" requires body')
        }
        waResponse = await whatsapp.sendTextMessage(to, body)
        messageType = "text"
        contentPreview = body.slice(0, 500)
      }

      const waMessageId: string | null = waResponse?.messages?.[0]?.id ?? null

      // 5. Persist — find/create conversation, write outbound message row.
      // Meta has already accepted the send. Any failure from here on
      // (DB write, MikroORM constraint, etc.) should NOT fail the operation —
      // it surfaces as `persist_error` in the result so the flow can branch
      // on audit issues without re-sending. partner_id was already resolved
      // in the guard above.
      let conversationId: string | null = null
      let messageId: string | null = null
      let persistError: string | null = null

      try {
        conversationId = await findOrCreateConversation(
          messagingService,
          resolvedPartnerId,
          to,
          platform?.id
        )

        const msg = await messagingService.createMessagingMessages({
          conversation_id: conversationId,
          direction: "outbound",
          sender_name: "Visual Flow",
          content: contentPreview,
          message_type: messageType,
          wa_message_id: waMessageId,
          status: waMessageId ? "sent" : "pending",
          context_type: contextType ?? null,
          context_id: contextId ?? null,
          metadata: {
            flow_id: context.flowId,
            execution_id: context.executionId,
            operation_key: context.operationKey,
            sender_platform_id: platform?.id ?? null,
          },
        })
        messageId = msg?.id ?? null

        // Conversation update: bump last_message_at, and when this is a
        // production_run context pin `pending_run_id` so the inbound handler
        // can map a later template-button tap back to the right run.
        // Template quick-reply buttons arrive on the webhook as the button
        // *title* (localized — "✅ Accept" vs "✅ स्वीकार करें") with no
        // run id embedded, so we need this sidecar pointer.
        const convUpdate: Record<string, any> = {
          id: conversationId,
          last_message_at: new Date(),
        }
        if (contextType === "production_run" && contextId) {
          const existingMeta = await getConversationMetadata(messagingService, conversationId)
          convUpdate.metadata = {
            ...existingMeta,
            pending_run_id: contextId,
            pending_run_sent_at: new Date().toISOString(),
          }
        }
        await messagingService.updateMessagingConversations(convUpdate)
      } catch (persistErr: any) {
        persistError = persistErr?.message ?? "persist failed"
      }

      return {
        success: true,
        data: {
          sent: true,
          wa_message_id: waMessageId,
          platform_id: platform?.id ?? null,
          partner_id: resolvedPartnerId,
          conversation_id: conversationId,
          message_id: messageId,
          persist_error: persistError,
          to,
          mode: messageType,
          _branch: "success",
        },
      }
    } catch (error: any) {
      return {
        success: false,
        error: error?.message ?? "Unknown WhatsApp send failure",
        errorStack: error?.stack,
      }
    }
  },
}

// ─── helpers ───────────────────────────────────────────────────────────────

function failed(reason: string): OperationResult {
  return {
    success: true, // the operation itself ran fine — we just didn't send
    data: { sent: false, reason, _branch: "failure" },
  }
}

async function findRecentOutboundByContext(
  messagingService: any,
  contextType: string,
  contextId: string,
  windowMinutes: number
): Promise<any | null> {
  try {
    const cutoff = new Date(Date.now() - windowMinutes * 60_000)
    const [rows] = await messagingService.listAndCountMessagingMessages(
      {
        context_type: contextType,
        context_id: contextId,
        direction: "outbound",
      },
      { take: 5, order: { created_at: "DESC" } }
    )
    const matches = (rows || []).filter((r: any) => {
      const created = r?.created_at ? new Date(r.created_at) : null
      return created && created >= cutoff && (r.status === "sent" || r.status === "delivered" || r.status === "read")
    })
    return matches[0] ?? null
  } catch {
    return null
  }
}

/**
 * First-contact language heuristic used before the partner has had a chance
 * to pick via the consent/language flow (see
 * src/workflows/whatsapp/whatsapp-message-handler.ts:237-248). Returns a
 * BCP-47 code or null to let the next fallback (env / "hi") take over.
 *
 * Keep this narrow — once the partner replies and picks a language, the
 * conversation metadata lookup wins and this heuristic is bypassed.
 */
function inferLanguageFromPhonePrefix(phone: string): string | null {
  const normalized = phone.startsWith("+") ? phone : `+${phone}`
  // +91 = India → Hindi; everyone else → English. The existing hard-coded
  // subscriber defaults to "hi" for this Indian-focused textile business,
  // so the India default stays consistent with that path.
  if (normalized.startsWith("+91")) return "hi"
  if (/^\+[0-9]/.test(normalized)) return "en"
  return null
}

/**
 * Look up the conversation for (partnerId, phone) and return its
 * `default_sender_platform_id` if set. That field is written by the
 * sender-picker UI in the conversation header (sender-picker.tsx) when an
 * admin pins a specific WhatsApp number to a conversation. Honoring it
 * here means flow-driven replies stay on the admin's chosen sender.
 */
async function findPinnedSenderPlatformId(
  messagingService: any,
  partnerId: string | null,
  phone: string
): Promise<string | null> {
  try {
    const phoneDigits = phone.replace(/[^0-9]/g, "")
    const filters: Record<string, any> = partnerId ? { partner_id: partnerId } : {}
    const [convs] = await messagingService.listAndCountMessagingConversations(filters, { take: 50 })
    const conv = (convs || []).find((c: any) => {
      const cd = (c.phone_number || "").replace(/[^0-9]/g, "")
      return cd === phoneDigits || cd.endsWith(phoneDigits) || phoneDigits.endsWith(cd)
    })
    const pinned = conv?.default_sender_platform_id
    return typeof pinned === "string" && pinned.length > 0 ? pinned : null
  } catch {
    return null
  }
}

async function getConversationMetadata(
  messagingService: any,
  conversationId: string
): Promise<Record<string, any>> {
  try {
    const conv = await messagingService.retrieveMessagingConversation(conversationId)
    return (conv?.metadata as Record<string, any>) ?? {}
  } catch {
    return {}
  }
}

async function resolveLanguageFromConversation(
  messagingService: any,
  partnerId: string | undefined,
  phone: string
): Promise<string | null> {
  try {
    const phoneDigits = phone.replace(/[^0-9]/g, "")
    const filters: Record<string, any> = partnerId ? { partner_id: partnerId } : {}
    const [convs] = await messagingService.listAndCountMessagingConversations(filters, { take: 50 })
    const hit = (convs || []).find((c: any) => {
      const cd = (c.phone_number || "").replace(/[^0-9]/g, "")
      return cd === phoneDigits || cd.endsWith(phoneDigits) || phoneDigits.endsWith(cd)
    })
    return (hit?.metadata as Record<string, any>)?.language ?? null
  } catch {
    return null
  }
}

/**
 * Match an inbound phone to a known Partner — priority 1 `whatsapp_number`,
 * priority 2 any admin's `phone`. Matches on normalized digits with
 * suffix-tolerance (ends_with) to handle `+`-prefix and country-code
 * format differences between stored and inbound strings.
 *
 * Mirrors the inbound webhook's resolver at
 * src/workflows/whatsapp/whatsapp-message-handler.ts:49 (minus the
 * auto-verification side effects — proactive sends shouldn't verify admins).
 */
async function resolvePartnerIdByPhone(
  container: any,
  phone: string
): Promise<string | null> {
  try {
    const partnerService = container.resolve("partner") as any
    const [partners] = await partnerService.listAndCountPartners(
      {},
      { take: 200, relations: ["admins"] }
    )
    const normalized = phone.replace(/[^0-9]/g, "")

    for (const partner of partners || []) {
      if (
        partner.whatsapp_number &&
        partner.whatsapp_verified &&
        matchesPhone(partner.whatsapp_number, normalized)
      ) {
        return partner.id
      }
    }

    for (const partner of partners || []) {
      for (const admin of partner.admins || []) {
        if (!admin.phone || !admin.is_active) continue
        if (matchesPhone(admin.phone, normalized)) {
          return partner.id
        }
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Fallback partner resolver — if we already have a messaging_conversation
 * for this phone, borrow its partner_id. Covers cases where an admin
 * manually created a conversation against a Partner whose whatsapp_number
 * / admin phones don't literally match the recipient string (e.g. different
 * format, same number).
 */
async function findConversationPartnerIdByPhone(
  messagingService: any,
  phone: string
): Promise<string | null> {
  try {
    const phoneDigits = phone.replace(/[^0-9]/g, "")
    const [convs] = await messagingService.listAndCountMessagingConversations(
      {},
      { take: 200 }
    )
    const hit = (convs || []).find((c: any) => {
      const cd = (c.phone_number || "").replace(/[^0-9]/g, "")
      return cd === phoneDigits || cd.endsWith(phoneDigits) || phoneDigits.endsWith(cd)
    })
    return hit?.partner_id ?? null
  } catch {
    return null
  }
}

function matchesPhone(stored: string, inboundDigits: string): boolean {
  const s = (stored || "").replace(/[^0-9]/g, "")
  if (!s || !inboundDigits) return false
  return s === inboundDigits || s.endsWith(inboundDigits) || inboundDigits.endsWith(s)
}

async function findOrCreateConversation(
  messagingService: any,
  partnerId: string | null,
  phone: string,
  platformId: string | undefined
): Promise<string> {
  const phoneDigits = phone.replace(/[^0-9]/g, "")

  // 1. Try partner+phone when we know the partner; otherwise list by phone.
  const filters: Record<string, any> = partnerId ? { partner_id: partnerId } : {}
  const [convs] = await messagingService.listAndCountMessagingConversations(filters, { take: 50 })
  const existing = (convs || []).find((c: any) => {
    const cd = (c.phone_number || "").replace(/[^0-9]/g, "")
    return cd === phoneDigits || cd.endsWith(phoneDigits) || phoneDigits.endsWith(cd)
  })
  if (existing) return existing.id

  // 2. Fallback: bare phone lookup if we were scoped by partner and missed.
  if (partnerId) {
    try {
      const [byPhone] = await messagingService.listAndCountMessagingConversations(
        { phone_number: phone },
        { take: 1 }
      )
      if (byPhone && byPhone[0]) return byPhone[0].id
    } catch { /* fall through to create */ }
  }

  // 3. Create. The MessagingConversation model requires a non-null
  // partner_id (src/modules/messaging/models/conversation.ts:6), so bail
  // with a clear error if the caller couldn't resolve one. Bubbles up as
  // `persist_error` — the send itself already succeeded.
  if (!partnerId) {
    throw new Error(
      `Cannot create conversation for ${phone} — no partner matched by phone. ` +
        `Pass partner_id explicitly on the send_whatsapp node, or link the number ` +
        `to a Partner (partner.whatsapp_number or an active admin's phone).`
    )
  }

  const created = await messagingService.createMessagingConversations({
    partner_id: partnerId,
    phone_number: phone,
    status: "active",
    default_sender_platform_id: platformId ?? null,
    metadata: {
      consent_source: "system_notification",
    },
  })
  return created.id
}

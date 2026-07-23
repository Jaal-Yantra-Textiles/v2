import { z } from "@medusajs/framework/zod"
import { OperationDefinition, OperationContext, OperationResult } from "./types"
import { interpolateString, interpolateVariables } from "./utils"
import { SOCIAL_PROVIDER_MODULE } from "../../social-provider"
import type SocialProviderService from "../../social-provider/service"
import { SOCIALS_MODULE } from "../../socials"
import type SocialsService from "../../socials/service"
import { MESSAGING_MODULE } from "../../messaging"
import type { WhatsAppAuditContext } from "../../social-provider/whatsapp-service"

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

    mode: z.enum(["template", "text", "image", "interactive"]).default("template"),

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
    header_image_url: z
      .string()
      .optional()
      .describe(
        'Optional public HTTPS image URL passed as the template HEADER parameter. ' +
          "Required if the template was approved with an IMAGE header AND you want " +
          "a per-send image instead of the example one. Empty string is treated as " +
          "\"no parameter\" — Meta uses the template's example_url instead. Supports {{ }} interpolation."
      ),

    // Text-mode field
    body: z
      .string()
      .optional()
      .describe(
        'Required when mode="text". Only delivers inside Meta\'s 24-hour window.'
      ),

    // Image-mode fields
    image_url: z
      .string()
      .optional()
      .describe(
        'Required when mode="image". Public HTTPS URL of a JPEG/PNG under 5MB. ' +
          "Supports {{ }} interpolation."
      ),
    caption: z
      .string()
      .optional()
      .describe(
        'Optional caption when mode="image" (max 1024 chars). Supports {{ }} interpolation.'
      ),
    skip_if_no_image: z
      .boolean()
      .default(true)
      .describe(
        'When mode="image" and image_url resolves empty, exit cleanly via the ' +
          '"failure" branch instead of erroring. Lets flows send images only when ' +
          "the source data has one, without an upstream condition node."
      ),

    // Interactive-mode fields (mode="interactive")
    // Renders a reply-buttons message: body text + 1-3 tap buttons. The
    // button id arrives back on the webhook as message.buttonReplyId so a
    // downstream handler (e.g. whatsapp-message-handler.ts) can dispatch.
    // Like text + image, this only delivers inside Meta's 24-hour window —
    // pair with skip_if_outside_window when sending unprompted.
    interactive_body: z
      .string()
      .optional()
      .describe(
        'Required when mode="interactive". Body text shown above the buttons. ' +
          "Supports {{ }} interpolation. Max 1024 chars per Meta."
      ),
    interactive_buttons: z
      .array(
        z.object({
          id: z.string().describe("Button id (max 256 chars). Returned on the webhook as buttonReplyId."),
          title: z.string().describe("Button label shown to recipient (max 20 chars)."),
        })
      )
      .optional()
      .describe(
        'Required when mode="interactive". 1-3 reply buttons (Meta caps at 3). ' +
          "Each id + title supports {{ }} interpolation."
      ),

    // 24-hour conversation window guard. Applies to text / image / interactive
    // (all free-form modes Meta blocks outside the window). Templates are
    // unaffected — they're explicitly designed to initiate conversations.
    skip_if_outside_window: z
      .boolean()
      .default(false)
      .describe(
        "When true and mode is text|image|interactive, skip the send if the " +
          "conversation has no inbound message in the last 24 hours. Prevents " +
          'silent "outside window" rejections from Meta when the recipient ' +
          "hasn't talked to us recently — common for unprompted follow-ups."
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

    // Template URL-button parameter (mode="template" only). Meta templates
    // approved with a dynamic URL button (url = "…{{1}}") REQUIRE a per-send
    // value that fills the {{1}} suffix. We use this for the reminder
    // templates whose "Open" button carries a partner deep-link token
    // (…/wa-auth?wa_token={{1}}) so the tap lands the partner authenticated
    // on the run — action-oriented, and delivers OUTSIDE the 24h window
    // because it rides on the (media-header) template itself, not a
    // free-form follow-up. Paired with `url_button_enabled` so a single
    // dispatcher node can send both button and non-button templates.
    url_button_token: z
      .string()
      .optional()
      .describe(
        'Value that fills a template URL button\'s {{1}} suffix (e.g. a wa_token ' +
          "deep-link JWT). Supports {{ }} interpolation. Only attached when " +
          "`url_button_enabled` is truthy and this resolves non-empty."
      ),
    url_button_enabled: z
      .union([z.boolean(), z.string()])
      .optional()
      .describe(
        "Gate for the URL button. Truthy (true / \"true\") attaches the button " +
          "component when `url_button_token` is present; falsy skips it. Lets one " +
          "send node serve both button templates (reminders) and plain templates " +
          "(assigned / cancelled / completed) in the same flow. Supports {{ }} " +
          "interpolation (resolves to the string \"true\"/\"false\")."
      ),
    url_button_index: z
      .union([z.number(), z.string()])
      .optional()
      .describe(
        'Zero-based index of the URL button within the template\'s button block. ' +
          "Defaults to 0 (the first button). Supports {{ }} interpolation."
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

      // 4. Send (outbox-flavored).
      // Order of operations:
      //   a. Resolve language for template mode (also fed into
      //      findOrCreateConversation to pin the new conversation's
      //      language preference).
      //   b. find/create conversation NOW so the preflight write has
      //      a conversation_id.
      //   c. Pre-flight messaging_message row with status="pending".
      //      A subsequent retry of the same context_id within the
      //      dedup window finds this row and short-circuits — closes
      //      the window where Meta succeeded but the persist crashed
      //      and the next retry double-sent.
      //   d. Per-mode dispatch (template / text / image) — calls Meta.
      //   e. On success, update the preflight row to status="sent"
      //      with the real content/wa_message_id/template_name.
      //   f. On failure, update the preflight to status="failed" with
      //      the error in metadata, then re-throw to the outer catch
      //      which returns success: false.
      // 2c. 24-hour conversation window guard.
      //
      // Templates can initiate conversations. Free-form modes (text /
      // image / interactive) can ONLY be delivered while the recipient's
      // 24-hour "service window" is open — i.e. they messaged us within
      // the last 24 hours. Outside that window Meta rejects with code
      // 131047 and the call wastes an API hit + writes a noisy failed
      // row.
      //
      // When the caller opts in via skip_if_outside_window, look up the
      // most recent inbound messaging_message for this recipient and
      // exit cleanly via the failure branch if none in the last 24h.
      if (
        options.skip_if_outside_window &&
        (mode === "text" || mode === "image" || mode === "interactive")
      ) {
        const lastInbound = await findLastInboundForRecipient(
          messagingService,
          resolvedPartnerId,
          to
        )
        const windowMs = 24 * 60 * 60 * 1000
        const insideWindow =
          lastInbound && lastInbound.created_at
            ? Date.now() - new Date(lastInbound.created_at).getTime() < windowMs
            : false
        if (!insideWindow) {
          return {
            success: true,
            data: {
              sent: false,
              reason: "outside_24h_window",
              last_inbound_at: lastInbound?.created_at ?? null,
              mode,
              _branch: "failure",
            },
          }
        }
      }

      let waResponse: any = null
      let messageType: "template" | "text" | "media" = "template"
      let contentPreview = ""
      // Captured per-mode below so we can persist them onto
      // messaging_message.metadata for after-the-fact auditing of which
      // template/language Meta actually saw. Stays null for non-template modes.
      let resolvedTemplateName: string | null = null
      let resolvedLanguageCode: string | null = null

      // (a) Language resolution — only meaningful for template mode but
      // computed early so findOrCreateConversation can pin it on the new
      // conversation row's metadata.
      if (mode === "template") {
        resolvedLanguageCode =
          (options.language_code && interpolateString(options.language_code, dataChain).trim()) ||
          (await resolveLanguageFromConversation(messagingService, partnerId, to)) ||
          inferLanguageFromPhonePrefix(to) ||
          process.env.WHATSAPP_TEMPLATE_LANG ||
          "hi"
      }

      // (b) Find or create conversation. If this fails we cannot audit
      // the send, so refuse to fire — better to error visibly than to
      // call Meta blind.
      let conversationId: string | null = null
      try {
        conversationId = await findOrCreateConversation(
          messagingService,
          resolvedPartnerId,
          to,
          platform?.id,
          resolvedLanguageCode
        )
      } catch (convErr: any) {
        return {
          success: false,
          error: `Failed to find/create conversation: ${convErr?.message ?? convErr}`,
        }
      }

      // (c) Pre-flight write. The per-mode block can fill `messageType`
      // up front from `mode` since the mapping is fixed.
      const preflightMessageType: "template" | "text" | "media" =
        mode === "template" ? "template" : mode === "image" ? "media" : "text"
      const preflightMetadata: Record<string, unknown> = {
        flow_id: context.flowId,
        execution_id: context.executionId,
        operation_key: context.operationKey,
        sender_platform_id: platform?.id ?? null,
        template_name: null, // filled post-Meta for template mode
        language_code: resolvedLanguageCode,
      }
      let messageId: string | null = null
      let persistError: string | null = null
      try {
        const msg = await messagingService.createMessagingMessages({
          conversation_id: conversationId,
          direction: "outbound",
          sender_name: "Visual Flow",
          content: "[pending]",
          message_type: preflightMessageType,
          wa_message_id: null,
          status: "pending",
          context_type: contextType ?? null,
          context_id: contextId ?? null,
          metadata: preflightMetadata,
        })
        messageId = msg?.id ?? null
      } catch (preflightErr: any) {
        // Pre-flight failed — proceed without outbox safety. The post-
        // Meta persist branch below will fall through to a fresh write.
        persistError = preflightErr?.message ?? "preflight failed"
      }

      // (d) Per-mode dispatch wrapped so a Meta failure can mark the
      // preflight row as failed before re-throwing to the outer catch.
      try {
      if (mode === "template") {
        const templateName = options.template_name
          ? interpolateString(options.template_name, dataChain).trim()
          : ""
        if (!templateName) {
          return failed('mode="template" requires template_name')
        }

        const lang = resolvedLanguageCode ?? "hi"

        // Variables can arrive in two shapes from the saved options:
        //   1. literal array of strings, each maybe containing {{ }}
        //      e.g. ["{{ partner.name }}", "{{ run.id }}"]
        //   2. a single full-string {{ }} that resolves to an array
        //      e.g. "{{ resolve_template.variables }}" → ["Saransh", "ABC", ...]
        // interpolateVariables() handles (2) by returning the actual array
        // when the whole string matches /^{{ ... }}$/. Without this step the
        // string passed Array.isArray() === false and we sent zero
        // localizable_params, which Meta rejected with code 132000.
        const interpolatedVariables = interpolateVariables(options.variables, dataChain)
        const variableValues: string[] = Array.isArray(interpolatedVariables)
          ? interpolatedVariables.map((v: any) =>
              typeof v === "string" ? interpolateString(v, dataChain) : String(v ?? "")
            )
          : []

        // HEADER parameter rules (Meta is strict, see roadmap 25c):
        //  - Template has NO header component → must NOT push a header
        //    parameter. Doing so → code 132018.
        //  - Template HAS an IMAGE header → MUST push a real URL. The
        //    `example_url` declared at template-creation time is used
        //    ONLY during Meta's template review and is NOT a runtime
        //    fallback — sending nothing for an IMAGE-header template
        //    → code 132012.
        // The caller is responsible for resolving the right value
        // (empty/null for no-header templates, a real URL for IMAGE
        // headers). Empty string here means "skip the parameter".
        // Order matters in Meta's API: HEADER must come before BODY.
        const headerImageUrl = options.header_image_url
          ? interpolateString(options.header_image_url, dataChain).trim()
          : ""

        type TemplateComponent = {
          type: "body" | "button" | "header"
          parameters: Array<{
            type: string
            text?: string
            image?: { link: string }
          }>
          sub_type?: string
          index?: number
        }
        const components: TemplateComponent[] = []
        if (headerImageUrl) {
          components.push({
            type: "header",
            parameters: [
              { type: "image", image: { link: headerImageUrl } },
            ],
          })
        }
        if (variableValues.length > 0) {
          components.push({
            type: "body",
            parameters: variableValues.map((text) => ({ type: "text", text })),
          })
        }

        // Dynamic URL-button parameter. Only attach when the caller both
        // enabled it AND supplied a non-empty token — a template approved
        // with a "…{{1}}" URL button REQUIRES this parameter at send time
        // (Meta rejects the send otherwise), so gating on presence keeps a
        // shared dispatcher node safe for plain (no-button) templates too.
        const urlButtonEnabled =
          options.url_button_enabled === true ||
          (typeof options.url_button_enabled === "string" &&
            ["true", "1", "yes"].includes(
              interpolateString(options.url_button_enabled, dataChain)
                .trim()
                .toLowerCase()
            ))
        const urlButtonToken = options.url_button_token
          ? interpolateString(options.url_button_token, dataChain).trim()
          : ""
        if (urlButtonEnabled && urlButtonToken) {
          const rawIndex =
            typeof options.url_button_index === "string"
              ? interpolateString(options.url_button_index, dataChain).trim()
              : options.url_button_index
          const parsedIndex = Number(rawIndex)
          // Meta accepts the button index as an integer; default to 0 (first
          // button). WhatsAppService serialises it into the send payload.
          const buttonIndex = Number.isFinite(parsedIndex)
            ? Math.max(0, Math.trunc(parsedIndex))
            : 0
          components.push({
            type: "button",
            sub_type: "url",
            index: buttonIndex,
            parameters: [{ type: "text", text: urlButtonToken }],
          })
        }

        // Audit context — picked up by WhatsAppService and written to the
        // Notification Module after Meta accepts the send. trigger_type
        // resolves the originating event for wildcard flows (e.g.
        // "production_run.reminder_assignment_pending") or falls back to the
        // visual flow id for ad-hoc triggers.
        const triggerType =
          (typeof dataChain?.$trigger?.event === "string"
            ? dataChain.$trigger.event
            : null) || `visual_flow:${context.flowId}`

        const buildAudit = (
          extraData: Record<string, unknown> = {}
        ): WhatsAppAuditContext => ({
          template: templateName,
          partner_id: resolvedPartnerId,
          resource_type: contextType ?? null,
          resource_id: contextId ?? null,
          trigger_type: triggerType,
          idempotency_key: contextType && contextId ? `${contextType}:${contextId}` : null,
          data: {
            mode: "template",
            flow_id: context.flowId,
            execution_id: context.executionId,
            operation_key: context.operationKey,
            platform_id: platform?.id ?? null,
            ...extraData,
          },
        })

        waResponse = await whatsapp.sendTemplateMessage(
          to,
          templateName,
          lang,
          components,
          buildAudit({ variables: variableValues })
        )
        messageType = "template"
        contentPreview = `[template:${templateName}] ${variableValues.join(" · ")}`.slice(0, 500)
        resolvedTemplateName = templateName
        resolvedLanguageCode = lang
      } else if (mode === "image") {
        const imageUrl = options.image_url
          ? interpolateString(options.image_url, dataChain).trim()
          : ""
        if (!imageUrl) {
          if (options.skip_if_no_image !== false) {
            return {
              success: true,
              data: {
                sent: false,
                reason: "no_image_url",
                _branch: "failure",
              },
            }
          }
          return failed('mode="image" requires image_url')
        }

        const caption = options.caption
          ? interpolateString(options.caption, dataChain).slice(0, 1024)
          : undefined

        const triggerType =
          (typeof dataChain?.$trigger?.event === "string"
            ? dataChain.$trigger.event
            : null) || `visual_flow:${context.flowId}`

        waResponse = await whatsapp.sendImageMessage(to, imageUrl, caption, {
          template: null,
          partner_id: resolvedPartnerId,
          resource_type: contextType ?? null,
          resource_id: contextId ?? null,
          trigger_type: triggerType,
          idempotency_key: contextType && contextId ? `${contextType}:${contextId}:image` : null,
          data: {
            mode: "image",
            flow_id: context.flowId,
            execution_id: context.executionId,
            operation_key: context.operationKey,
            platform_id: platform?.id ?? null,
            image_url: imageUrl,
            caption,
          },
        })
        messageType = "media"
        contentPreview = `[image] ${caption || imageUrl}`.slice(0, 500)
      } else if (mode === "interactive") {
        // Interactive reply-buttons message (1-3 tap buttons).
        // Button ids returned on the inbound webhook as
        // message.buttonReplyId; downstream handlers dispatch on the id
        // prefix (e.g. "wa_pc_confirm:..." for the W4 product-create
        // confirm flow).
        const interactiveBody = options.interactive_body
          ? interpolateString(options.interactive_body, dataChain).slice(0, 1024)
          : ""
        if (!interactiveBody.trim()) {
          return failed('mode="interactive" requires interactive_body')
        }

        const buttonsRaw: unknown = interpolateVariables(
          options.interactive_buttons,
          dataChain
        )
        const buttons = Array.isArray(buttonsRaw)
          ? buttonsRaw
              .map((b: any) => ({
                id: typeof b?.id === "string" ? interpolateString(b.id, dataChain).trim() : "",
                title: typeof b?.title === "string" ? interpolateString(b.title, dataChain).trim() : "",
              }))
              .filter((b) => b.id && b.title)
          : []
        if (buttons.length === 0) {
          return failed('mode="interactive" requires at least one interactive_buttons entry')
        }
        if (buttons.length > 3) {
          return failed('mode="interactive" supports at most 3 buttons (Meta cap)')
        }

        const triggerType =
          (typeof dataChain?.$trigger?.event === "string"
            ? dataChain.$trigger.event
            : null) || `visual_flow:${context.flowId}`

        waResponse = await whatsapp.sendInteractiveMessage(
          to,
          {
            type: "button",
            body: { text: interactiveBody },
            action: {
              buttons: buttons.slice(0, 3).map((b) => ({
                type: "reply",
                reply: { id: b.id.slice(0, 256), title: b.title.slice(0, 20) },
              })),
            },
          } as any,
          {
            template: null,
            partner_id: resolvedPartnerId,
            resource_type: contextType ?? null,
            resource_id: contextId ?? null,
            trigger_type: triggerType,
            idempotency_key: contextType && contextId ? `${contextType}:${contextId}:interactive` : null,
            data: {
              mode: "interactive",
              flow_id: context.flowId,
              execution_id: context.executionId,
              operation_key: context.operationKey,
              platform_id: platform?.id ?? null,
              button_ids: buttons.map((b) => b.id),
            },
          }
        )
        messageType = "text"
        contentPreview = `[buttons] ${interactiveBody} (${buttons.map((b) => b.title).join(" | ")})`.slice(0, 500)
      } else {
        const body = options.body ? interpolateString(options.body, dataChain) : ""
        if (!body.trim()) {
          return failed('mode="text" requires body')
        }

        const triggerType =
          (typeof dataChain?.$trigger?.event === "string"
            ? dataChain.$trigger.event
            : null) || `visual_flow:${context.flowId}`

        waResponse = await whatsapp.sendTextMessage(to, body, undefined, {
          template: null,
          partner_id: resolvedPartnerId,
          resource_type: contextType ?? null,
          resource_id: contextId ?? null,
          trigger_type: triggerType,
          idempotency_key: contextType && contextId ? `${contextType}:${contextId}:text` : null,
          data: {
            mode: "text",
            flow_id: context.flowId,
            execution_id: context.executionId,
            operation_key: context.operationKey,
            platform_id: platform?.id ?? null,
          },
        })
        messageType = "text"
        contentPreview = body.slice(0, 500)
      }
      } catch (sendErr: any) {
        // Meta call (or upstream send-leaf) threw. Mark the preflight
        // row as failed so operators querying messaging_message see a
        // tombstone — without this, the only signal that a send failed
        // is the visual-flow execution log, which is harder to correlate
        // with a specific partner / run.
        if (messageId) {
          try {
            await messagingService.updateMessagingMessages({
              id: messageId,
              status: "failed",
              metadata: {
                ...preflightMetadata,
                template_name: resolvedTemplateName,
                error: sendErr?.message ?? "send failed",
              },
            })
          } catch {
            // Swallow — the original send error is the meaningful one.
          }
        }
        throw sendErr
      }

      const waMessageId: string | null = waResponse?.messages?.[0]?.id ?? null

      // (e) Persist — update the preflight row to its final state, OR
      // (fallback) write a fresh row if preflight itself failed earlier.
      // Meta has already accepted the send. Any failure here surfaces as
      // `persist_error` in the result; the dedup row already exists so
      // a retry won't double-send.
      try {
        if (messageId) {
          await messagingService.updateMessagingMessages({
            id: messageId,
            content: contentPreview,
            wa_message_id: waMessageId,
            status: waMessageId ? "sent" : "pending",
            message_type: messageType,
            metadata: {
              ...preflightMetadata,
              template_name: resolvedTemplateName,
            },
          })
        } else {
          // Preflight failed (rare — DB unavailable). Write the row now
          // so we still have an audit trail.
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
              ...preflightMetadata,
              template_name: resolvedTemplateName,
            },
          })
          messageId = msg?.id ?? null
        }

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
          // Use the bare run id, not the synthetic dedup-suffixed form.
          // The inbound webhook routes button taps via this field — see
          // whatsapp-message-handler.ts:307. With ":reminder:DATE" left
          // on, every reminder dispatch overwrote the previously-pinned
          // clean run id and partner taps on the original assignment
          // message stopped routing.
          convUpdate.metadata = {
            ...existingMeta,
            pending_run_id: stripDedupSuffix(contextId),
            pending_run_sent_at: new Date().toISOString(),
          }
        }
        await messagingService.updateMessagingConversations(convUpdate)
      } catch (persistErr: any) {
        persistError = persistError ?? persistErr?.message ?? "persist failed"
      }

      // Notification Module audit row was already written by WhatsAppService
      // when the leaf send method was called above (see whatsapp-service.ts
      // sendRequest). No second write needed here.

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

/**
 * The reminder dispatcher uses synthetic context_ids of the form
 *   "<run_id>:reminder:<YYYY-MM-DD>"
 * as a per-day dedup key. That value is correct for audit dedup but it
 * MUST NOT leak into conversation.metadata.pending_run_id — the inbound
 * webhook handler reads pending_run_id verbatim to route Accept/Decline
 * button taps from the assignment template back to the production run,
 * and the synthetic id 404s on lookup. Strip everything from the first
 * ":reminder:" onward. Run ids never legitimately contain that segment.
 */
function stripDedupSuffix(id: string | null | undefined): string | null {
  if (!id) return null
  const idx = id.indexOf(":reminder:")
  return idx >= 0 ? id.slice(0, idx) : id
}

/**
 * Find the most recent inbound message for a recipient phone (and partner
 * if known), used by skip_if_outside_window to compute Meta's 24-hour
 * service window.
 *
 * We query messages tagged with this conversation's partner_id + phone via
 * the underlying conversation row, falling back to phone-only when no
 * partner is set. Returns the message row (with created_at) or null.
 */
async function findLastInboundForRecipient(
  messagingService: any,
  partnerId: string | null,
  phone: string
): Promise<{ created_at: Date | string } | null> {
  try {
    // Find conversations for this recipient. Phone is the most stable
    // anchor; partner_id narrows in multi-tenant cases.
    const convFilter: Record<string, any> = { phone_number: phone }
    if (partnerId) convFilter.partner_id = partnerId
    const [convs] = await messagingService.listAndCountMessagingConversations(
      convFilter,
      { take: 5, order: { last_message_at: "DESC" } }
    )
    if (!convs?.length) return null
    const conversationIds = convs.map((c: any) => c.id)
    const [rows] = await messagingService.listAndCountMessagingMessages(
      { conversation_id: conversationIds, direction: "inbound" },
      { take: 1, order: { created_at: "DESC" } }
    )
    return rows?.[0] ?? null
  } catch {
    return null
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
    // Include "pending" so the outbox pre-flight row deduplicates a
    // concurrent retry that arrives before the Meta call returns.
    // "failed" is intentionally excluded — a previous attempt that
    // errored should be allowed to retry. "delivered" and "read" come
    // from Meta's status webhook, not the send path, but covering them
    // keeps the filter symmetric.
    const matches = (rows || []).filter((r: any) => {
      const created = r?.created_at ? new Date(r.created_at) : null
      return (
        created &&
        created >= cutoff &&
        (r.status === "pending" ||
          r.status === "sent" ||
          r.status === "delivered" ||
          r.status === "read")
      )
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
  platformId: string | undefined,
  // Optional language to pin on a NEWLY-created conversation. Skipped on
  // the find path so we never overwrite a manually-changed preference.
  // Without this, the very first reminder to a brand-new partner falls
  // through resolveLanguageFromConversation (no row yet) → phone-prefix
  // heuristic → "hi" for any +91 number, regardless of whether the
  // partner_admin's preferred_language is "en".
  initialLanguage: string | null = null
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

  const conversationMetadata: Record<string, unknown> = {
    consent_source: "system_notification",
  }
  if (initialLanguage) {
    conversationMetadata.language = initialLanguage
  }
  const created = await messagingService.createMessagingConversations({
    partner_id: partnerId,
    phone_number: phone,
    status: "active",
    default_sender_platform_id: platformId ?? null,
    metadata: conversationMetadata,
  })
  return created.id
}

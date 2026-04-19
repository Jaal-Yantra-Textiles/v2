import { MedusaError } from "@medusajs/utils"
import { PRODUCTION_RUNS_MODULE } from "../../modules/production_runs"
import type ProductionRunService from "../../modules/production_runs/service"
import { PARTNER_MODULE } from "../../modules/partner"
import { acceptProductionRunWorkflow } from "../production-runs/accept-production-run"
import { signalLifecycleStepSuccessWorkflow } from "../production-runs/production-run-steps"
import {
  awaitRunStartStepId,
  awaitRunFinishStepId,
  awaitRunCompleteStepId,
} from "../production-runs/run-production-run-lifecycle"
import WhatsAppService from "../../modules/social-provider/whatsapp-service"
import { SOCIAL_PROVIDER_MODULE } from "../../modules/social-provider"
import type SocialProviderService from "../../modules/social-provider/service"
import { MESSAGING_MODULE } from "../../modules/messaging"
import { downloadAndSaveWhatsAppMedia, attachMediaToRunDesign } from "./whatsapp-media-helper"
import { BUTTON_TITLE_ACTIONS } from "../../scripts/whatsapp-templates/partner-run-templates"

interface IncomingMessage {
  from: string // WhatsApp phone number
  messageId: string
  type: "text" | "interactive" | "image" | "document" | "video" | "audio"
  text?: string
  buttonReplyId?: string
  buttonReplyTitle?: string
  mediaId?: string
  mediaUrl?: string
  mediaMimeType?: string
  replyToWaMessageId?: string
}

interface HandlerResult {
  handled: boolean
  action?: string
  runId?: string
  error?: string
}

/**
 * Resolves a partner by matching the phone number against PartnerAdmin records.
 * Returns { partnerId, adminPhone } or null.
 */
interface ResolvedPartner {
  partnerId: string
  adminName: string
  adminId?: string
  isNewVerification?: boolean // true if this admin's WhatsApp was just auto-verified
}

async function resolvePartnerByPhone(
  scope: any,
  phone: string
): Promise<ResolvedPartner | null> {
  try {
    const normalized = phone.replace(/[^0-9]/g, "")
    const partnerService = scope.resolve(PARTNER_MODULE) as any

    const [partners] = await partnerService.listAndCountPartners(
      {},
      { take: 200, relations: ["admins"] }
    )

    // Priority 1: Match against partner.whatsapp_number (verified)
    for (const partner of partners || []) {
      if (!partner.whatsapp_number || !partner.whatsapp_verified) continue
      const waNormalized = partner.whatsapp_number.replace(/[^0-9]/g, "")
      if (phoneMatches(waNormalized, normalized)) {
        // Find which admin this phone belongs to
        const matchedAdmin = (partner.admins || []).find((a: any) => {
          if (!a.phone) return false
          return phoneMatches(a.phone.replace(/[^0-9]/g, ""), normalized)
        })
        return {
          partnerId: partner.id,
          adminName: matchedAdmin
            ? [matchedAdmin.first_name, matchedAdmin.last_name].filter(Boolean).join(" ")
            : partner.admins?.[0]
              ? [partner.admins[0].first_name, partner.admins[0].last_name].filter(Boolean).join(" ")
              : partner.name || "Partner",
          adminId: matchedAdmin?.id,
        }
      }
    }

    // Priority 2: Match against admin phone numbers (even if partner whatsapp not verified)
    // This enables multi-admin WhatsApp — any admin with a phone can message in
    for (const partner of partners || []) {
      for (const admin of partner.admins || []) {
        if (!admin.phone || !admin.is_active) continue
        const adminNormalized = admin.phone.replace(/[^0-9]/g, "")
        if (phoneMatches(adminNormalized, normalized)) {
          const adminName = [admin.first_name, admin.last_name].filter(Boolean).join(" ") || "Partner"

          // Auto-verify: this admin's phone is messaging our business number
          // Mark their WhatsApp as verified in admin metadata
          const adminMeta = (admin.metadata as Record<string, any>) || {}
          let isNewVerification = false

          if (!adminMeta.whatsapp_verified) {
            try {
              await partnerService.updatePartnerAdmins({
                id: admin.id,
                metadata: {
                  ...adminMeta,
                  whatsapp_verified: true,
                  whatsapp_verified_at: new Date().toISOString(),
                  whatsapp_verified_phone: phone,
                },
              })
              isNewVerification = true
            } catch (e: any) {
              console.warn("[whatsapp-handler] Failed to auto-verify admin:", e.message)
            }
          }

          // Also update partner-level whatsapp if not set
          if (!partner.whatsapp_number || !partner.whatsapp_verified) {
            try {
              await partnerService.updatePartners({
                id: partner.id,
                whatsapp_number: phone,
                whatsapp_verified: true,
              })
            } catch { /* non-fatal */ }
          }

          return {
            partnerId: partner.id,
            adminName,
            adminId: admin.id,
            isNewVerification,
          }
        }
      }
    }

    return null
  } catch (e: any) {
    console.error("[whatsapp-handler] Failed to resolve partner:", e.message)
    return null
  }
}

/**
 * Parse an incoming WhatsApp message and execute the appropriate action.
 *
 * @param boundWa - Optional sender-bound WhatsAppService. Passed by the
 *   webhook once it has resolved the inbound phone_number_id so that replies
 *   go out from the correct WhatsApp number. Omitting falls back to the
 *   default sender for backwards compatibility.
 */
export async function handleIncomingMessage(
  scope: any,
  message: IncomingMessage,
  boundWa?: import("../../modules/social-provider/whatsapp-service").default
): Promise<HandlerResult> {
  const whatsappRaw =
    boundWa ?? (scope.resolve(SOCIAL_PROVIDER_MODULE) as SocialProviderService).getWhatsApp(scope)

  // Mark message as read
  await whatsappRaw.markAsRead(message.messageId)

  // Resolve partner
  const partner = await resolvePartnerByPhone(scope, message.from)
  if (!partner) {
    await whatsappRaw.sendTextMessage(
      message.from,
      "Sorry, your phone number is not registered with any partner account. Please contact the admin."
    ).catch((e: any) => {
      // May fail if the number isn't in Meta's allowed test recipients — that's fine
      console.warn("[whatsapp-handler] Could not notify unregistered phone:", e.message)
    })
    return { handled: true, error: "unregistered_phone" }
  }

  // Persist inbound message and get the conversation for outbound tracking + state checks.
  // The sender platform id (when known) is stamped on the conversation so
  // subsequent replies auto-route through the same WhatsApp number.
  const senderPlatformId = whatsappRaw.getSenderPlatformId?.() ?? null
  const conversation = await persistInboundMessage(
    scope,
    message,
    partner.partnerId,
    partner.adminName,
    senderPlatformId
  ).catch((e: any) => {
    console.warn("[whatsapp-handler] Failed to persist inbound message:", e.message)
    return null as { id: string; metadata: Record<string, any> | null; isNew: boolean } | null
  })

  const conversationId = conversation?.id || null
  const conversationMeta = conversation?.metadata || {}

  // Create a scoped wrapper that auto-persists outbound bot replies
  // without mutating the shared WhatsAppService instance
  const persistSend = (result: any, text: string) => {
    if (conversationId) {
      persistOutboundMessage(scope, conversationId, text, result?.messages?.[0]?.id).catch((e: any) => {
        console.warn("[whatsapp-handler] Failed to persist outbound message:", e.message)
      })
    }
  }
  const whatsapp = Object.create(whatsappRaw) as typeof whatsappRaw
  whatsapp.sendTextMessage = async (to: string, text: string, replyTo?: string) => {
    const result = await whatsappRaw.sendTextMessage(to, text, replyTo)
    persistSend(result, text)
    return result
  }
  whatsapp.sendInteractiveMessage = async (to: string, interactive: any) => {
    const result = await whatsappRaw.sendInteractiveMessage(to, interactive)
    persistSend(result, interactive?.body?.text || "[interactive]")
    return result
  }

  // --- First interaction: send welcome + consent request ---
  const consentGiven = conversationMeta.consent_given === true

  // Handle consent button replies
  if (message.type === "interactive" && message.buttonReplyId) {
    if (message.buttonReplyId === "consent_agree") {
      await updateConversationMetadata(scope, conversationId, {
        ...conversationMeta,
        consent_given: true,
        consent_given_at: new Date().toISOString(),
      })
      // Ask for language preference before onboarding
      await sendLanguageSelection(whatsapp, message.from)
      return { handled: true, action: "consent_agreed" }
    }
    if (message.buttonReplyId === "consent_decline") {
      await whatsapp.sendTextMessage(
        message.from,
        `We understand. You can still use the web portal to manage your production runs.\n\nIf you change your mind, just send us a message anytime.`
      )
      return { handled: true, action: "consent_declined" }
    }

    // Handle language selection
    if (message.buttonReplyId === "lang_hi" || message.buttonReplyId === "lang_en") {
      const lang = message.buttonReplyId === "lang_hi" ? "hi" : "en"
      await updateConversationMetadata(scope, conversationId, {
        ...conversationMeta,
        consent_given: true,
        language: lang,
        onboarded: true,
      })
      await sendWelcomeCommands(scope, whatsapp, message.from, partner.partnerId, partner.adminName, lang)
      return { handled: true, action: `language_selected_${lang}` }
    }
  }

  // If consent not yet given, send the consent prompt
  if (!consentGiven) {
    await sendConsentRequest(whatsapp, message.from, partner.adminName)
    return { handled: true, action: "consent_requested" }
  }

  // If consent given but language not yet selected, prompt for it
  if (!conversationMeta.language) {
    await sendLanguageSelection(whatsapp, message.from)
    return { handled: true, action: "language_requested" }
  }

  // --- Normal message processing (consent already given) ---

  // Determine action from button reply or text
  let action = ""
  let runId = ""

  if (message.type === "interactive" && message.buttonReplyId) {
    // Precedence:
    //   1. Template quick-reply buttons → arrive as the localized title
    //      (e.g. "✅ Accept" / "✅ स्वीकार करें") with no runId embedded.
    //      Map title → action via BUTTON_TITLE_ACTIONS and pull the runId
    //      from conversation.metadata.pending_run_id which the outbound
    //      send_whatsapp operation set when the template was dispatched.
    //   2. Decline list-reply ids `decline_<reason>_<runId>` — carry a
    //      reason token that the generic split would swallow.
    //   3. Native interactive ids `<action>_prod_run_<id>` — the long-
    //      standing shape used by sendProductionRunAssignment,
    //      sendRunActions, etc.
    const titleAction =
      (message.buttonReplyTitle && BUTTON_TITLE_ACTIONS[message.buttonReplyTitle]) ||
      BUTTON_TITLE_ACTIONS[message.buttonReplyId]
    if (titleAction) {
      action = titleAction
      runId = typeof conversationMeta.pending_run_id === "string"
        ? conversationMeta.pending_run_id
        : ""
      if (!runId) {
        await whatsapp.sendTextMessage(
          message.from,
          `I couldn't tell which run this ${titleAction} refers to. Please reply with \`${titleAction} <run id>\`.`
        )
        return { handled: true, action: "template_button_no_context" }
      }
    } else {
      const declineParsed = parseDeclineButtonId(message.buttonReplyId)
      if (declineParsed) {
        action = declineParsed.action
        runId = declineParsed.runId
      } else {
        // Button replies: "accept_prod_run_123", "start_prod_run_123", etc.
        const parts = message.buttonReplyId.split("_")
        action = parts[0] // accept, start, finish, complete, view, media, status
        runId = parts.slice(1).join("_") // rejoin in case run ID has underscores
      }
    }
  } else if (message.type === "text" && message.text) {
    const parsed = parseTextCommand(message.text.trim())
    action = parsed.action
    runId = parsed.runId
  } else if (message.type === "image" || message.type === "video" || message.type === "document") {
    // Save media to partner's media folder. If the partner recently tapped
    // "Add Media" on a started run (button payload `media_<runId>`), we
    // have a short-lived pointer to the target run on conversation.metadata
    // — attach the file to that run's design. Outside that window we just
    // keep the file in the inbox, same as before.
    if (message.mediaId) {
      try {
        const saved = await downloadAndSaveWhatsAppMedia(scope, {
          mediaId: message.mediaId,
          mediaUrl: message.mediaUrl,
          mimeType: message.mediaMimeType,
          partnerId: partner.partnerId,
          partnerName: partner.adminName,
          caption: message.text,
        })

        // Resolve the attachment target.
        //
        // Priority:
        //   1. `active_media_run_id` on conversation.metadata — set when the
        //      partner recently tapped "📸 Add Media" on a started run.
        //      Short-lived (10-min TTL).
        //   2. Auto-route — if the partner has exactly one in_progress run
        //      with `started_at` set, attach photos to it automatically.
        //      Covers the common case where a partner snaps progress pics
        //      without remembering to tap the button first.
        //   3. Fall through to "saved to inbox" with a nudge.
        const pointedRunId = typeof conversationMeta.active_media_run_id === "string"
          ? conversationMeta.active_media_run_id
          : null
        const expiresAt = typeof conversationMeta.active_media_expires_at === "string"
          ? Date.parse(conversationMeta.active_media_expires_at)
          : NaN
        const contextStillValid =
          !!pointedRunId && !Number.isNaN(expiresAt) && expiresAt > Date.now()

        let autoResolvedRunId: string | null = null
        let autoResolveReason: "none" | "single" | "multiple" = "none"
        if (saved && !contextStillValid) {
          const lookup = await findSinglePartnerActiveRun(scope, partner.partnerId)
          autoResolvedRunId = lookup.runId
          autoResolveReason = lookup.reason
        }

        const targetRunId: string | null = contextStillValid
          ? pointedRunId
          : autoResolvedRunId

        let attachedRunId: string | null = null
        let attachError: string | null = null

        if (saved && targetRunId) {
          const result = await attachMediaToRunDesign(scope, {
            runId: targetRunId,
            partnerId: partner.partnerId,
            fileUrl: saved.fileUrl,
          })

          if (result.ok) {
            attachedRunId = result.runId
          } else {
            // Translate internal reason into a partner-facing hint.
            const msgMap: Record<typeof result.reason, string> = {
              run_not_found: `Run ${targetRunId} no longer exists.`,
              not_partner_run: `Run ${targetRunId} is not assigned to your account.`,
              not_started: `Run ${targetRunId} hasn't been started yet. Tap Start, then send the photo.`,
              terminal_state: `Run ${targetRunId} is ${result.detail ?? "closed"} — can't attach media.`,
              no_design: `Run ${targetRunId} has no design linked — can't attach media.`,
              attach_failed: "Couldn't attach to the run. Saved to inbox instead.",
            }
            attachError = msgMap[result.reason]
          }
        }

        // Persist the media URL + (if attached) the run context on the
        // messaging_message row so the inbox shows which run it belonged to.
        if (saved && conversationId) {
          const messagingService = scope.resolve(MESSAGING_MODULE) as any
          const [latestMessages] = await messagingService.listAndCountMessagingMessages(
            { conversation_id: conversationId },
            { take: 1, order: { created_at: "DESC" } }
          )
          const lastMsg = latestMessages?.[0]
          if (lastMsg?.wa_message_id === message.messageId) {
            await messagingService.updateMessagingMessages({
              id: lastMsg.id,
              media_url: saved.fileUrl,
              media_mime_type: saved.mimeType,
              content: message.text || `[${message.type}]`,
              ...(attachedRunId
                ? { context_type: "production_run", context_id: attachedRunId }
                : {}),
            })
          }
        }

        // Clear the one-shot attach pointer so the next photo doesn't
        // silently land on the same run.
        if (contextStillValid && conversationId) {
          await updateConversationMetadata(scope, conversationId, {
            ...conversationMeta,
            active_media_run_id: undefined,
            active_media_expires_at: undefined,
          })
        }

        if (attachedRunId) {
          const suffix = contextStillValid
            ? ""
            : " (auto-matched — you only have one run in progress)"
          await whatsapp.sendTextMessage(
            message.from,
            `📎 Photo attached to run ${attachedRunId}${suffix}.`
          )
        } else if (attachError) {
          await whatsapp.sendTextMessage(message.from, attachError)
        } else if (!pointedRunId) {
          // No tap, no single run to auto-match. Leave in the inbox and
          // nudge — the message differs depending on why we couldn't
          // auto-route so the partner knows what to do.
          const hint =
            autoResolveReason === "multiple"
              ? "You have several runs in progress — tap *📸 Add Media* on the specific run, then send the photo."
              : "To attach a photo to a specific run, tap *📸 Add Media* on a started run first, then send the photo."
          await whatsapp.sendTextMessage(
            message.from,
            `📥 Received — saved to your inbox. ${hint}`
          )
        }
      } catch (e: any) {
        console.warn("[whatsapp-handler] Failed to save media:", e.message)
      }
    }
    return { handled: true, action: "media_saved" }
  }

  if (!action) {
    // Casual message — just save to conversation, no bot reply
    // Admin will see it in the messaging inbox and can respond manually
    return { handled: true, action: "conversation" }
  }

  // Execute action
  try {
    switch (action) {
      case "accept":
        return await handleAccept(scope, whatsapp, message.from, runId, partner.partnerId)
      case "start":
        return await handleStart(scope, whatsapp, message.from, runId, partner.partnerId)
      case "finish":
        return await handleFinish(
          scope,
          whatsapp,
          message.from,
          runId,
          partner.partnerId,
          message.text
        )
      case "complete":
        return await handleComplete(scope, whatsapp, message.from, runId, partner.partnerId, message.text)
      case "decline":
        // Top-level decline (button tap or text "decline prod_run_…") →
        // prompt for a reason. The reason reply loops back through the
        // same handler and hits one of the handleDecline* cases.
        return await handleDeclinePrompt(scope, whatsapp, message.from, runId)
      case "media":
        return await handleMediaPrompt(
          scope,
          whatsapp,
          message.from,
          runId,
          partner.partnerId,
          conversationId,
          conversationMeta
        )
      case "decline_capacity":
      case "decline_materials":
      case "decline_scheduling":
      case "decline_other":
        return await handleDecline(
          scope,
          whatsapp,
          message.from,
          runId,
          partner.partnerId,
          action.replace("decline_", "") as DeclineReason
        )
      case "view":
      case "status":
        return await handleViewStatus(scope, whatsapp, message.from, runId, partner.partnerId)
      case "runs":
      case "list":
        return await handleListRuns(scope, whatsapp, message.from, partner.partnerId)
      case "help":
        await sendHelpMessage(scope, whatsapp, message.from, partner.partnerId, partner.adminName, conversationMeta.language)
        return { handled: true, action: "help" }
      default:
        await whatsapp.sendTextMessage(
          message.from,
          `Unknown action: "${action}". Reply *help* to see available commands.`
        )
        return { handled: true, action: "unknown", error: action }
    }
  } catch (e: any) {
    console.error(`[whatsapp-handler] Action ${action} failed:`, e.message)
    await whatsapp.sendTextMessage(
      message.from,
      `⚠️ Action failed: ${e.message}\n\nPlease try again or use the web portal.`
    )
    return { handled: true, action, runId, error: e.message }
  }
}

/**
 * Parse free-text commands like "accept prod_run_123" or "complete prod_run_123 100"
 */
type DeclineReason = "capacity" | "materials" | "scheduling" | "other"

const DECLINE_REASON_TOKENS: DeclineReason[] = ["capacity", "materials", "scheduling", "other"]

/**
 * Decline button ids ship as `decline_<reason>_<runId>` where reason is one
 * of a fixed set and runId may itself contain underscores (prod_run_…).
 * The generic `split("_")` parser in the dispatcher would swallow the
 * reason into the runId, so we match the reason explicitly here and
 * return both. Plain `decline_<runId>` (tapped directly on assignment)
 * returns action="decline" so the prompt flow fires.
 */
function parseDeclineButtonId(
  buttonId: string
): { action: string; runId: string } | null {
  if (!buttonId.startsWith("decline_")) return null
  const rest = buttonId.slice("decline_".length)

  for (const reason of DECLINE_REASON_TOKENS) {
    const prefix = `${reason}_`
    if (rest.startsWith(prefix)) {
      return {
        action: `decline_${reason}`,
        runId: rest.slice(prefix.length),
      }
    }
  }

  // No reason token → treat as the initial Decline button on an assignment
  return { action: "decline", runId: rest }
}

function parseTextCommand(text: string): { action: string; runId: string; extra?: string } {
  const trimmed = text.trim()
  const lower = trimmed.toLowerCase()

  // Check for simple keywords
  if (lower === "help" || lower === "menu") {
    return { action: "help", runId: "" }
  }
  // Greetings — treated as no specific action (nudge will handle)
  if (lower === "hi" || lower === "hello" || lower === "hey") {
    return { action: "", runId: "" }
  }
  if (lower === "runs" || lower === "list" || lower === "my runs") {
    return { action: "runs", runId: "" }
  }

  // Pattern: <action> <run_id> [extra] — match against original to preserve run ID case
  const match = trimmed.match(/^(accept|start|finish|complete|status|view|media|decline)\s+(prod_run_\S+)(.*)$/i)
  if (match) {
    return { action: match[1].toLowerCase(), runId: match[2], extra: match[3]?.trim() }
  }

  // Pattern: just a run ID
  const runMatch = trimmed.match(/^(prod_run_\S+)$/i)
  if (runMatch) {
    return { action: "status", runId: runMatch[1] }
  }

  return { action: "", runId: "" }
}

async function handleAccept(
  scope: any,
  whatsapp: WhatsAppService,
  phone: string,
  runId: string,
  partnerId: string
): Promise<HandlerResult> {
  const { result, errors } = await acceptProductionRunWorkflow(scope).run({
    input: { production_run_id: runId, partner_id: partnerId },
  })

  if (errors?.length) {
    const msg = errors.map((e: any) => e?.error?.message || String(e)).join(", ")
    throw new Error(msg)
  }

  // Emit event
  await emitEvent(scope, "production_run.accepted", { id: runId, production_run_id: runId, partner_id: partnerId, action: "accepted" })

  // Send next-step buttons
  const designName = await getDesignName(scope, runId)
  await whatsapp.sendRunActions(phone, runId, "in_progress", designName)

  return { handled: true, action: "accept", runId }
}

/**
 * Partner tapped "📸 Add Media" on a started run. Verify the run is in a
 * state where media is allowed (between start and complete), then stash a
 * short-lived pointer on the conversation so the next inbound photo /
 * video / document gets attached to this run automatically. The pointer
 * expires in 10 minutes to prevent stray photos from landing on an old
 * run context.
 */
async function handleMediaPrompt(
  scope: any,
  whatsapp: WhatsAppService,
  phone: string,
  runId: string,
  partnerId: string,
  conversationId: string | null,
  conversationMeta: Record<string, any>
): Promise<HandlerResult> {
  const productionRunService = scope.resolve(PRODUCTION_RUNS_MODULE) as ProductionRunService
  const run = await productionRunService.retrieveProductionRun(runId).catch(() => null) as any

  if (!run) {
    await whatsapp.sendTextMessage(phone, `Run ${runId} not found.`)
    return { handled: true, action: "media_not_found", runId }
  }
  if (run.partner_id !== partnerId) {
    await whatsapp.sendTextMessage(phone, `Run ${runId} is not assigned to your account.`)
    return { handled: true, action: "media_forbidden", runId }
  }
  if (run.status === "cancelled" || run.status === "completed") {
    await whatsapp.sendTextMessage(
      phone,
      `Run ${runId} is ${run.status} — can't attach media anymore.`
    )
    return { handled: true, action: "media_blocked_terminal", runId }
  }
  if (!run.started_at || run.status !== "in_progress") {
    await whatsapp.sendTextMessage(
      phone,
      `Run ${runId} hasn't been started yet. Tap *▶️ Start* first, then add media.`
    )
    return { handled: true, action: "media_blocked_not_started", runId }
  }

  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
  await updateConversationMetadata(scope, conversationId, {
    ...conversationMeta,
    active_media_run_id: runId,
    active_media_expires_at: expiresAt,
  })

  const designName = await getDesignName(scope, runId).catch(() => runId)
  await whatsapp.sendTextMessage(
    phone,
    `📸 Ready — send your photo, video, or document in the next message and I'll attach it to run ${runId} (${designName}).\n\n_Window: 10 minutes._`
  )
  return { handled: true, action: "media_prompt", runId }
}

/**
 * Prompt the partner with the decline-reason list. Fires on the initial
 * `decline_<runId>` tap (or `decline prod_run_…` text) before we make the
 * backend call, so the partner's "why" is captured and admin has context.
 */
async function handleDeclinePrompt(
  scope: any,
  whatsapp: WhatsAppService,
  phone: string,
  runId: string
): Promise<HandlerResult> {
  const designName = await getDesignName(scope, runId).catch(() => undefined)
  await whatsapp.sendDeclineReasons(phone, runId, designName)
  return { handled: true, action: "decline_prompt", runId }
}

/**
 * Commit a partner decline to the backend once a reason has been picked.
 * Uses the WhatsApp-mapped reason token (`materials` / `scheduling` / …)
 * and maps to the API's stricter enum (`materials_unavailable`, etc.) to
 * keep the button ids short while the backend stays explicit.
 */
async function handleDecline(
  scope: any,
  whatsapp: WhatsAppService,
  phone: string,
  runId: string,
  partnerId: string,
  reason: DeclineReason
): Promise<HandlerResult> {
  // Short token → backend enum
  const reasonMap: Record<DeclineReason, string> = {
    capacity: "capacity",
    materials: "materials_unavailable",
    scheduling: "scheduling_conflict",
    other: "other",
  }
  const apiReason = reasonMap[reason]

  // Reuse the partner HTTP route so we share guard logic (ownership,
  // started_at check, task cancellation). Going through the route also
  // emits `production_run.declined` + `production_run.cancelled` for
  // downstream subscribers.
  const productionRunService = scope.resolve(PRODUCTION_RUNS_MODULE) as ProductionRunService
  const run = await productionRunService.retrieveProductionRun(runId).catch(() => null) as any
  if (!run) {
    await whatsapp.sendTextMessage(phone, `Run ${runId} not found.`)
    return { handled: true, action: "decline_not_found", runId }
  }
  if (run.partner_id !== partnerId) {
    await whatsapp.sendTextMessage(phone, `Run ${runId} is not assigned to your account.`)
    return { handled: true, action: "decline_forbidden", runId }
  }
  if (run.status === "cancelled") {
    await whatsapp.sendTextMessage(phone, `Run ${runId} is already cancelled.`)
    return { handled: true, action: "decline_already", runId }
  }
  if (run.started_at) {
    await whatsapp.sendTextMessage(
      phone,
      `Can't decline ${runId} — work has already started. Please contact admin to cancel mid-production.`
    )
    return { handled: true, action: "decline_blocked_started", runId }
  }

  await productionRunService.updateProductionRuns({
    id: runId,
    status: "cancelled",
    cancelled_at: new Date(),
    cancelled_reason: `Declined by partner (${apiReason})`,
  })

  // Fire both events (mirrors the HTTP route) so admin feed + existing
  // cancellation subscribers see this.
  await emitEvent(scope, "production_run.declined", {
    id: runId,
    production_run_id: runId,
    partner_id: partnerId,
    action: "declined",
    reason: apiReason,
  })
  await emitEvent(scope, "production_run.cancelled", {
    id: runId,
    production_run_id: runId,
    partner_id: partnerId,
    action: "cancelled",
    notes: `Declined by partner (${apiReason})`,
  })

  await whatsapp.sendTextMessage(
    phone,
    `✖️ Run ${runId} declined (${apiReason.replace(/_/g, " ")}). Admin has been notified.`
  )
  return { handled: true, action: `decline_${reason}`, runId }
}

async function handleStart(
  scope: any,
  whatsapp: WhatsAppService,
  phone: string,
  runId: string,
  partnerId: string
): Promise<HandlerResult> {
  const productionRunService: ProductionRunService = scope.resolve(PRODUCTION_RUNS_MODULE)
  const run = await productionRunService.retrieveProductionRun(runId).catch(() => null) as any

  if (!run || run.partner_id !== partnerId) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Production run ${runId} not found`)
  }

  if (run.status !== "in_progress") {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `Run must be in_progress to start. Current: ${run.status}`)
  }
  if (run.started_at) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Run already started")
  }

  await productionRunService.updateProductionRuns({ id: runId, started_at: new Date() })

  // Signal lifecycle
  const transactionId = (run as any).lifecycle_transaction_id
  if (transactionId) {
    await signalLifecycleStepSuccessWorkflow(scope)
      .run({ input: { transaction_id: transactionId, step_id: awaitRunStartStepId } })
      .catch(() => {})
  }

  await emitEvent(scope, "production_run.started", { id: runId, production_run_id: runId, partner_id: partnerId, action: "started" })

  const designName = await getDesignName(scope, runId)
  await whatsapp.sendRunActions(phone, runId, "started", designName)

  return { handled: true, action: "start", runId }
}

async function handleFinish(
  scope: any,
  whatsapp: WhatsAppService,
  phone: string,
  runId: string,
  partnerId: string,
  rawText?: string
): Promise<HandlerResult> {
  const productionRunService: ProductionRunService = scope.resolve(PRODUCTION_RUNS_MODULE)
  const run = await productionRunService.retrieveProductionRun(runId).catch(() => null) as any

  if (!run || run.partner_id !== partnerId) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Production run ${runId} not found`)
  }

  if (run.status !== "in_progress") {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `Run must be in_progress. Current: ${run.status}`)
  }
  if (!run.started_at) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Run must be started first")
  }

  // Parse optional inline detail from the text command. Accepts:
  //   finish prod_run_X scrap:5 notes:stitching defects
  //   finish prod_run_X scrap:5
  //   finish prod_run_X notes:all good
  //   finish prod_run_X
  // Partner gets a structured `finish_notes` line on the run plus a
  // `rejected_quantity` update when scrap is provided — so complete-time
  // reports stay consistent without a second round trip.
  const { scrap, notes, finishNote } = parseFinishExtras(rawText)

  const update: Record<string, any> = { id: runId, finished_at: new Date() }
  if (finishNote) update.finish_notes = finishNote
  if (scrap != null) update.rejected_quantity = scrap

  await productionRunService.updateProductionRuns(update)

  // Move design to Technical_Review
  if (run.design_id) {
    try {
      const designService = scope.resolve("design") as any
      const design = await designService.retrieveDesign(run.design_id)
      if (["In_Development", "Sample_Production", "Revision"].includes(design.status)) {
        await designService.updateDesigns({ id: run.design_id, status: "Technical_Review" })
      }
    } catch { /* non-fatal */ }
  }

  // Signal lifecycle
  const transactionId = (run as any).lifecycle_transaction_id
  if (transactionId) {
    await signalLifecycleStepSuccessWorkflow(scope)
      .run({ input: { transaction_id: transactionId, step_id: awaitRunFinishStepId } })
      .catch(() => {})
  }

  await emitEvent(scope, "production_run.finished", {
    id: runId,
    production_run_id: runId,
    partner_id: partnerId,
    action: "finished",
    ...(scrap != null ? { rejected_quantity: scrap } : {}),
    ...(notes ? { notes } : {}),
  })

  const designName = await getDesignName(scope, runId)
  await whatsapp.sendRunActions(phone, runId, "finished", designName)

  // Extra feedback to the partner when they logged scrap/notes so they
  // see their input landed.
  if (scrap != null || notes) {
    const parts: string[] = []
    if (scrap != null) parts.push(`scrap recorded: ${scrap}`)
    if (notes) parts.push(`notes saved`)
    await whatsapp.sendTextMessage(phone, `📝 ${parts.join(" · ")}.`)
  }

  return { handled: true, action: "finish", runId }
}

/**
 * Extract scrap quantity + freeform notes from the finish text command.
 * Returns a normalized `finishNote` string to persist on the run so admins
 * see a consistent shape regardless of how the partner typed it.
 */
function parseFinishExtras(
  rawText?: string
): { scrap: number | null; notes: string | null; finishNote: string | null } {
  if (!rawText) return { scrap: null, notes: null, finishNote: null }

  // scrap:5 / scrap 5 / rejected:5 / defect:5
  const scrapMatch = rawText.match(/\b(?:scrap|rejected|defect)s?[:\s]+(\d+)/i)
  // notes:anything (takes everything until end or before another keyword)
  const notesMatch = rawText.match(/\bnotes?[:\s]+(.+?)(?:\s+(?:scrap|rejected|defects?)[:\s]|$)/i)

  const scrap = scrapMatch ? parseInt(scrapMatch[1], 10) : null
  const notes = notesMatch ? notesMatch[1].trim().slice(0, 500) : null

  if (scrap == null && !notes) {
    return { scrap: null, notes: null, finishNote: null }
  }

  const pieces: string[] = []
  if (scrap != null) pieces.push(`Scrap: ${scrap}`)
  if (notes) pieces.push(`Notes: ${notes}`)
  return { scrap, notes, finishNote: pieces.join(". ") + "." }
}

async function handleComplete(
  scope: any,
  whatsapp: WhatsAppService,
  phone: string,
  runId: string,
  partnerId: string,
  rawText?: string
): Promise<HandlerResult> {
  const productionRunService: ProductionRunService = scope.resolve(PRODUCTION_RUNS_MODULE)
  const run = await productionRunService.retrieveProductionRun(runId).catch(() => null) as any

  if (!run || run.partner_id !== partnerId) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Production run ${runId} not found`)
  }

  if (run.status !== "in_progress") {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `Run must be in_progress. Current: ${run.status}`)
  }
  if (!run.finished_at) {
    // If not finished, prompt to finish first or ask for completion prompt
    const designName = await getDesignName(scope, runId)
    await whatsapp.sendCompletionPrompt(phone, runId, designName)
    return { handled: true, action: "complete_prompt", runId }
  }

  // Parse quantity from text if provided
  let producedQuantity: number | undefined
  let rejectedQuantity: number | undefined

  if (rawText) {
    // "complete prod_run_123 produced:100 rejected:5" or "complete prod_run_123 100"
    const producedMatch = rawText.match(/produced[:\s]+(\d+)/i)
    const rejectedMatch = rawText.match(/rejected[:\s]+(\d+)/i)
    const simpleMatch = rawText.match(/\b(\d+)\s*$/)

    if (producedMatch) producedQuantity = parseInt(producedMatch[1])
    else if (simpleMatch) producedQuantity = parseInt(simpleMatch[1])
    if (rejectedMatch) rejectedQuantity = parseInt(rejectedMatch[1])
  }

  // Mark as completed
  await productionRunService.updateProductionRuns({
    id: runId,
    status: "completed" as any,
    completed_at: new Date(),
    ...(producedQuantity != null ? { produced_quantity: producedQuantity } : {}),
    ...(rejectedQuantity != null ? { rejected_quantity: rejectedQuantity } : {}),
  })

  // Signal lifecycle
  const transactionId = (run as any).lifecycle_transaction_id
  if (transactionId) {
    await signalLifecycleStepSuccessWorkflow(scope)
      .run({ input: { transaction_id: transactionId, step_id: awaitRunCompleteStepId } })
      .catch(() => {})
  }

  await emitEvent(scope, "production_run.completed", {
    id: runId,
    production_run_id: runId,
    partner_id: partnerId,
    action: "completed",
    produced_quantity: producedQuantity,
    rejected_quantity: rejectedQuantity || 0,
  })

  const qtyInfo = producedQuantity != null
    ? `\n*Produced:* ${producedQuantity}${rejectedQuantity ? ` | *Rejected:* ${rejectedQuantity}` : ""}`
    : ""

  await whatsapp.sendTextMessage(
    phone,
    `✅ *Production Run Completed!*\n*Run:* ${runId}${qtyInfo}\n\nThe admin has been notified. Thank you!`
  )

  return { handled: true, action: "complete", runId }
}

async function handleViewStatus(
  scope: any,
  whatsapp: WhatsAppService,
  phone: string,
  runId: string,
  partnerId: string
): Promise<HandlerResult> {
  const productionRunService: ProductionRunService = scope.resolve(PRODUCTION_RUNS_MODULE)
  const run = await productionRunService.retrieveProductionRun(runId).catch(() => null) as any

  if (!run || run.partner_id !== partnerId) {
    await whatsapp.sendTextMessage(phone, `Production run ${runId} not found.`)
    return { handled: true, action: "view", runId, error: "not_found" }
  }

  const designName = await getDesignName(scope, runId)

  // If actionable, send with buttons
  if (["sent_to_partner", "in_progress"].includes(run.status) && run.status !== "completed") {
    if (run.status === "sent_to_partner") {
      await whatsapp.sendProductionRunAssignment(phone, {
        designName,
        runId,
        runType: run.run_type || "production",
        quantity: run.quantity,
      })
    } else {
      const displayStatus = run.finished_at ? "finished" : run.started_at ? "started" : "in_progress"
      await whatsapp.sendRunActions(phone, runId, displayStatus, designName)
    }
  } else {
    const lines = [
      `📋 *Production Run:* ${runId}`,
      `*Design:* ${designName}`,
      `*Status:* ${run.status}`,
      `*Type:* ${run.run_type || "production"}`,
    ]
    if (run.quantity) lines.push(`*Quantity:* ${run.quantity}`)
    if (run.produced_quantity != null) lines.push(`*Produced:* ${run.produced_quantity}`)
    if (run.rejected_quantity) lines.push(`*Rejected:* ${run.rejected_quantity}`)
    await whatsapp.sendTextMessage(phone, lines.join("\n"))
  }

  return { handled: true, action: "view", runId }
}

async function handleListRuns(
  scope: any,
  whatsapp: WhatsAppService,
  phone: string,
  partnerId: string
): Promise<HandlerResult> {
  const query = scope.resolve("query") as any
  const { data: runs } = await query.graph({
    entity: "production_runs",
    fields: ["id", "status", "run_type", "design_id", "quantity"],
    filters: {
      partner_id: partnerId,
      status: { $in: ["sent_to_partner", "in_progress"] },
    },
    pagination: { skip: 0, take: 20 },
  })

  const enriched: Array<{ id: string; designName: string; status: string; runType: string }> = []
  for (const run of runs || []) {
    const designName = await getDesignNameFromDesignId(scope, run.design_id)
    enriched.push({
      id: run.id,
      designName,
      status: run.status,
      runType: run.run_type || "production",
    })
  }

  await whatsapp.sendRunsSummary(phone, enriched)
  return { handled: true, action: "list" }
}

/**
 * Send consent request on first interaction — partner must agree before we process commands.
 */
async function sendConsentRequest(
  whatsapp: WhatsAppService,
  phone: string,
  adminName: string
): Promise<void> {
  await whatsapp.sendInteractiveMessage(phone, {
    type: "button",
    body: {
      text:
        `Hi ${adminName}! Welcome to JYT Commerce on WhatsApp.\n\n` +
        `Before we get started, please note that this conversation ` +
        `will be recorded for quality assurance and order management purposes.\n\n` +
        `Do you agree to continue?`,
    },
    footer: { text: "You can manage runs from the web portal at any time." },
    action: {
      buttons: [
        { type: "reply", reply: { id: "consent_agree", title: "I Agree" } },
        { type: "reply", reply: { id: "consent_decline", title: "No Thanks" } },
      ],
    },
  })
}

/**
 * Ask the partner to choose their preferred language.
 */
async function sendLanguageSelection(
  whatsapp: WhatsAppService,
  phone: string
): Promise<void> {
  await whatsapp.sendInteractiveMessage(phone, {
    type: "button",
    body: {
      text: `कृपया अपनी भाषा चुनें / Please choose your language:`,
    },
    action: {
      buttons: [
        { type: "reply", reply: { id: "lang_hi", title: "हिंदी" } },
        { type: "reply", reply: { id: "lang_en", title: "English" } },
      ],
    },
  })
}

/**
 * After consent + language selection, send a one-time welcome with available commands.
 */
async function sendWelcomeCommands(
  scope: any,
  whatsapp: WhatsAppService,
  phone: string,
  partnerId: string,
  adminName: string,
  lang: string = "en"
): Promise<void> {
  const query = scope.resolve("query") as any
  const { data: runs } = await query.graph({
    entity: "production_runs",
    fields: ["id"],
    filters: {
      partner_id: partnerId,
      status: { $in: ["sent_to_partner", "in_progress"] },
    },
    pagination: { skip: 0, take: 1 },
  })

  const activeCount = runs?.length || 0

  if (lang === "hi") {
    await whatsapp.sendTextMessage(
      phone,
      `बहुत अच्छा ${adminName}, आप तैयार हैं!\n\n` +
      `आप यह कर सकते हैं:\n` +
      `• *runs* — अपने सक्रिय प्रोडक्शन रन देखें${activeCount > 0 ? ` (${activeCount})` : ""}\n` +
      `• *accept <run_id>* — असाइन किया गया रन स्वीकार करें\n` +
      `• *start <run_id>* — रन पर काम शुरू करें\n` +
      `• *finish <run_id>* — रन को पूरा हुआ चिह्नित करें\n` +
      `• *complete <run_id> <qty>* — उत्पादित मात्रा के साथ पूरा करें\n` +
      `• *status <run_id>* — रन विवरण देखें\n` +
      `• *help* — यह संदेश दिखाएं\n\n` +
      `_या बटन दबाकर तुरंत कार्रवाई करें।_`
    )
  } else {
    await whatsapp.sendTextMessage(
      phone,
      `Great, you're all set ${adminName}!\n\n` +
      `Here's what you can do:\n` +
      `• *runs* — List your active production runs${activeCount > 0 ? ` (${activeCount})` : ""}\n` +
      `• *accept <run_id>* — Accept an assigned run\n` +
      `• *start <run_id>* — Start working on a run\n` +
      `• *finish <run_id>* — Mark a run as finished\n` +
      `• *complete <run_id> <qty>* — Complete with produced quantity\n` +
      `• *status <run_id>* — View run details\n` +
      `• *help* — Show this message\n\n` +
      `_Or tap buttons in messages to take quick actions._`
    )
  }
}

/**
 * Show help when partner explicitly asks for it (already onboarded).
 */
async function sendHelpMessage(
  scope: any,
  whatsapp: WhatsAppService,
  phone: string,
  partnerId: string,
  adminName: string,
  lang?: string
): Promise<void> {
  const query = scope.resolve("query") as any
  const { data: runs } = await query.graph({
    entity: "production_runs",
    fields: ["id"],
    filters: {
      partner_id: partnerId,
      status: { $in: ["sent_to_partner", "in_progress"] },
    },
    pagination: { skip: 0, take: 1 },
  })

  const activeCount = runs?.length || 0

  if (lang === "hi") {
    await whatsapp.sendTextMessage(
      phone,
      `*उपलब्ध कमांड:*\n` +
      `• *runs* — अपने सक्रिय प्रोडक्शन रन देखें${activeCount > 0 ? ` (${activeCount})` : ""}\n` +
      `• *accept <run_id>* — असाइन किया गया रन स्वीकार करें\n` +
      `• *start <run_id>* — रन पर काम शुरू करें\n` +
      `• *finish <run_id>* — रन को पूरा हुआ चिह्नित करें\n` +
      `• *complete <run_id> <qty>* — उत्पादित मात्रा के साथ पूरा करें\n` +
      `• *status <run_id>* — रन विवरण देखें\n` +
      `• *help* — यह संदेश दिखाएं\n\n` +
      `_या बटन दबाकर तुरंत कार्रवाई करें।_`
    )
  } else {
    await whatsapp.sendTextMessage(
      phone,
      `*Available Commands:*\n` +
      `• *runs* — List your active production runs${activeCount > 0 ? ` (${activeCount})` : ""}\n` +
      `• *accept <run_id>* — Accept an assigned run\n` +
      `• *start <run_id>* — Start working on a run\n` +
      `• *finish <run_id>* — Mark a run as finished\n` +
      `• *complete <run_id> <qty>* — Complete with produced quantity\n` +
      `• *status <run_id>* — View run details\n` +
      `• *help* — Show this message\n\n` +
      `_Or tap buttons in messages to take quick actions._`
    )
  }
}

/**
 * Update conversation metadata (consent state, onboarding, etc.)
 */
async function updateConversationMetadata(
  scope: any,
  conversationId: string | null,
  metadata: Record<string, any>
): Promise<void> {
  if (!conversationId) return
  try {
    const messagingService = scope.resolve(MESSAGING_MODULE) as any
    await messagingService.updateMessagingConversations({
      id: conversationId,
      metadata,
    })
  } catch (e: any) {
    console.warn("[whatsapp-handler] Failed to update conversation metadata:", e.message)
  }
}

// Helpers

/**
 * Inspect a partner's production runs and return the single run that's
 * currently *actively in progress* (status === "in_progress" AND
 * `started_at` is set). Used by the media upload fallback — if the
 * partner sends a photo without tapping "Add Media" first, auto-attach
 * only when there's no ambiguity.
 *
 * Returns:
 *   - { runId, reason: "single" }   — exactly one match, safe to auto-route
 *   - { runId: null, reason: "none" } — partner has nothing in progress
 *   - { runId: null, reason: "multiple" } — needs explicit choice, caller
 *     should prompt
 */
async function findSinglePartnerActiveRun(
  scope: any,
  partnerId: string
): Promise<{ runId: string | null; reason: "none" | "single" | "multiple" }> {
  try {
    const productionRunService: ProductionRunService = scope.resolve(PRODUCTION_RUNS_MODULE)
    const [runs] = await productionRunService.listAndCountProductionRuns(
      { partner_id: partnerId, status: "in_progress" as any },
      { take: 50 }
    )
    const started = (runs as any[] | null | undefined ?? []).filter(
      (r: any) => r && r.started_at
    )
    if (started.length === 1) {
      return { runId: started[0].id, reason: "single" }
    }
    if (started.length === 0) {
      return { runId: null, reason: "none" }
    }
    return { runId: null, reason: "multiple" }
  } catch {
    return { runId: null, reason: "none" }
  }
}

async function getDesignName(scope: any, runId: string): Promise<string> {
  try {
    const productionRunService: ProductionRunService = scope.resolve(PRODUCTION_RUNS_MODULE)
    const run = await productionRunService.retrieveProductionRun(runId) as any
    if (run?.design_id) {
      return getDesignNameFromDesignId(scope, run.design_id)
    }
  } catch { /* fall through */ }
  return "Unknown Design"
}

async function getDesignNameFromDesignId(scope: any, designId: string | null): Promise<string> {
  if (!designId) return "Unknown Design"
  try {
    const designService = scope.resolve("design") as any
    const design = await designService.retrieveDesign(designId)
    return design?.name || design?.title || designId
  } catch {
    return designId
  }
}

async function emitEvent(scope: any, name: string, data: Record<string, any>): Promise<void> {
  try {
    const { Modules } = await import("@medusajs/framework/utils")
    const eventService = scope.resolve(Modules.EVENT_BUS) as any
    await eventService.emit([{ name, data }])
  } catch { /* non-fatal */ }
}

/**
 * Match two phone numbers accounting for country code prefix variations.
 */
function phoneMatches(a: string, b: string): boolean {
  return a === b || a.endsWith(b) || b.endsWith(a)
}

/**
 * Persist an inbound WhatsApp message to the messaging module.
 * Resolves or creates a conversation for the partner+phone pair.
 * Returns conversation info including metadata for consent/onboarding checks.
 */
async function persistInboundMessage(
  scope: any,
  message: IncomingMessage,
  partnerId: string,
  senderName: string,
  senderPlatformId: string | null = null
): Promise<{ id: string; metadata: Record<string, any> | null; isNew: boolean }> {
  const messagingService = scope.resolve(MESSAGING_MODULE) as any

  // Normalize incoming phone: digits only
  const incomingDigits = message.from.replace(/[^0-9]/g, "")

  // Find existing conversation for this partner by matching phone numbers
  // WhatsApp sends digits-only (393933806825), but conversations may store
  // with "+" prefix (+393933806825) or other formatting
  const [allConversations] = await messagingService.listAndCountMessagingConversations(
    { partner_id: partnerId },
    { take: 50 }
  )

  const existing = (allConversations || []).find((conv: any) => {
    const convDigits = (conv.phone_number || "").replace(/[^0-9]/g, "")
    return phoneMatches(convDigits, incomingDigits)
  })

  let conversationId: string
  let metadata: Record<string, any> | null = null
  let isNew = false

  if (existing) {
    conversationId = existing.id
    metadata = existing.metadata || null
    const needsReactivate = existing.status === "archived"
    // Stamp the sender platform once, if we know it and the conversation
    // doesn't already have one. Don't overwrite — an admin may have pinned
    // a different sender deliberately.
    const needsSenderStamp =
      senderPlatformId && !existing.default_sender_platform_id
    if (needsReactivate || needsSenderStamp) {
      await messagingService.updateMessagingConversations({
        id: existing.id,
        ...(needsReactivate ? { status: "active" } : {}),
        ...(needsSenderStamp ? { default_sender_platform_id: senderPlatformId } : {}),
      })
    }
  } else {
    const conv = await messagingService.createMessagingConversations({
      partner_id: partnerId,
      phone_number: message.from,
      title: senderName,
      status: "active",
      ...(senderPlatformId ? { default_sender_platform_id: senderPlatformId } : {}),
    })
    conversationId = conv.id
    isNew = true
  }

  // Determine message type
  let messageType = "text"
  if (message.type === "interactive") messageType = "interactive"
  else if (["image", "video", "document", "audio"].includes(message.type)) messageType = "media"

  // For media messages, use caption if available — don't show "[image]" noise
  const content = message.text
    || message.buttonReplyTitle
    || (messageType === "media" ? "" : `[${message.type}]`)

  // Resolve reply-to if this message is a reply to another
  let replyToId: string | null = null
  let replyToSnapshot: Record<string, any> | null = null

  if (message.replyToWaMessageId) {
    try {
      const [replyMsg] = await messagingService.listMessagingMessages(
        { wa_message_id: message.replyToWaMessageId },
        { take: 1 }
      )
      if (replyMsg) {
        replyToId = replyMsg.id
        replyToSnapshot = {
          content: replyMsg.content?.substring(0, 200) || "",
          sender_name: replyMsg.sender_name,
          direction: replyMsg.direction,
          media_url: replyMsg.media_url,
          media_mime_type: replyMsg.media_mime_type,
        }
      }
    } catch { /* non-fatal */ }
  }

  await messagingService.createMessagingMessages({
    conversation_id: conversationId,
    direction: "inbound",
    sender_name: senderName,
    content,
    message_type: messageType as any,
    wa_message_id: message.messageId,
    status: "delivered",
    media_url: message.mediaUrl || null,
    media_mime_type: message.mediaMimeType || null,
    reply_to_id: replyToId,
    reply_to_snapshot: replyToSnapshot,
  })

  // Update conversation timestamp and bump unread count
  await messagingService.updateMessagingConversations({
    id: conversationId,
    last_message_at: new Date(),
    unread_count: (existing?.unread_count || 0) + 1,
  })

  return { id: conversationId, metadata, isNew }
}

/**
 * Persist an outbound WhatsApp message (bot reply) to the messaging module.
 */
async function persistOutboundMessage(
  scope: any,
  conversationId: string,
  content: string,
  waMessageId?: string
): Promise<void> {
  const messagingService = scope.resolve(MESSAGING_MODULE) as any

  await messagingService.createMessagingMessages({
    conversation_id: conversationId,
    direction: "outbound",
    sender_name: "JYT Bot",
    content,
    message_type: "text",
    wa_message_id: waMessageId || null,
    status: "sent",
  })

  await messagingService.updateMessagingConversations({
    id: conversationId,
    last_message_at: new Date(),
  })
}


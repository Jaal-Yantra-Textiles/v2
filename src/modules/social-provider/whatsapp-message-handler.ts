import { MedusaError } from "@medusajs/utils"
import { PRODUCTION_RUNS_MODULE } from "../production_runs"
import type ProductionRunService from "../production_runs/service"
import { PARTNER_MODULE } from "../partner"
import { acceptProductionRunWorkflow } from "../../workflows/production-runs/accept-production-run"
import { signalLifecycleStepSuccessWorkflow } from "../../workflows/production-runs/production-run-steps"
import {
  awaitRunStartStepId,
  awaitRunFinishStepId,
  awaitRunCompleteStepId,
} from "../../workflows/production-runs/run-production-run-lifecycle"
import WhatsAppService from "./whatsapp-service"
import { SOCIAL_PROVIDER_MODULE } from "./index"
import type SocialProviderService from "./service"

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
async function resolvePartnerByPhone(
  scope: any,
  phone: string
): Promise<{ partnerId: string; adminName: string } | null> {
  try {
    // Normalize: strip non-digits
    const normalized = phone.replace(/[^0-9]/g, "")

    const { ContainerRegistrationKeys } = await import("@medusajs/framework/utils")
    const query = scope.resolve(ContainerRegistrationKeys.QUERY) as any
    const { data: partners } = await query.graph({
      entity: "partners",
      fields: ["id", "name", "whatsapp_number", "whatsapp_verified", "admins.*"],
      pagination: { skip: 0, take: 200 },
    })

    // Priority 1: Match against partner.whatsapp_number (dedicated notification number)
    for (const partner of partners || []) {
      if (!partner.whatsapp_number || !partner.whatsapp_verified) continue
      const waNormalized = partner.whatsapp_number.replace(/[^0-9]/g, "")
      if (phoneMatches(waNormalized, normalized)) {
        const firstAdmin = partner.admins?.[0]
        return {
          partnerId: partner.id,
          adminName: firstAdmin
            ? [firstAdmin.first_name, firstAdmin.last_name].filter(Boolean).join(" ") || partner.name
            : partner.name || "Partner",
        }
      }
    }

    // Priority 2: Fall back to matching admin phone numbers
    for (const partner of partners || []) {
      for (const admin of partner.admins || []) {
        if (!admin.phone) continue
        const adminNormalized = admin.phone.replace(/[^0-9]/g, "")
        if (phoneMatches(adminNormalized, normalized)) {
          return {
            partnerId: partner.id,
            adminName: [admin.first_name, admin.last_name].filter(Boolean).join(" ") || "Partner",
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
 */
export async function handleIncomingMessage(
  scope: any,
  message: IncomingMessage
): Promise<HandlerResult> {
  const whatsapp = (scope.resolve(SOCIAL_PROVIDER_MODULE) as SocialProviderService).getWhatsApp()

  // Mark message as read
  await whatsapp.markAsRead(message.messageId)

  // Resolve partner
  const partner = await resolvePartnerByPhone(scope, message.from)
  if (!partner) {
    await whatsapp.sendTextMessage(
      message.from,
      "Sorry, your phone number is not registered with any partner account. Please contact the admin."
    ).catch((e: any) => {
      // May fail if the number isn't in Meta's allowed test recipients — that's fine
      console.warn("[whatsapp-handler] Could not notify unregistered phone:", e.message)
    })
    return { handled: true, error: "unregistered_phone" }
  }

  // Determine action from button reply or text
  let action = ""
  let runId = ""

  if (message.type === "interactive" && message.buttonReplyId) {
    // Button replies: "accept_prod_run_123", "start_prod_run_123", etc.
    const parts = message.buttonReplyId.split("_")
    action = parts[0] // accept, start, finish, complete, view, media, status
    runId = parts.slice(1).join("_") // rejoin in case run ID has underscores
  } else if (message.type === "text" && message.text) {
    const parsed = parseTextCommand(message.text.trim())
    action = parsed.action
    runId = parsed.runId
  } else if (message.type === "image" || message.type === "video" || message.type === "document") {
    // Media without context — ask which run
    await whatsapp.sendTextMessage(
      message.from,
      `📸 Media received! To attach it to a production run, please reply:\n\`media <run_id>\`\n\nThen send the media again.`
    )
    return { handled: true, action: "media_hint" }
  }

  if (!action) {
    // Show help / list runs
    await sendHelpMessage(scope, whatsapp, message.from, partner.partnerId, partner.adminName)
    return { handled: true, action: "help" }
  }

  // Execute action
  try {
    switch (action) {
      case "accept":
        return await handleAccept(scope, whatsapp, message.from, runId, partner.partnerId)
      case "start":
        return await handleStart(scope, whatsapp, message.from, runId, partner.partnerId)
      case "finish":
        return await handleFinish(scope, whatsapp, message.from, runId, partner.partnerId)
      case "complete":
        return await handleComplete(scope, whatsapp, message.from, runId, partner.partnerId, message.text)
      case "view":
      case "status":
        return await handleViewStatus(scope, whatsapp, message.from, runId, partner.partnerId)
      case "runs":
      case "list":
        return await handleListRuns(scope, whatsapp, message.from, partner.partnerId)
      case "help":
        await sendHelpMessage(scope, whatsapp, message.from, partner.partnerId, partner.adminName)
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
function parseTextCommand(text: string): { action: string; runId: string; extra?: string } {
  const trimmed = text.trim()
  const lower = trimmed.toLowerCase()

  // Check for simple keywords
  if (lower === "help" || lower === "hi" || lower === "hello" || lower === "menu") {
    return { action: "help", runId: "" }
  }
  if (lower === "runs" || lower === "list" || lower === "my runs") {
    return { action: "runs", runId: "" }
  }

  // Pattern: <action> <run_id> [extra] — match against original to preserve run ID case
  const match = trimmed.match(/^(accept|start|finish|complete|status|view|media)\s+(prod_run_\S+)(.*)$/i)
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
  const transactionId = run.metadata?.lifecycle_transaction_id
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
  partnerId: string
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

  await productionRunService.updateProductionRuns({ id: runId, finished_at: new Date() })

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
  const transactionId = run.metadata?.lifecycle_transaction_id
  if (transactionId) {
    await signalLifecycleStepSuccessWorkflow(scope)
      .run({ input: { transaction_id: transactionId, step_id: awaitRunFinishStepId } })
      .catch(() => {})
  }

  await emitEvent(scope, "production_run.finished", { id: runId, production_run_id: runId, partner_id: partnerId, action: "finished" })

  const designName = await getDesignName(scope, runId)
  await whatsapp.sendRunActions(phone, runId, "finished", designName)

  return { handled: true, action: "finish", runId }
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
  const transactionId = run.metadata?.lifecycle_transaction_id
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

async function sendHelpMessage(
  scope: any,
  whatsapp: WhatsAppService,
  phone: string,
  partnerId: string,
  adminName: string
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

  await whatsapp.sendTextMessage(
    phone,
    `👋 Hi ${adminName}!\n\n` +
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

// Helpers

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

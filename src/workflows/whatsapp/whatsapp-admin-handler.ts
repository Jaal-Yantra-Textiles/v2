import { Modules } from "@medusajs/framework/utils"
import WhatsAppService from "../../modules/social-provider/whatsapp-service"
import { SOCIAL_PROVIDER_MODULE } from "../../modules/social-provider"
import type SocialProviderService from "../../modules/social-provider/service"
import { PRODUCTION_RUNS_MODULE } from "../../modules/production_runs"
import { createPartnerAdminWithRegistrationWorkflow } from "../partner/create-partner-admin"
import { approveProductionRunWorkflow } from "../production-runs/approve-production-run"
import { sendProductionRunToProductionWorkflow } from "../production-runs/send-production-run-to-production"
import { reviewPaymentSubmissionWorkflow } from "../payment_submissions/review-payment-submission"

interface IncomingMessage {
  from: string
  messageId: string
  type: "text" | "interactive" | "image" | "document" | "video" | "audio"
  text?: string
  buttonReplyId?: string
  buttonReplyTitle?: string
}

interface AdminHandlerResult {
  handled: boolean
  action?: string
  error?: string
}

interface ResolvedAdmin {
  userId: string
  name: string
  email: string
}

/**
 * Try to resolve an admin user by matching phone number against user metadata.whatsapp_number.
 */
export async function resolveAdminByPhone(
  scope: any,
  phone: string
): Promise<ResolvedAdmin | null> {
  try {
    const normalized = phone.replace(/[^0-9]/g, "")
    const userService = scope.resolve(Modules.USER) as any

    // List users and check metadata for whatsapp_number
    const [users] = await userService.listAndCountUsers({}, { take: 200 })

    for (const user of users || []) {
      const waNumber = user.metadata?.whatsapp_number as string | undefined
      if (!waNumber) continue
      const waNormalized = waNumber.replace(/[^0-9]/g, "")
      if (phoneMatches(waNormalized, normalized)) {
        return {
          userId: user.id,
          name: [user.first_name, user.last_name].filter(Boolean).join(" ") || "Admin",
          email: user.email,
        }
      }
    }

    return null
  } catch (e: any) {
    console.error("[whatsapp-admin-handler] Failed to resolve admin:", e.message)
    return null
  }
}

/**
 * Handle an incoming WhatsApp message from an admin user.
 */
export async function handleAdminMessage(
  scope: any,
  message: IncomingMessage,
  admin: ResolvedAdmin
): Promise<AdminHandlerResult> {
  const whatsapp = (scope.resolve(SOCIAL_PROVIDER_MODULE) as SocialProviderService).getWhatsApp(scope)

  await whatsapp.markAsRead(message.messageId)

  // Parse command
  let action = ""
  let args: string[] = []

  if (message.type === "interactive" && message.buttonReplyId) {
    const parts = message.buttonReplyId.split(":")
    action = parts[0]
    args = parts.slice(1)
  } else if (message.type === "text" && message.text) {
    const parsed = parseAdminCommand(message.text.trim())
    action = parsed.action
    args = parsed.args
  }

  if (!action) {
    await sendAdminHelp(whatsapp, message.from, admin.name)
    return { handled: true, action: "help" }
  }

  try {
    switch (action) {
      case "help":
        await sendAdminHelp(whatsapp, message.from, admin.name)
        return { handled: true, action: "help" }

      case "partners":
        return await handleListPartners(scope, whatsapp, message.from)

      case "partner":
        return await handleViewPartner(scope, whatsapp, message.from, args[0])

      case "create_partner":
        return await handleCreatePartner(scope, whatsapp, message.from, args)

      case "runs":
        return await handleListRuns(scope, whatsapp, message.from)

      case "run":
        return await handleViewRun(scope, whatsapp, message.from, args[0])

      case "approve_run":
        return await handleApproveRun(scope, whatsapp, message.from, args[0])

      case "cancel_run":
        return await handleCancelRun(scope, whatsapp, message.from, args[0])

      case "send_run":
        return await handleSendRun(scope, whatsapp, message.from, args[0])

      case "payments":
        return await handleListPayments(scope, whatsapp, message.from)

      case "approve_payment":
        return await handleReviewPayment(scope, whatsapp, message.from, args[0], "approve", admin)

      case "reject_payment":
        return await handleReviewPayment(scope, whatsapp, message.from, args[0], "reject", admin, args.slice(1).join(" "))

      case "tasks":
        return await handleListTasks(scope, whatsapp, message.from)

      case "designs":
        return await handleListDesigns(scope, whatsapp, message.from)

      case "design":
        return await handleViewDesign(scope, whatsapp, message.from, args[0])

      default:
        await whatsapp.sendTextMessage(
          message.from,
          `Unknown command: "${action}". Reply *help* for available commands.`
        )
        return { handled: true, action: "unknown", error: action }
    }
  } catch (e: any) {
    console.error(`[whatsapp-admin-handler] Action ${action} failed:`, e.message)
    await whatsapp.sendTextMessage(
      message.from,
      `Action failed: ${e.message}`
    )
    return { handled: true, action, error: e.message }
  }
}

// ─── Command Parser ────────────────────────────────────────────────────────

function parseAdminCommand(text: string): { action: string; args: string[] } {
  const trimmed = text.trim()
  const lower = trimmed.toLowerCase()

  if (lower === "help" || lower === "menu" || lower === "hi" || lower === "hello") {
    return { action: "help", args: [] }
  }
  if (lower === "partners" || lower === "list partners") {
    return { action: "partners", args: [] }
  }
  if (lower === "runs" || lower === "list runs" || lower === "production runs") {
    return { action: "runs", args: [] }
  }
  if (lower === "payments" || lower === "pending payments") {
    return { action: "payments", args: [] }
  }
  if (lower === "tasks" || lower === "list tasks" || lower === "open tasks") {
    return { action: "tasks", args: [] }
  }
  if (lower === "designs" || lower === "list designs") {
    return { action: "designs", args: [] }
  }

  // partner <id or name>
  const partnerMatch = trimmed.match(/^partner\s+(.+)$/i)
  if (partnerMatch) {
    return { action: "partner", args: [partnerMatch[1].trim()] }
  }

  // create partner <name> <email> <phone>
  const createPartnerMatch = trimmed.match(/^create\s+partner\s+(.+)$/i)
  if (createPartnerMatch) {
    return { action: "create_partner", args: createPartnerMatch[1].trim().split(/\s+/) }
  }

  // run <id>
  const runMatch = trimmed.match(/^run\s+(prod_run_\S+)$/i)
  if (runMatch) {
    return { action: "run", args: [runMatch[1]] }
  }

  // approve run <id>
  const approveRunMatch = trimmed.match(/^approve\s+run\s+(prod_run_\S+)$/i)
  if (approveRunMatch) {
    return { action: "approve_run", args: [approveRunMatch[1]] }
  }

  // cancel run <id>
  const cancelRunMatch = trimmed.match(/^cancel\s+run\s+(prod_run_\S+)$/i)
  if (cancelRunMatch) {
    return { action: "cancel_run", args: [cancelRunMatch[1]] }
  }

  // send run <id>
  const sendRunMatch = trimmed.match(/^send\s+run\s+(prod_run_\S+)$/i)
  if (sendRunMatch) {
    return { action: "send_run", args: [sendRunMatch[1]] }
  }

  // design <id or name>
  const designMatch = trimmed.match(/^design\s+(.+)$/i)
  if (designMatch) {
    return { action: "design", args: [designMatch[1].trim()] }
  }

  // approve payment <id>
  const approvePaymentMatch = trimmed.match(/^approve\s+payment\s+(\S+)$/i)
  if (approvePaymentMatch) {
    return { action: "approve_payment", args: [approvePaymentMatch[1]] }
  }

  // reject payment <id> <reason...>
  const rejectPaymentMatch = trimmed.match(/^reject\s+payment\s+(\S+)\s*(.*)?$/i)
  if (rejectPaymentMatch) {
    const args = [rejectPaymentMatch[1]]
    if (rejectPaymentMatch[2]) args.push(rejectPaymentMatch[2].trim())
    return { action: "reject_payment", args }
  }

  // Just a run ID
  const bareRunMatch = trimmed.match(/^(prod_run_\S+)$/i)
  if (bareRunMatch) {
    return { action: "run", args: [bareRunMatch[1]] }
  }

  return { action: "", args: [] }
}

// ─── Command Handlers ──────────────────────────────────────────────────────

async function handleListPartners(
  scope: any,
  whatsapp: WhatsAppService,
  phone: string
): Promise<AdminHandlerResult> {
  const query = scope.resolve("query") as any
  const { data: partners } = await query.graph({
    entity: "partners",
    fields: ["id", "name", "handle", "status", "whatsapp_verified"],
    pagination: { skip: 0, take: 15 },
  })

  if (!partners?.length) {
    await whatsapp.sendTextMessage(phone, "No partners found.")
    return { handled: true, action: "partners" }
  }

  const statusIcon: Record<string, string> = {
    active: "green",
    inactive: "red",
    pending: "yellow",
  }

  const lines = [`*Partners (${partners.length})*\n`]
  for (const p of partners) {
    const dot = statusIcon[p.status] === "green" ? "+" : statusIcon[p.status] === "red" ? "-" : "~"
    const wa = p.whatsapp_verified ? " [WA]" : ""
    lines.push(`${dot} *${p.name}* (${p.status})${wa}\n   ID: \`${p.id}\``)
  }
  lines.push(`\n_Reply \`partner <id>\` for details_`)

  await whatsapp.sendTextMessage(phone, lines.join("\n"))
  return { handled: true, action: "partners" }
}

async function handleViewPartner(
  scope: any,
  whatsapp: WhatsAppService,
  phone: string,
  idOrName: string
): Promise<AdminHandlerResult> {
  if (!idOrName) {
    await whatsapp.sendTextMessage(phone, "Usage: `partner <id or name>`")
    return { handled: true, action: "partner", error: "missing_id" }
  }

  const query = scope.resolve("query") as any

  // Try by ID first, then search by name
  let partner: any = null
  try {
    const { data } = await query.graph({
      entity: "partners",
      fields: ["id", "name", "handle", "status", "is_verified", "whatsapp_number", "whatsapp_verified", "admins.*"],
      filters: { id: idOrName },
    })
    partner = data?.[0]
  } catch { /* not a valid ID */ }

  if (!partner) {
    const { data } = await query.graph({
      entity: "partners",
      fields: ["id", "name", "handle", "status", "is_verified", "whatsapp_number", "whatsapp_verified", "admins.*"],
      pagination: { skip: 0, take: 5 },
    })
    partner = (data || []).find((p: any) =>
      p.name?.toLowerCase().includes(idOrName.toLowerCase()) ||
      p.handle?.toLowerCase().includes(idOrName.toLowerCase())
    )
  }

  if (!partner) {
    await whatsapp.sendTextMessage(phone, `Partner "${idOrName}" not found.`)
    return { handled: true, action: "partner", error: "not_found" }
  }

  // Get active runs count
  const { data: runs } = await query.graph({
    entity: "production_runs",
    fields: ["id"],
    filters: { partner_id: partner.id, status: { $in: ["sent_to_partner", "in_progress"] } },
    pagination: { skip: 0, take: 100 },
  })

  const admins = (partner.admins || [])
    .filter((a: any) => a.is_active)
    .map((a: any) => `${a.first_name || ""} ${a.last_name || ""}`.trim() + (a.phone ? ` (${a.phone})` : ""))
    .join(", ") || "None"

  const lines = [
    `*${partner.name}*`,
    `Handle: @${partner.handle}`,
    `Status: ${partner.status}${partner.is_verified ? " (Verified)" : ""}`,
    `WhatsApp: ${partner.whatsapp_verified ? partner.whatsapp_number : "Not connected"}`,
    `Admins: ${admins}`,
    `Active Runs: ${runs?.length || 0}`,
    `ID: \`${partner.id}\``,
  ]

  await whatsapp.sendTextMessage(phone, lines.join("\n"))
  return { handled: true, action: "partner" }
}

async function handleCreatePartner(
  scope: any,
  whatsapp: WhatsAppService,
  phone: string,
  args: string[]
): Promise<AdminHandlerResult> {
  // Expected: create partner <name> <email> <phone>
  // Name can have spaces if quoted, but for WhatsApp simplicity: first arg = name, second = email, third = phone
  if (args.length < 2) {
    await whatsapp.sendTextMessage(
      phone,
      `Usage: \`create partner <name> <email> [phone]\`\n\nExample: \`create partner "Textile Co" john@example.com +91987654321\``
    )
    return { handled: true, action: "create_partner", error: "missing_args" }
  }

  // Parse name (might be quoted), email, phone
  const fullText = args.join(" ")
  let name: string, email: string, adminPhone: string | undefined

  const quotedMatch = fullText.match(/^["'](.+?)["']\s+(\S+)\s*(\S*)$/)
  if (quotedMatch) {
    name = quotedMatch[1]
    email = quotedMatch[2]
    adminPhone = quotedMatch[3] || undefined
  } else {
    // No quotes — last arg with @ is email, arg before that with + is phone or name
    const emailIdx = args.findIndex(a => a.includes("@"))
    if (emailIdx === -1) {
      await whatsapp.sendTextMessage(phone, `Could not find email address in command. Usage: \`create partner <name> <email> [phone]\``)
      return { handled: true, action: "create_partner", error: "no_email" }
    }
    email = args[emailIdx]
    const nameParts = args.slice(0, emailIdx)
    name = nameParts.join(" ") || "New Partner"
    adminPhone = args[emailIdx + 1] || undefined
  }

  const handle = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")

  try {
    const { result } = await createPartnerAdminWithRegistrationWorkflow(scope).run({
      input: {
        partner: { name, handle },
        admin: {
          first_name: name.split(" ")[0],
          last_name: name.split(" ").slice(1).join(" ") || "",
          email,
          phone: adminPhone,
        },
      },
    })

    const partnerId = (result as any)?.partnerWithAdmin?.createdPartner?.id || "unknown"

    await whatsapp.sendTextMessage(
      phone,
      `Partner created!\n\n*${name}*\nEmail: ${email}${adminPhone ? `\nPhone: ${adminPhone}` : ""}\nID: \`${partnerId}\``
    )
    return { handled: true, action: "create_partner" }
  } catch (e: any) {
    throw new Error(`Failed to create partner: ${e.message}`)
  }
}

async function handleListRuns(
  scope: any,
  whatsapp: WhatsAppService,
  phone: string
): Promise<AdminHandlerResult> {
  const query = scope.resolve("query") as any
  const { data: runs } = await query.graph({
    entity: "production_runs",
    fields: ["id", "status", "run_type", "design_id", "partner_id", "quantity", "created_at"],
    filters: { status: { $in: ["pending_approval", "approved", "sent_to_partner", "in_progress"] } },
    pagination: { skip: 0, take: 15 },
  })

  if (!runs?.length) {
    await whatsapp.sendTextMessage(phone, "No active production runs.")
    return { handled: true, action: "runs" }
  }

  const statusEmoji: Record<string, string> = {
    pending_approval: "Pending",
    approved: "Approved",
    sent_to_partner: "Sent",
    in_progress: "In Progress",
  }

  const lines = [`*Active Production Runs (${runs.length})*\n`]

  for (const run of runs.slice(0, 10)) {
    const designName = await getDesignName(scope, run.design_id)
    const partnerName = await getPartnerName(scope, run.partner_id)
    lines.push(
      `*${run.id}*\n` +
      `   ${statusEmoji[run.status] || run.status} | ${designName}\n` +
      `   Partner: ${partnerName}${run.quantity ? ` | Qty: ${run.quantity}` : ""}`
    )
  }

  if (runs.length > 10) {
    lines.push(`\n_...and ${runs.length - 10} more_`)
  }
  lines.push(`\n_Reply \`run <id>\` for details_`)

  await whatsapp.sendTextMessage(phone, lines.join("\n"))
  return { handled: true, action: "runs" }
}

async function handleViewRun(
  scope: any,
  whatsapp: WhatsAppService,
  phone: string,
  runId: string
): Promise<AdminHandlerResult> {
  if (!runId) {
    await whatsapp.sendTextMessage(phone, "Usage: `run <run_id>`")
    return { handled: true, action: "run", error: "missing_id" }
  }

  const productionRunService = scope.resolve(PRODUCTION_RUNS_MODULE) as any
  const run = await productionRunService.retrieveProductionRun(runId).catch(() => null) as any

  if (!run) {
    await whatsapp.sendTextMessage(phone, `Production run \`${runId}\` not found.`)
    return { handled: true, action: "run", error: "not_found" }
  }

  const designName = await getDesignName(scope, run.design_id)
  const partnerName = await getPartnerName(scope, run.partner_id)

  const lines = [
    `*Production Run: ${run.id}*`,
    `Status: ${run.status}`,
    `Design: ${designName}`,
    `Partner: ${partnerName}`,
    `Type: ${run.run_type || "production"}`,
  ]
  if (run.quantity) lines.push(`Quantity: ${run.quantity}`)
  if (run.produced_quantity != null) lines.push(`Produced: ${run.produced_quantity}`)
  if (run.rejected_quantity) lines.push(`Rejected: ${run.rejected_quantity}`)
  if (run.started_at) lines.push(`Started: ${formatDate(run.started_at)}`)
  if (run.finished_at) lines.push(`Finished: ${formatDate(run.finished_at)}`)
  if (run.completed_at) lines.push(`Completed: ${formatDate(run.completed_at)}`)

  // Show action buttons based on status
  const buttons: Array<{ type: "reply"; reply: { id: string; title: string } }> = []
  if (run.status === "pending_approval") {
    buttons.push({ type: "reply", reply: { id: `approve_run:${runId}`, title: "Approve" } })
    buttons.push({ type: "reply", reply: { id: `cancel_run:${runId}`, title: "Cancel" } })
  }
  if (run.status === "approved") {
    buttons.push({ type: "reply", reply: { id: `send_run:${runId}`, title: "Send to Partner" } })
    buttons.push({ type: "reply", reply: { id: `cancel_run:${runId}`, title: "Cancel" } })
  }
  if (run.status === "sent_to_partner" || run.status === "in_progress") {
    buttons.push({ type: "reply", reply: { id: `cancel_run:${runId}`, title: "Cancel" } })
  }

  if (buttons.length > 0) {
    await whatsapp.sendInteractiveMessage(phone, {
      type: "button",
      body: { text: lines.join("\n") },
      action: { buttons },
    })
  } else {
    await whatsapp.sendTextMessage(phone, lines.join("\n"))
  }

  return { handled: true, action: "run" }
}

async function handleApproveRun(
  scope: any,
  whatsapp: WhatsAppService,
  phone: string,
  runId: string
): Promise<AdminHandlerResult> {
  if (!runId) {
    await whatsapp.sendTextMessage(phone, "Usage: `approve run <run_id>`")
    return { handled: true, action: "approve_run", error: "missing_id" }
  }

  await approveProductionRunWorkflow(scope).run({
    input: { production_run_id: runId },
  })

  const designName = await getDesignName(scope, runId)

  await whatsapp.sendInteractiveMessage(phone, {
    type: "button",
    body: { text: `Run *${runId}* approved.\nDesign: ${designName}\n\nSend to partner now?` },
    action: {
      buttons: [
        { type: "reply", reply: { id: `send_run:${runId}`, title: "Send to Partner" } },
      ],
    },
  })

  return { handled: true, action: "approve_run" }
}

async function handleCancelRun(
  scope: any,
  whatsapp: WhatsAppService,
  phone: string,
  runId: string
): Promise<AdminHandlerResult> {
  if (!runId) {
    await whatsapp.sendTextMessage(phone, "Usage: `cancel run <run_id>`")
    return { handled: true, action: "cancel_run", error: "missing_id" }
  }

  const productionRunService = scope.resolve(PRODUCTION_RUNS_MODULE) as any
  const run = await productionRunService.retrieveProductionRun(runId).catch(() => null) as any

  if (!run) {
    await whatsapp.sendTextMessage(phone, `Production run \`${runId}\` not found.`)
    return { handled: true, action: "cancel_run", error: "not_found" }
  }

  if (run.status === "cancelled") {
    await whatsapp.sendTextMessage(phone, `Run *${runId}* is already cancelled.`)
    return { handled: true, action: "cancel_run" }
  }

  if (run.status === "completed") {
    await whatsapp.sendTextMessage(phone, `Cannot cancel a completed run.`)
    return { handled: true, action: "cancel_run", error: "completed" }
  }

  await productionRunService.updateProductionRuns({
    id: runId,
    status: "cancelled",
    cancelled_at: new Date(),
    cancelled_reason: "Admin cancelled via WhatsApp",
  })

  // Emit event for notification
  try {
    const eventService = scope.resolve(Modules.EVENT_BUS) as any
    await eventService.emit([{
      name: "production_run.cancelled",
      data: { id: runId, production_run_id: runId, action: "cancelled", notes: "Admin cancelled via WhatsApp" },
    }])
  } catch { /* non-fatal */ }

  await whatsapp.sendTextMessage(phone, `Run *${runId}* has been cancelled.`)
  return { handled: true, action: "cancel_run" }
}

async function handleSendRun(
  scope: any,
  whatsapp: WhatsAppService,
  phone: string,
  runId: string
): Promise<AdminHandlerResult> {
  if (!runId) {
    await whatsapp.sendTextMessage(phone, "Usage: `send run <run_id>`")
    return { handled: true, action: "send_run", error: "missing_id" }
  }

  // Retrieve run to get template_names from metadata
  const productionRunService = scope.resolve(PRODUCTION_RUNS_MODULE) as any
  const run = await productionRunService.retrieveProductionRun(runId).catch(() => null) as any
  if (!run) {
    await whatsapp.sendTextMessage(phone, `Production run \`${runId}\` not found.`)
    return { handled: true, action: "send_run", error: "not_found" }
  }

  const templateNames = ((run as any).dispatch_template_names as string[]) || []

  await sendProductionRunToProductionWorkflow(scope).run({
    input: { production_run_id: runId, template_names: templateNames },
  })

  const designName = await getDesignName(scope, run.design_id)
  await whatsapp.sendTextMessage(
    phone,
    `Run *${runId}* sent to partner.\nDesign: ${designName}\n\nThe partner will receive a WhatsApp notification.`
  )
  return { handled: true, action: "send_run" }
}

async function handleListPayments(
  scope: any,
  whatsapp: WhatsAppService,
  phone: string
): Promise<AdminHandlerResult> {
  const query = scope.resolve("query") as any

  let submissions: any[] = []
  try {
    const { data } = await query.graph({
      entity: "payment_submissions",
      fields: ["id", "status", "amount", "partner_id", "created_at"],
      filters: { status: "pending" },
      pagination: { skip: 0, take: 15 },
    })
    submissions = data || []
  } catch {
    // Module might not exist or no data
    await whatsapp.sendTextMessage(phone, "No pending payment submissions.")
    return { handled: true, action: "payments" }
  }

  if (!submissions.length) {
    await whatsapp.sendTextMessage(phone, "No pending payment submissions.")
    return { handled: true, action: "payments" }
  }

  const lines = [`*Pending Payment Submissions (${submissions.length})*\n`]

  for (const sub of submissions.slice(0, 10)) {
    const partnerName = await getPartnerName(scope, sub.partner_id)
    lines.push(
      `*${sub.id}*\n` +
      `   ${partnerName} | Amount: ${sub.amount || "N/A"}\n` +
      `   Submitted: ${formatDate(sub.created_at)}`
    )
  }

  lines.push(`\n_Reply \`approve payment <id>\` or \`reject payment <id> <reason>\`_`)

  await whatsapp.sendTextMessage(phone, lines.join("\n"))
  return { handled: true, action: "payments" }
}

async function handleReviewPayment(
  scope: any,
  whatsapp: WhatsAppService,
  phone: string,
  submissionId: string,
  decision: "approve" | "reject",
  admin: ResolvedAdmin,
  reason?: string
): Promise<AdminHandlerResult> {
  if (!submissionId) {
    await whatsapp.sendTextMessage(phone, `Usage: \`${decision} payment <submission_id>${decision === "reject" ? " <reason>" : ""}\``)
    return { handled: true, action: `${decision}_payment`, error: "missing_id" }
  }

  await reviewPaymentSubmissionWorkflow(scope).run({
    input: {
      submission_id: submissionId,
      action: decision === "approve" ? "approve" : "reject",
      reviewed_by: admin.userId,
      ...(reason ? { rejection_reason: reason } : {}),
    },
  })

  const emoji = decision === "approve" ? "Approved" : "Rejected"
  await whatsapp.sendTextMessage(
    phone,
    `Payment *${submissionId}* ${emoji.toLowerCase()}.${reason ? `\nReason: ${reason}` : ""}`
  )
  return { handled: true, action: `${decision}_payment` }
}

async function handleListTasks(
  scope: any,
  whatsapp: WhatsAppService,
  phone: string
): Promise<AdminHandlerResult> {
  const query = scope.resolve("query") as any

  let tasks: any[] = []
  try {
    const { data } = await query.graph({
      entity: "tasks",
      fields: ["id", "title", "status", "priority", "due_date", "assignee_id"],
      filters: { status: { $in: ["open", "in_progress"] } },
      pagination: { skip: 0, take: 15 },
    })
    tasks = data || []
  } catch {
    await whatsapp.sendTextMessage(phone, "No open tasks found.")
    return { handled: true, action: "tasks" }
  }

  if (!tasks.length) {
    await whatsapp.sendTextMessage(phone, "No open tasks.")
    return { handled: true, action: "tasks" }
  }

  const lines = [`*Open Tasks (${tasks.length})*\n`]

  for (const task of tasks.slice(0, 10)) {
    const overdue = task.due_date && new Date(task.due_date) < new Date() ? " *OVERDUE*" : ""
    const priority = task.priority ? ` [${task.priority}]` : ""
    lines.push(
      `*${task.title || task.id}*${priority}${overdue}\n` +
      `   Status: ${task.status}${task.due_date ? ` | Due: ${formatDate(task.due_date)}` : ""}\n` +
      `   ID: \`${task.id}\``
    )
  }

  await whatsapp.sendTextMessage(phone, lines.join("\n"))
  return { handled: true, action: "tasks" }
}

async function handleListDesigns(
  scope: any,
  whatsapp: WhatsAppService,
  phone: string
): Promise<AdminHandlerResult> {
  const query = scope.resolve("query") as any
  const { data: designs } = await query.graph({
    entity: "designs",
    fields: ["id", "name", "title", "status", "design_type", "priority", "partner_id"],
    pagination: { skip: 0, take: 15 },
  })

  if (!designs?.length) {
    await whatsapp.sendTextMessage(phone, "No designs found.")
    return { handled: true, action: "designs" }
  }

  const lines = [`*Recent Designs (${designs.length})*\n`]

  for (const d of designs.slice(0, 10)) {
    const displayName = d.name || d.title || d.id
    const priority = d.priority ? ` [${d.priority}]` : ""
    lines.push(
      `*${displayName}*${priority}\n` +
      `   ${d.status} | ${d.design_type || "Design"}\n` +
      `   ID: \`${d.id}\``
    )
  }

  lines.push(`\n_Reply \`design <id>\` for details_`)

  await whatsapp.sendTextMessage(phone, lines.join("\n"))
  return { handled: true, action: "designs" }
}

async function handleViewDesign(
  scope: any,
  whatsapp: WhatsAppService,
  phone: string,
  idOrName: string
): Promise<AdminHandlerResult> {
  if (!idOrName) {
    await whatsapp.sendTextMessage(phone, "Usage: `design <id or name>`")
    return { handled: true, action: "design", error: "missing_id" }
  }

  const designService = scope.resolve("design") as any
  let design: any = null

  try {
    design = await designService.retrieveDesign(idOrName)
  } catch { /* not a valid ID */ }

  if (!design) {
    // Search by name
    const query = scope.resolve("query") as any
    const { data } = await query.graph({
      entity: "designs",
      fields: ["id", "name", "title", "status", "design_type", "priority", "partner_id", "customer_id", "target_completion_date", "created_at"],
      pagination: { skip: 0, take: 10 },
    })
    design = (data || []).find((d: any) =>
      (d.name || d.title || "").toLowerCase().includes(idOrName.toLowerCase())
    )
  }

  if (!design) {
    await whatsapp.sendTextMessage(phone, `Design "${idOrName}" not found.`)
    return { handled: true, action: "design", error: "not_found" }
  }

  const partnerName = design.partner_id ? await getPartnerName(scope, design.partner_id) : "Unassigned"

  const lines = [
    `*${design.name || design.title || design.id}*`,
    `Status: ${design.status}`,
    `Type: ${design.design_type || "N/A"}`,
    `Priority: ${design.priority || "Normal"}`,
    `Partner: ${partnerName}`,
  ]
  if (design.target_completion_date) {
    lines.push(`Target: ${formatDate(design.target_completion_date)}`)
  }
  lines.push(`Created: ${formatDate(design.created_at)}`)
  lines.push(`ID: \`${design.id}\``)

  await whatsapp.sendTextMessage(phone, lines.join("\n"))
  return { handled: true, action: "design" }
}

// ─── Help Message ──────────────────────────────────────────────────────────

async function sendAdminHelp(
  whatsapp: WhatsAppService,
  phone: string,
  adminName: string
): Promise<void> {
  await whatsapp.sendTextMessage(
    phone,
    `Hi ${adminName}! *Admin Commands:*\n\n` +
    `*Partners*\n` +
    `  \`partners\` — List all partners\n` +
    `  \`partner <id/name>\` — View partner details\n` +
    `  \`create partner <name> <email> [phone]\` — Create partner\n\n` +
    `*Production Runs*\n` +
    `  \`runs\` — List active runs\n` +
    `  \`run <id>\` — View run details\n` +
    `  \`approve run <id>\` — Approve a run\n` +
    `  \`cancel run <id>\` — Cancel a run\n` +
    `  \`send run <id>\` — Send run to partner\n\n` +
    `*Payments*\n` +
    `  \`payments\` — List pending submissions\n` +
    `  \`approve payment <id>\` — Approve submission\n` +
    `  \`reject payment <id> <reason>\` — Reject submission\n\n` +
    `*Other*\n` +
    `  \`tasks\` — List open tasks\n` +
    `  \`designs\` — List recent designs\n` +
    `  \`design <id/name>\` — View design details\n` +
    `  \`help\` — Show this message`
  )
}

// ─── Helpers ───────────────────────────────────────────────────────────────

async function getDesignName(scope: any, designIdOrRunId: string): Promise<string> {
  try {
    // Try as design ID first
    const designService = scope.resolve("design") as any
    try {
      const design = await designService.retrieveDesign(designIdOrRunId)
      return design?.name || design?.title || designIdOrRunId
    } catch { /* might be a run ID */ }

    // Try as run ID → get design
    const productionRunService = scope.resolve(PRODUCTION_RUNS_MODULE) as any
    const run = await productionRunService.retrieveProductionRun(designIdOrRunId).catch(() => null) as any
    if (run?.design_id) {
      const design = await designService.retrieveDesign(run.design_id)
      return design?.name || design?.title || run.design_id
    }
  } catch { /* fall through */ }
  return "Unknown Design"
}

async function getPartnerName(scope: any, partnerId: string | null): Promise<string> {
  if (!partnerId) return "Unassigned"
  try {
    const query = scope.resolve("query") as any
    const { data } = await query.graph({
      entity: "partners",
      fields: ["name"],
      filters: { id: partnerId },
    })
    return data?.[0]?.name || partnerId
  } catch {
    return partnerId
  }
}

function phoneMatches(a: string, b: string): boolean {
  return a === b || a.endsWith(b) || b.endsWith(a)
}

function formatDate(date: string | Date): string {
  const d = new Date(date)
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
}

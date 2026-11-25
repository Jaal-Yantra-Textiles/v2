import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"

import designLineItemLink from "../../../../links/design-line-item-link"
import {
  DESIGN_ORDER_LAST_CALL_TEMPLATE,
  DESIGN_ORDER_REMINDER_TEMPLATE,
  FOLLOWUP_CLOSE_BUYER_MESSAGE,
  FOLLOWUP_CLOSE_REASON,
  nextFollowupState,
  planDesignOrderFollowup,
} from "../../../../lib/design-order-followup"
import {
  DESIGN_ORDER_CANCELLED_TEMPLATE,
  notifyBuyerOfWithdrawal,
} from "../../../../lib/notify-buyer-of-withdrawal"
import { PAYMENT_SCHEDULE_MODULE } from "../../../../modules/payment_schedule"
import { VISUAL_FLOWS_MODULE } from "../../../../modules/visual_flows"
import { sendNotificationEmailWorkflow } from "../../../../workflows/email/workflows/send-notification-email"
import { hasLinkedSaleOrder } from "../../designs/orders/linked-sale-order"
import { decideCancel } from "../../designs/orders/mutate-design-order"
import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

export const DESIGN_ORDER_FOLLOWUP_JOB_ID = "design-order-followup"
export const DESIGN_ORDER_FOLLOWUP_FLOW_NAME = "Design Orders — Daily Follow-up"
const BACKEND_URL = process.env.MEDUSA_BACKEND_URL || "https://v3.jaalyantra.com"
const CLOSED_BY = "system:design-order-followup"

/**
 * Unpaid design orders: day-3 reminder, day-6 last call, day-7 close.
 *
 * The plan is `planDesignOrderFollowup` (pure, unit-tested). This job adds the
 * two checks a cart row cannot answer: money already received (a paid or
 * waived deposit on the payment schedule) and a sale order already linked to
 * one of the cart's designs. Either one means the cart is left alone.
 *
 * Preview (dry run) lists what each open design order would get today and
 * sends nothing. Apply sends, stamps `metadata.design_order_followup`, and
 * closes the overdue ones exactly like an admin cancel (metadata.cancelled_at,
 * which checkout, the pay redirects and the PayU sweep all honour), emailing
 * `design-order-cancelled` with a note on how to start again.
 */
export const designOrderFollowupJob: MaintenanceJob = {
  id: DESIGN_ORDER_FOLLOWUP_JOB_ID,
  label: "Follow up unpaid design orders",
  description:
    "For each open, unpaid design order: on day 3 email a gentle reminder (design-order-reminder), on day 6 a last call (design-order-last-call), and on day 7 close it (soft cancel, designs kept) with the design-order-cancelled email explaining how to start again. The 7 days start from the last time the order was sent (a resend restarts them) and never before 25 Nov 2026. Never closes without a last call at least 20h earlier. Skips carts with a paid/waived deposit, a payment, a linked sale order, or no buyer email. Preview lists what each cart would get and sends nothing. Run daily by the visual flow \"" +
    DESIGN_ORDER_FOLLOWUP_FLOW_NAME +
    "\".",
  params: [
    {
      name: "cart_id",
      type: "string",
      required: false,
      description: "Only this design-order cart.",
    },
    {
      name: "as_of",
      type: "string",
      required: false,
      description: "PREVIEW ONLY: plan as if today were this date (e.g. 2026-11-28) to see what each cart would get then. Refused on apply.",
    },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const onlyCart = String((params as any)?.cart_id ?? "").trim() || null
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const cartService: any = container.resolve(Modules.CART)
    const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
    const schedules: any = container.resolve(PAYMENT_SCHEDULE_MODULE)

    // Design-order carts, found through the design↔line-item link (never a
    // hand-written table name: Medusa abbreviates long link tables).
    const { data: links } = await query.graph({
      entity: designLineItemLink.entryPoint,
      fields: ["design_id", "line_item_id"],
    })
    const lineIds = [...new Set((links ?? []).map((l: any) => l?.line_item_id).filter(Boolean))] as string[]
    const designsByLine: Record<string, string> = {}
    for (const l of links ?? []) if (l?.line_item_id && l?.design_id) designsByLine[l.line_item_id] = l.design_id
    const lines = lineIds.length
      ? await cartService.listLineItems({ id: lineIds }, { select: ["id", "cart_id"] })
      : []
    let cartIds = [...new Set((lines as any[]).map((l) => l.cart_id).filter(Boolean))] as string[]
    if (onlyCart) cartIds = cartIds.filter((id) => id === onlyCart)

    const { data: carts } = cartIds.length
      ? await query.graph({
          entity: "cart",
          filters: { id: cartIds, completed_at: null },
          fields: [
            "id",
            "email",
            "currency_code",
            "created_at",
            "completed_at",
            "metadata",
            "items.id",
            "items.title",
            "customer.email",
            "customer.first_name",
            "shipping_address.first_name",
          ],
        })
      : { data: [] }

    const asOf = String((params as any)?.as_of ?? "").trim()
    if (asOf && !dry_run) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "as_of is for previews only; it would send mail early.")
    }
    const now = asOf ? new Date(asOf).getTime() : Date.now()
    if (!Number.isFinite(now)) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, `as_of "${asOf}" is not a date`)
    }
    const nowIso = new Date(now).toISOString()
    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []
    const tally: Record<string, number> = {}
    const bump = (k: string) => (tally[k] = (tally[k] ?? 0) + 1)

    for (const cart of carts ?? []) {
      try {
        const md = (cart.metadata ?? {}) as Record<string, any>
        if (md.source !== "design-order") continue
        const email = String(cart.email || cart.customer?.email || "").trim() || null
        const schedule = await schedules.findByCartId(cart.id).catch(() => null)
        const moneyReceived =
          !!schedule &&
          (["paid", "waived"].includes(String(schedule.deposit_status)) || !!schedule.order_id)

        const plan = planDesignOrderFollowup(cart, { now, has_email: !!email, money_received: moneyReceived })
        if (plan.action === "skip") {
          bump(`skip: ${plan.reason}`)
          continue
        }
        if (plan.action === "wait") {
          bump("waiting")
          continue
        }

        const firstName =
          String(cart.customer?.first_name || cart.shipping_address?.first_name || "").trim() || "there"
        const items = ((cart.items ?? []) as any[]).map((i) => ({ title: i.title }))
        const label = `${email} · ${items.map((i) => i.title).join(", ")} · day ${plan.day} · closes ${plan.close_on}`

        if (plan.action === "close") {
          // The cancel route's own guard: a design already on a sale order
          // means this cart may be the paper trail of a purchase.
          const designIds = [
            ...new Set(((cart.items ?? []) as any[]).map((i) => designsByLine[i.id]).filter(Boolean)),
          ] as string[]
          let linked = false
          for (const d of designIds) if (await hasLinkedSaleOrder(query, d)) linked = true
          const decision = decideCancel({ cart, reason: FOLLOWUP_CLOSE_REASON, hasLinkedOrder: linked })
          if (!decision.ok) {
            bump(`close refused: ${decision.reason}`)
            changes.push({
              entity: "cart",
              id: cart.id,
              field: "metadata.cancelled_at",
              before: null,
              after: null,
              note: `NOT closed (${decision.message}) · ${label}. Close it by hand if it should go.`,
            })
            continue
          }
          changes.push({
            entity: "cart",
            id: cart.id,
            field: "metadata.cancelled_at",
            before: null,
            after: decision.cancelled_at,
            note: `close + email design-order-cancelled · ${label}`,
          })
          bump("close")
          if (!dry_run) {
            await cartService.updateCarts(cart.id, {
              metadata: {
                ...md,
                cancelled_at: decision.cancelled_at,
                cancelled_reason: decision.cancelled_reason,
                cancelled_by: CLOSED_BY,
              },
            })
            const notice = await notifyBuyerOfWithdrawal(container, {
              notify: true,
              to: email,
              template: DESIGN_ORDER_CANCELLED_TEMPLATE,
              data: {
                cart_id: cart.id,
                currency_code: cart.currency_code ?? null,
                buyer_message: FOLLOWUP_CLOSE_BUYER_MESSAGE,
              },
            })
            if (!notice.sent) errors.push({ id: cart.id, message: `closed, but ${notice.reason}` })
          }
          continue
        }

        const template = plan.action === "remind" ? DESIGN_ORDER_REMINDER_TEMPLATE : DESIGN_ORDER_LAST_CALL_TEMPLATE
        const state = nextFollowupState(md.design_order_followup, plan.action, plan.anchor, nowIso)
        changes.push({
          entity: "cart",
          id: cart.id,
          field: "metadata.design_order_followup",
          before: md.design_order_followup ?? null,
          after: state,
          note: `email ${template} · ${label}`,
        })
        bump(plan.action)
        if (!dry_run) {
          await sendNotificationEmailWorkflow(container).run({
            input: {
              to: email!,
              template,
              data: {
                customer_first_name: firstName,
                items,
                checkout_url: `${BACKEND_URL}/r/cart/${cart.id}`,
                close_on: plan.close_on,
                current_year: String(new Date(now).getUTCFullYear()),
              },
            },
          })
          // Stamped after the send: a failed send is retried tomorrow.
          await cartService.updateCarts(cart.id, { metadata: { ...md, design_order_followup: state } })
        }
      } catch (e: any) {
        errors.push({ id: cart.id, message: e?.message ?? String(e) })
        logger?.error?.(`[design-order-followup] ${cart.id}: ${e?.message ?? e}`)
      }
    }

    const tallyText = Object.entries(tally)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ")
    return {
      job_id: DESIGN_ORDER_FOLLOWUP_JOB_ID,
      dry_run,
      applied: !dry_run && changes.some((c) => c.after != null),
      summary:
        `${dry_run ? "Would act on" : "Acted on"} ${changes.filter((c) => c.after != null).length} design order(s) ` +
        `of ${(carts ?? []).length} open cart(s) scanned${asOf ? ` as of ${new Date(now).toISOString().slice(0, 10)}` : ""}. ${tallyText || "Nothing due."}` +
        (errors.length ? ` ${errors.length} error(s).` : ""),
      changes,
      ...(errors.length ? { errors } : {}),
    }
  },
}

/**
 * Install the daily visual flow that runs the job. Created as DRAFT: switch it
 * to active in Visual Flows once the preview reads right.
 */
export const installDesignOrderFollowupFlowJob: MaintenanceJob = {
  id: "install-design-order-followup-flow",
  label: "Install the daily design-order follow-up flow",
  description: `Create the visual flow "${DESIGN_ORDER_FOLLOWUP_FLOW_NAME}": every day at 04:30 UTC (10:00 IST) it runs the ${DESIGN_ORDER_FOLLOWUP_JOB_ID} job and logs its summary. Created as DRAFT; nothing sends until it is set active. Idempotent: an existing flow of that name is left alone.`,
  params: [],
  run: async (container, { dry_run }): Promise<MaintenanceJobResult> => {
    const service: any = container.resolve(VISUAL_FLOWS_MODULE)
    const [existing] = await service.listVisualFlows({ name: DESIGN_ORDER_FOLLOWUP_FLOW_NAME })
    if (existing) {
      return {
        job_id: "install-design-order-followup-flow",
        dry_run,
        applied: false,
        summary: `Flow "${DESIGN_ORDER_FOLLOWUP_FLOW_NAME}" already exists (${existing.id}, ${existing.status}). Nothing to do.`,
        changes: [],
      }
    }
    const cron = "30 4 * * *"
    const flow = {
      name: DESIGN_ORDER_FOLLOWUP_FLOW_NAME,
      description:
        "Daily: unpaid design orders get a gentle reminder on day 3, a last call on day 6, and are closed on day 7 with a note on how to start again. Runs the design-order-followup maintenance job.",
      status: "draft",
      trigger_type: "schedule",
      trigger_config: { cron },
      canvas_state: {
        viewport: { x: 0, y: 0, zoom: 0.9 },
        nodes: [
          { id: "trigger", type: "trigger", position: { x: 400, y: 0 }, data: { label: "Every day, 10:00 IST", triggerType: "schedule", triggerConfig: { cron } } },
          { id: "follow_up", type: "operation", position: { x: 400, y: 160 }, data: { label: "Remind / last call / close", operationKey: "follow_up", operationType: "run_maintenance_job" } },
          { id: "log_summary", type: "operation", position: { x: 400, y: 320 }, data: { label: "Log summary", operationKey: "log_summary", operationType: "log" } },
        ],
        edges: [
          { id: "e-0", source: "trigger", sourceHandle: "default", target: "follow_up", targetHandle: "default" },
          { id: "e-1", source: "follow_up", sourceHandle: "default", target: "log_summary", targetHandle: "default" },
        ],
      },
    }
    const operations = [
      {
        operation_key: "follow_up",
        operation_type: "run_maintenance_job",
        name: "Remind / last call / close",
        sort_order: 0,
        position_x: 400,
        position_y: 160,
        options: { job_id: DESIGN_ORDER_FOLLOWUP_JOB_ID, dry_run: false },
      },
      {
        operation_key: "log_summary",
        operation_type: "log",
        name: "Log summary",
        sort_order: 1,
        position_x: 400,
        position_y: 320,
        options: { message: "Design-order follow-up: {{ follow_up.summary }}", level: "info" },
      },
    ]
    const connections = [
      { source_id: "trigger", source_handle: "default", target_id: "follow_up", connection_type: "default" },
      { source_id: "follow_up", source_handle: "default", target_id: "log_summary", connection_type: "default" },
    ]
    const changes: MaintenanceChange[] = [
      { entity: "visual_flow", id: "(new)", field: "status", before: null, after: "draft", note: `create "${DESIGN_ORDER_FOLLOWUP_FLOW_NAME}" (daily ${cron} UTC)` },
    ]
    if (dry_run) {
      return { job_id: "install-design-order-followup-flow", dry_run, applied: false, summary: `Would create "${DESIGN_ORDER_FOLLOWUP_FLOW_NAME}" as a DRAFT flow.`, changes }
    }
    const created = await service.createCompleteFlow({ flow, operations, connections })
    if (!created?.id) {
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "createCompleteFlow returned no flow")
    }
    changes[0].id = created.id
    return {
      job_id: "install-design-order-followup-flow",
      dry_run,
      applied: true,
      summary: `Created "${DESIGN_ORDER_FOLLOWUP_FLOW_NAME}" (${created.id}) as a DRAFT. Open /app/visual-flows/${created.id} and set it active to start.`,
      changes,
    }
  },
}

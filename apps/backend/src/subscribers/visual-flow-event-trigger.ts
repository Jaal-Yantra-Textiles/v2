import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { VISUAL_FLOWS_MODULE } from "../modules/visual_flows"
import { executeVisualFlowWorkflow } from "../workflows/visual-flows"

/**
 * Visual Flow Event Trigger Subscriber
 * 
 * This subscriber listens to common events and checks if any active visual flows
 * are configured to trigger on that event. If so, it executes those flows.
 * 
 * This allows users to create event-triggered flows without needing to
 * manually create subscriber files.
 * 
 * 🔴 The list in `config.event` below is an ALLOWLIST, and it is the whole
 * story. This note used to say that custom events "can be emitted and they will
 * be matched if a flow is configured to listen for them" — they will not.
 * Medusa delivers a subscriber only the events it names, so an event missing
 * from that array reaches no flow, matches nothing, and reports no error.
 *
 * The failure is quiet in the worst way: the event is emitted, an active flow
 * names it as its trigger, executing that flow BY HAND works perfectly, and
 * nothing whatsoever happens in production. Adding a trigger event therefore
 * means editing this array — a flow alone is never enough.
 */
export default async function visualFlowEventTriggerHandler({
  event,
  container,
}: SubscriberArgs<Record<string, any>>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const eventName = event.name
  const eventData = event.data
  
  try {
    // Get the visual flows service
    const visualFlowsService = container.resolve(VISUAL_FLOWS_MODULE) as any
    
    if (!visualFlowsService) {
      return
    }
    
    // Find all active flows that are triggered by this event
    const flows = await visualFlowsService.listVisualFlows({
      trigger_type: "event",
      status: "active",
    })
    
    // Filter flows that match this specific event.
    //
    // Trigger config supports three shapes (in order of precedence):
    //   1. event_pattern: "production_run.*"  — shell-style wildcard match,
    //      lets one flow listen to a whole namespace of events.
    //   2. event_types: ["a", "b"]            — array of exact names.
    //   3. event_type: "a"                    — legacy single exact name
    //      (kept for backward compatibility with older flows).
    const matchingFlows = flows.filter((flow: any) => {
      return matchesTrigger(flow.trigger_config || {}, eventName)
    })
    
    if (matchingFlows.length === 0) {
      return
    }
    
    logger.info(`[visual-flow-event-trigger] Event "${eventName}" matched ${matchingFlows.length} flow(s)`)

    // Fire each matching flow WITHOUT awaiting it. The event bus awaits this
    // subscriber, so awaiting a flow run here would block event delivery — one
    // slow or long-running flow (durable `wait_for_event` suspends can last
    // minutes/days) would stall the bus and every other matching flow in this
    // batch. Detaching mirrors the webhook async path and the schedule scanner
    // (`run-scheduled-visual-flows.ts`). Each run's own engine persists a flow
    // execution record, so completion is observable without blocking here.
    const triggeredAt = new Date().toISOString()
    for (const flow of matchingFlows) {
      logger.info(`[visual-flow-event-trigger] Dispatching flow "${flow.name}" (${flow.id})`)

      void executeVisualFlowWorkflow(container)
        .run({
          input: {
            flowId: flow.id,
            triggerData: eventData,
            triggeredBy: `event:${eventName}`,
            metadata: {
              event_name: eventName,
              triggered_at: triggeredAt,
            },
          },
        })
        .then(({ errors }) => {
          if (errors?.length) {
            logger.error(
              `[visual-flow-event-trigger] Flow "${flow.name}" (${flow.id}) returned errors`
            )
            return
          }
          logger.info(
            `[visual-flow-event-trigger] Flow "${flow.name}" (${flow.id}) executed successfully`
          )
        })
        .catch((flowError: any) => {
          logger.error(
            `[visual-flow-event-trigger] Failed to execute flow "${flow.name}" (${flow.id}): ${flowError?.message}`
          )
        })
    }
  } catch (error: any) {
    // Don't throw - we don't want to break other subscribers
    logger.error(`[visual-flow-event-trigger] Error processing event "${eventName}": ${error.message}`)
  }
}

/**
 * Return true if the given trigger_config matches the incoming event name.
 * Supports the three shapes documented in the filter above. `event_pattern`
 * uses shell-style wildcards (`*` = any chars, `?` = single char); everything
 * else is escaped. Pattern match beats array match beats exact match so a
 * flow with both doesn't need strict ordering.
 */
function matchesTrigger(triggerConfig: any, eventName: string): boolean {
  if (!triggerConfig || !eventName) return false

  const pattern = triggerConfig.event_pattern
  if (typeof pattern === "string" && pattern.length > 0) {
    return wildcardMatch(pattern, eventName)
  }

  const eventTypes = triggerConfig.event_types
  if (Array.isArray(eventTypes) && eventTypes.length > 0) {
    return eventTypes.some(
      (t: any) =>
        t === eventName ||
        (typeof t === "string" && t.includes("*") && wildcardMatch(t, eventName))
    )
  }

  return triggerConfig.event_type === eventName
}

function wildcardMatch(pattern: string, input: string): boolean {
  // Escape regex metacharacters except * and ?, then translate those two.
  const regex = new RegExp(
    "^" +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*")
        .replace(/\?/g, ".") +
      "$"
  )
  return regex.test(input)
}

/**
 * Subscribe to events that visual flows might want to listen to.
 * 
 * This list is based on common Medusa events and custom module events.
 * The Event Bus will register these subscriptions at startup.
 * 
 * Events are organized by category for clarity.
 */
export const config: SubscriberConfig = {
  event: [
    // === Core Medusa Events ===

    // Cart events
    "cart.created",
    "cart.updated",
    "cart.region_updated",
    "cart.customer_transferred",

    // Customer events 
    "customer.created",
    "customer.updated",
    "customer.deleted",
    
    // Order events
    "order.created",
    "order.placed",
    "order.updated",
    "order.completed",
    "order.canceled",
    "order.fulfillment_created",
    
    // Product events (module.entity.action format)
    "product.product.created",
    "product.product.updated",
    "product.product.deleted",
    "product.product-variant.created",
    "product.product-variant.updated",
    "product.product-variant.deleted",
    
    // Pricing events
    "pricing.price.created",
    "pricing.price.updated",
    "pricing.price.deleted",
    "pricing.price-set.created",
    "pricing.price-set.updated",
    "pricing.price-set.deleted",
    
    // Sales Channel events
    "sales_channel.sales-channel.created",
    "sales_channel.sales-channel.updated",
    "sales_channel.sales-channel.deleted",
    
    // Payment events
    "payment.webhook_received",
    
    // Fulfillment events
    "fulfillment.created",
    "shipment.created",
    "delivery.created",
    
    // Auth events
    "auth.password_reset",
    "invite.created",
    
    // === Custom Module Events ===
    
    // Inventory Orders
    "inventory_orders.inventory-orders.created",
    "inventory_orders.inventory-orders.updated",
    "inventory_orders.inventory-orders.deleted",
    // Fires only on a real status transition (previous → new), unlike the noisy
    // generic "updated" above which also fires on metadata-only writes. Prefer
    // this as the trigger for partner inventory-order notification flows (#771).
    "inventory_orders.inventory-order.status-changed",
    // Shipment-level milestone from the carrier tracking webhook (#888):
    // pickup_scheduled → picked_up → in_transit → out_for_delivery →
    // delivered / rto. Fires only on a real forward transition (webhook
    // retries are deduped); payload: {id, awb, carrier, previous_status,
    // status, order_id, pickup_scheduled_date}.
    "inventory_orders.inventory-shipment.status-changed",

    // Partners
    "partner.partner.created",
    "partner.partner.updated",
    "partner.partner.deleted",
    "partner.created.fromAdmin",

    // Artisan quasi-partner product proposals (#859 / #861). Dedicated events
    // fired only on real artisan actions — not the generic product firehose —
    // so flows can drive review notifications / cross-listing automations.
    "partner_product.proposed",
    "partner_product.approved",
    "partner_product.rejected",

    /**
     * B2B quotes (#1439). `minted` carries the buyer's link, so a flow can
     * introduce the maker before the quote lands; `accepted` fires once, on the
     * fresh acceptance only, so a re-click cannot mail anyone twice.
     *
     * 🔴 This list is an ALLOWLIST, not documentation. The header above says
     * custom events "will be matched if a flow is configured to listen for
     * them" — that is not true, and cost a real debugging pass: the events were
     * emitted, an active flow named `partner_quote.minted` as its trigger, the
     * flow executed correctly when fired by hand, and three real mints
     * triggered nothing at all. Medusa only delivers what is named here, so an
     * event absent from this array reaches no flow and reports no error.
     */
    "partner_quote.minted",
    "partner_quote.accepted",


    // Tasks
    "tasks.task.created",
    "tasks.task.updated",
    "tasks.task.deleted",
    "task_assigned",
    
    // Persons
    "person.person.created",
    "person.person.updated",
    "person.person.deleted",
    "person_address.created",
    "person_address.updated",

    // CRM engagement-sweep transitions (#1355). Sole emitter:
    // api/admin/ops/maintenance-jobs/crm-engagement-sweep-job.ts (run daily by
    // jobs/sweep-crm-engagement.ts); fires only on a real engagement-state
    // transition — follow-up due, contact stalled, contact replied, contact
    // opted out. Same allowlist trap as partner_quote above: these were
    // emitted while absent here, so every flow triggering on crm.* sat inert.
    // The names are also asserted by quote-events-are-subscribed.unit.spec.ts.
    "crm.follow_up_due",
    "crm.contact_stalled",
    "crm.contact_replied",
    "crm.contact_opted_out",
    
    // Agreements
    "agreements.agreement.created",
    "agreements.agreement.updated",
    "agreements.agreement.deleted",
    "agreements.agreement-response.created",
    "agreements.agreement-response.updated",
    
    // Production Runs
    "production_run.sent_to_partner",
    "production_run.accepted",
    "production_run.started",
    "production_run.finished",
    "production_run.completed",
    "production_run.cancelled",
    "production_run.reminder_assignment_pending",
    "production_run.reminder_not_started",
    "production_run.reminder_idle",

    // Feedback
    "feedback.feedback.created",
    "feedback.feedback.updated",
    "feedback.feedback.deleted",
    
    // Social
    "social_platform.created",
    "social_platform.updated",
    "social_post.created",
    
    // Analytics
    "analytics_event.created",
    
    // Pages
    "page.created",
    
    // Subscriptions
    "subscription.created",

    // Inbound Emails
    "inbound_emails.inbound-email.created",
    "inbound_emails.inbound-email.updated",

    // WhatsApp inbound messages — fires for every parsed inbound message
    // (text, image, video, document, audio, interactive). Used by flows that
    // need to react to partner replies, e.g. auto-create draft products from
    // photo+caption messages via createDraftProductFromExtractionWorkflow.
    "whatsapp.message_received",
  ],
}

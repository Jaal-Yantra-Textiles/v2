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
 * Note: The event list below includes common events. The Event Bus dynamically
 * registers events as modules are loaded, so this list covers the most common
 * use cases. For custom events, users can emit them and they will be matched
 * if a flow is configured to listen for them.
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
    
    // Filter flows that match this specific event
    const matchingFlows = flows.filter((flow: any) => {
      const triggerConfig = flow.trigger_config || {}
      return triggerConfig.event_type === eventName
    })
    
    if (matchingFlows.length === 0) {
      return
    }
    
    logger.info(`[visual-flow-event-trigger] Event "${eventName}" matched ${matchingFlows.length} flow(s)`)
    
    // Execute each matching flow
    for (const flow of matchingFlows) {
      try {
        logger.info(`[visual-flow-event-trigger] Executing flow "${flow.name}" (${flow.id})`)
        
        await executeVisualFlowWorkflow(container).run({
          input: {
            flowId: flow.id,
            triggerData: eventData,
            triggeredBy: `event:${eventName}`,
            metadata: {
              event_name: eventName,
              triggered_at: new Date().toISOString(),
            },
          },
        })
        
        logger.info(`[visual-flow-event-trigger] Flow "${flow.name}" executed successfully`)
      } catch (flowError: any) {
        logger.error(`[visual-flow-event-trigger] Failed to execute flow "${flow.name}": ${flowError.message}`)
      }
    }
  } catch (error: any) {
    // Don't throw - we don't want to break other subscribers
    logger.error(`[visual-flow-event-trigger] Error processing event "${eventName}": ${error.message}`)
  }
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
    
    // Partners
    "partner.partner.created",
    "partner.partner.updated",
    "partner.partner.deleted",
    "partner.created.fromAdmin",
    
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
    
    // Agreements
    "agreements.agreement.created",
    "agreements.agreement.updated",
    "agreements.agreement.deleted",
    "agreements.agreement-response.created",
    "agreements.agreement-response.updated",
    
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
  ],
}

import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { ORDER_INVENTORY_MODULE } from "../../modules/inventory_orders"
import { PARTNER_MODULE } from "../../modules/partner"
import InventoryOrderService from "../../modules/inventory_orders/service"
import { LinkDefinition } from "@medusajs/framework/types"

type SendInventoryOrderToPartnerInput = {
    inventoryOrderId: string,
    partnerId: string,
    notes?: string
}

const validateInventoryOrderStep = createStep(
    "validate-inventory-order",
    async (input: SendInventoryOrderToPartnerInput, { container }) => {
        const query = container.resolve(ContainerRegistrationKeys.QUERY)
        
        const { data: orders } = await query.graph({
            entity: "inventory_orders",
            fields: ["*"],
            filters: {
                id: input.inventoryOrderId
            }
        })
        
        if (!orders || orders.length === 0) {
            throw new MedusaError(MedusaError.Types.NOT_FOUND, `Inventory order ${input.inventoryOrderId} not found`)
        }
        
        const order = orders[0]
        
        if (order.status !== 'Pending') {
            throw new MedusaError(MedusaError.Types.INVALID_DATA, `Inventory order must be in Pending status to send to partner. Current status: ${order.status}`)
        }
        
        return new StepResponse(order)
    }
)

const validatePartnerStep = createStep(
    "validate-partner",
    async (input: SendInventoryOrderToPartnerInput, { container }) => {
        const query = container.resolve(ContainerRegistrationKeys.QUERY)
        
        const { data: partners } = await query.graph({
            entity: "partners",
            fields: ["*"],
            filters: {
                id: input.partnerId
            }
        })
        
        if (!partners || partners.length === 0) {
            throw new MedusaError(MedusaError.Types.NOT_FOUND, `Partner ${input.partnerId} not found`)
        }
        
        const partner = partners[0]
        
        return new StepResponse(partner)
    }
)

const linkInventoryOrderWithPartnerStep = createStep(
    "link-inventory-order-with-partner",
    async (input: {inventoryOrderId: string, partnerId: string}, { container }) => {
        const remoteLink = container.resolve(ContainerRegistrationKeys.LINK)
        
        const links: LinkDefinition[] = [{
            [PARTNER_MODULE]: {
                partner_id: input.partnerId,
            },
            [ORDER_INVENTORY_MODULE]: {
                inventory_orders_id: input.inventoryOrderId,
            },
            data: {
                partner_id: input.partnerId,
                inventory_order_id: input.inventoryOrderId,
                assigned_at: new Date().toISOString()
            },
        }]
        
        await remoteLink.create(links)
        return new StepResponse(links)
    },
    async (links: LinkDefinition[], { container }) => {
        // Compensation: remove the link
        if (!links || links.length === 0) {
            return
        }
        const remoteLink = container.resolve(ContainerRegistrationKeys.LINK)
        await remoteLink.dismiss(links)
    }
)

const notifyPartnerStep = createStep(
    {
        name: 'notify-partner-inventory-order',
        async: true,
        // ✅ Remove async: true - should execute synchronously like task workflow
    },
    async (input: {input: SendInventoryOrderToPartnerInput, order: any}, { container }) => {
        const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
        logger.info("Notifying partner about inventory order...")
        
        const eventService = container.resolve(Modules.EVENT_BUS)
        
        // Emit event for partner notification
        eventService.emit({
            name: "inventory_order_assigned_to_partner",
            data: {
                inventory_order_id: input.input.inventoryOrderId,
                partner_id: input.input.partnerId,
                order: input.order,
                notes: input.input.notes
            }
        })
        
        logger.info("Partner notified about inventory order")
        
    }
)

const awaitOrderStart = createStep(
    {
        name: 'await-order-start',
        async: true,
        timeout: 60 * 60 * 24, // 24 hours timeout
        maxRetries: 2
    },
    async (_, { container }) => {
        const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
        logger.info("Awaiting partner to start the order...")
        // ✅ NO return statement - waits for external signaling via setStepSuccess
    }
)

const awaitOrderCompletion = createStep(
    {
        name: 'await-order-completion',
        async: true,
        timeout: 60 * 60 * 24 * 7, // 7 days timeout
        maxRetries: 2
    },
    async (_, { container }) => {
        const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
        logger.info("Awaiting partner to complete the order...")
        // ✅ NO return statement - waits for external signaling via setStepSuccess
    }
)

const updateOrderStatusStep = createStep(
    "update-order-status-for-partner",
    async (input: {orderId: string, status: string}, { container }) => {
        const inventoryOrderService: InventoryOrderService = container.resolve(ORDER_INVENTORY_MODULE)
        
        const updatedOrder = await inventoryOrderService.updateInventoryOrders({
            id: input.orderId,
            status: input.status as any
        })
        
        return new StepResponse(updatedOrder)
    },
    async (updatedOrder, { container }) => {
        if (!updatedOrder) {
            return;
        }
        // Compensation: revert status change if needed
        const inventoryOrderService: InventoryOrderService = container.resolve(ORDER_INVENTORY_MODULE)
        // Note: In a real scenario, you'd want to store the previous status
        // For now, we'll just log the compensation
        const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
        logger.warn(`Compensating order status change for order ${updatedOrder.id}`)
    }
)

const setTransactionIdStep = createStep(
    "set-transaction-id",
    async (input: {input: SendInventoryOrderToPartnerInput, order: any}, { container, context }) => {
        const inventoryOrderService = container.resolve(ORDER_INVENTORY_MODULE)
        
        // Use the actual workflow transaction ID from context (not artificially created)
        const workflowTransactionId = context.transactionId
        
        // Update order metadata with workflow transaction ID and admin notes
        const updatedOrder = await inventoryOrderService.updateInventoryOrders({
            selector: {
                id: input.order.id
            },
            data :{ 
                metadata: {
                    ...input.order.metadata,
                    partner_workflow_transaction_id: workflowTransactionId, // Use real transaction ID
                    assigned_partner_id: input.input.partnerId,
                    assignment_notes: input.input.notes, // Store admin notes here
                    partner_status: 'assigned'
                }
            }
           
        })
        
        return new StepResponse({
            ...input.order,
            metadata: updatedOrder,
            transactionId: workflowTransactionId
        })
    },
    async (orderId, { container }) => {
        // Compensation: remove transaction ID
        if (!orderId) {
            return;
        }
        const inventoryOrderService: InventoryOrderService = container.resolve(ORDER_INVENTORY_MODULE)
        const order = await inventoryOrderService.retrieveInventoryOrder(orderId)
        
        if (order?.metadata) {
            const { partner_workflow_transaction_id, assigned_partner_id, ...cleanMetadata } = order.metadata
            await inventoryOrderService.updateInventoryOrders({
                id: orderId,
                metadata: cleanMetadata
            })
        }
    }
)

export const sendInventoryOrderToPartnerWorkflow = createWorkflow(
    {
        name: 'send-inventory-order-to-partner',
        store: true
    },
    (input: SendInventoryOrderToPartnerInput) => {
        // Step 1: Validate the inventory order
        const order = validateInventoryOrderStep(input)
        
        // Step 2: Validate the partner
        const partner = validatePartnerStep(input)
        
        // Step 3: Set transaction ID for tracking
        const orderWithTransaction = setTransactionIdStep({input, order})
        
        // Step 4: Create link between partner and inventory order
        const partnerLink = linkInventoryOrderWithPartnerStep({
            inventoryOrderId: input.inventoryOrderId,
            partnerId: input.partnerId
        })
        
        // Step 5: Notify partner
        notifyPartnerStep({input, order})
        
        // Step 6: Wait for partner to start
        awaitOrderStart()
        
        // Step 7: Wait for partner to complete
        awaitOrderCompletion()
        
        return new WorkflowResponse({
            success: true,
            order: order,
            partner: partner,
            partnerId: input.partnerId,
            partnerLink
        })
    }
)

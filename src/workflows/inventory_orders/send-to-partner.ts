// Configurable await timeouts (in seconds). Defaults to 30 days if not provided.
const DEFAULT_AWAIT_TIMEOUT_SECONDS = 60 * 60 * 24 * 30
const AWAIT_TIMEOUT_SECONDS = (() => {
  const v = process.env.INVENTORY_AWAIT_TIMEOUT_SECONDS
  const n = v ? Number(v) : NaN
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_AWAIT_TIMEOUT_SECONDS
})()
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { createStep, createWorkflow, StepResponse, WorkflowResponse, transform, when } from "@medusajs/framework/workflows-sdk"
import { notifyOnFailureStep, sendNotificationsStep } from "@medusajs/medusa/core-flows"
import { ORDER_INVENTORY_MODULE } from "../../modules/inventory_orders"
import { PARTNER_MODULE } from "../../modules/partner"
import InventoryOrderService from "../../modules/inventory_orders/service"
import { LinkDefinition } from "@medusajs/framework/types"
import { createTasksFromTemplatesWorkflow } from "./create-tasks-from-templates"
import { TASKS_MODULE } from "../../modules/tasks"
import TaskService from "../../modules/tasks/service"

type SendInventoryOrderToPartnerInput = {
    inventoryOrderId: string,
    partnerId: string,
    notes?: string,
    reinitiate?: boolean,
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

// Detect if this order already has the partner workflow tasks (idempotency guard)
const checkExistingPartnerAssignmentStep = createStep(
    "check-existing-partner-assignment",
    async (input: { orderId: string }, { container }) => {
        const query = container.resolve(ContainerRegistrationKeys.QUERY)
        const { data } = await query.graph({
            entity: "inventory_orders",
            fields: ["id", "tasks.*"],
            filters: { id: input.orderId },
        })
        const orders = data || []
        let taskIds: string[] = []
        let hasAssignment = false
        if (orders.length > 0) {
            const order: any = orders[0]
            const tasks: any[] = Array.isArray(order.tasks) ? order.tasks : []
            taskIds = tasks.map((t) => t.id).filter(Boolean)
            // Consider assigned if any of the partner templates exist
            hasAssignment = tasks.some((t) =>
                ["partner-order-sent", "partner-order-received", "partner-order-shipped"].includes(t?.title)
            )
        }
        return new StepResponse({ hasAssignment, taskIds })
    }
)

// If tasks already exist, just (re)set their transaction IDs for coordination
const setExistingTasksTransactionIdsStep = createStep(
    "set-existing-task-transaction-ids",
    async (input: { orderId: string }, { container, context }) => {
        const taskService: TaskService = container.resolve(TASKS_MODULE)
        const query = container.resolve(ContainerRegistrationKeys.QUERY)
        const workflowTransactionId = context.transactionId

        const { data } = await query.graph({
            entity: "inventory_orders",
            fields: ["id", "tasks.*"],
            filters: { id: input.orderId },
        })
        const orders = data || []
        const tasks: any[] = orders.length > 0 ? (orders[0] as any).tasks || [] : []
        const updated: any[] = []
        for (const t of tasks) {
            const upd = await taskService.updateTasks({
                id: t.id,
                transaction_id: workflowTransactionId,
                status: (t.title || "").includes("sent") ? "completed" : t.status || "pending",
            })
            updated.push(upd)
        }
        return new StepResponse({ count: updated.length })
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

const updateInventoryOrderStep = createStep(
    "update-inventory-order-metadata",
    async (input: { inventoryOrderId: string, metadata: Record<string, any> }, { container }) => {
        const inventoryOrderService: InventoryOrderService = container.resolve(ORDER_INVENTORY_MODULE)
        
        const updatedOrder = await inventoryOrderService.updateInventoryOrders({
            id: input.inventoryOrderId,
            metadata: {
                ...input.metadata
            }
        })
        
        return new StepResponse(updatedOrder)
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

        // Emit an admin-feed style event so history is visible even when link is rolled back
        try {
            const eventService = container.resolve(Modules.EVENT_BUS)
            const link = (links || [])[0] as any
            const inventoryOrderId = link?.[ORDER_INVENTORY_MODULE]?.inventory_orders_id
            const partnerId = link?.[PARTNER_MODULE]?.partner_id
            await eventService.emit({
                name: "inventory_order_partner_link_rolled_back",
                data: {
                    inventory_order_id: inventoryOrderId,
                    partner_id: partnerId,
                    reason: "workflow_rollback",
                    timestamp: new Date().toISOString(),
                }
            })
        } catch (e) {
            const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
            logger.warn(`Failed to emit rollback event for partner link: ${e?.message}`)
        }
    }
)

const notifyPartnerStep = createStep(
    {
        name: 'notify-partner-inventory-order',
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
        timeout: AWAIT_TIMEOUT_SECONDS,
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
        timeout: AWAIT_TIMEOUT_SECONDS,
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



const setTaskTransactionIdsStep = createStep(
    "set-task-transaction-ids",
    async (input: {partnerTasks: any}, { container, context }) => {
        const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
        const taskService: TaskService = container.resolve(TASKS_MODULE)
        const workflowTransactionId = context.transactionId

        logger.info("Setting workflow transaction ID on partner tasks...")
        
        // Get the created tasks from the workflow result
        // The task creation workflow returns [validateStep, createTasksStep, createLinksStep]
        // The actual tasks are in createTasksStep.withTemplates, and task IDs are in the links
        const workflowResult = input.partnerTasks
        let createdTasks: any[] = []
        
        // Extract task IDs from the link objects (index 2 contains the links)
        const linkObjects = workflowResult[2] || []
        const taskIds: string[] = []
        
        if (Array.isArray(linkObjects)) {
            for (const link of linkObjects) {
                if (link && link.task_id) {
                    taskIds.push(link.task_id)
                }
            }
        }
        
        logger.info(`Found ${taskIds.length} task IDs from links: ${JSON.stringify(taskIds)}`)
        
        // Get the actual task objects using TaskService
        if (taskIds.length > 0) {
            const tasks = await taskService.listTasks({
                id: taskIds
            })
            createdTasks = tasks
            logger.info(`Retrieved ${createdTasks.length} task objects from TaskService`)
        }
        
        // Update tasks with workflow transaction ID for proper coordination
        const updatedTasks: any[] = []
        if (Array.isArray(createdTasks)) {
            for (const task of createdTasks) {
                if (task && typeof task === 'object' && 'id' in task) {
                    const updatedTask = await taskService.updateTasks({
                        id: task.id,
                        transaction_id: workflowTransactionId,
                        status: task.title?.includes("sent") ? "completed" : "pending" // Mark "sent" task as completed
                    })
                    updatedTasks.push(updatedTask)
                    logger.info(`Updated task ${task.id} with transaction ID: ${workflowTransactionId}`)
                }
            }
        }
        
        logger.info(`Updated ${updatedTasks.length} partner tasks with transaction ID: ${workflowTransactionId}`)
        
        return new StepResponse({
            tasks: updatedTasks,
            transactionId: workflowTransactionId
        })
    },
    async (taskData, { container }) => {
        // Compensation: remove transaction IDs from tasks
        if (!taskData || !taskData.tasks || !Array.isArray(taskData.tasks)) {
            return
        }
        
        const taskService: TaskService = container.resolve(TASKS_MODULE)
        const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
        
        for (const task of taskData.tasks) {
            if (task && typeof task === 'object' && 'id' in task) {
                try {
                    await taskService.updateTasks({
                        id: task.id,
                        transaction_id: null // Remove transaction ID
                    })
                    logger.info(`Compensated: removed transaction ID from task ${task.id}`)
                } catch (error) {
                    logger.warn(`Failed to compensate task ${task.id}: ${error.message}`)
                }
            }
        }
    }
)

export const sendInventoryOrderToPartnerWorkflow = createWorkflow(
    {
        name: 'send-inventory-order-to-partner',
        store: true
    },
    (input: SendInventoryOrderToPartnerInput) => {
        // Failure notification if this workflow itself errors at kickoff
        const failureNotification = transform({ input }, (data) => {
            return [
                {
                    to: "",
                    channel: "feed",
                    template: "admin-ui",
                    data: {
                        title: "Inventory Order Partner Workflow",
                        description: `Failed to send order ${data.input.inventoryOrderId} to partner ${data.input.partnerId}.`,
                    },
                },
            ]
        })
        notifyOnFailureStep(failureNotification)

        // Step 1: Validate the inventory order
        const order = validateInventoryOrderStep(input)
        
        // Step 2: Validate the partner
        const partner = validatePartnerStep(input)
        
        // Check if assignment already exists (idempotency)
        const existing = checkExistingPartnerAssignmentStep({ orderId: input.inventoryOrderId })
        const hasExisting = transform({ existing }, ({ existing }) => Boolean((existing as any)?.hasAssignment))

        // Step 3: Create link between partner and inventory order only if not already assigned
        when(hasExisting, (b) => !b).then(() => {
            linkInventoryOrderWithPartnerStep({
                inventoryOrderId: input.inventoryOrderId,
                partnerId: input.partnerId
            })
        })
        
        // Step 4: Update inventory order with admin notes
        const orderWithNotes = updateInventoryOrderStep({
            inventoryOrderId: input.inventoryOrderId,
            metadata: {
                assignment_notes: input.notes
            }
        })
        
        // Step 5/6: If no existing, create tasks and set transaction ids
        // Otherwise, only (re)set the transaction ids on existing tasks
        let tasksWithTransactionIds: any
        when(hasExisting, (b) => !b).then(() => {
            const partnerTasks = createTasksFromTemplatesWorkflow.runAsStep({
                input: {
                    inventoryOrderId: input.inventoryOrderId,
                    type: "template",
                    template_names: ["partner-order-sent", "partner-order-received", "partner-order-shipped"],
                    metadata: {
                        partner_id: input.partnerId,
                        inventory_order_id: input.inventoryOrderId,
                        workflow_type: "partner_assignment"
                    }
                }
            })
            tasksWithTransactionIds = setTaskTransactionIdsStep({ partnerTasks })
        })
        when(hasExisting, (b) => Boolean(b)).then(() => {
            setExistingTasksTransactionIdsStep({ orderId: input.inventoryOrderId })
        })
        
        // Step 7: Notify partner (always)
        notifyPartnerStep({input, order})

        // Success notification that kickoff completed
        const successNotification = transform({ input }, (data) => {
            return [
                {
                    to: "",
                    channel: "feed",
                    template: "admin-ui",
                    data: {
                        title: "Inventory Order Partner Workflow",
                        description: `Order ${data.input.inventoryOrderId} sent to partner ${data.input.partnerId}.`,
                    },
                },
            ]
        })
        sendNotificationsStep(successNotification)
        
        // Step 8: Wait for partner to start
        awaitOrderStart()
        
        // Step 9: Wait for partner to complete
        awaitOrderCompletion()
        
        return new WorkflowResponse({
            success: true
        })
    }
)

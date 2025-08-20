import { ContainerRegistrationKeys, MedusaError, Module, Modules } from "@medusajs/framework/utils"
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { DESIGN_MODULE } from "../../modules/designs"
import { PARTNER_MODULE } from "../../modules/partner"
import DesignService from "../../modules/designs/service"
import { LinkDefinition } from "@medusajs/framework/types"
import { createTasksFromTemplatesWorkflow } from "./create-tasks-from-templates"
import { TASKS_MODULE } from "../../modules/tasks"
import TaskService from "../../modules/tasks/service"

// Input for sending a design to a partner
type SendDesignToPartnerInput = {
  designId: string
  partnerId: string
  notes?: string
}

// Step 1: Validate the design exists and is eligible
const validateDesignStep = createStep(
  "validate-design",
  async (input: SendDesignToPartnerInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    const { data } = await query.graph({
      entity: "designs",
      fields: ["*"],
      filters: { id: input.designId },
    })

    if (!data || data.length === 0) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, `Design ${input.designId} not found`)
    }

    const design = data[0]
    // Optionally enforce a status gate if your model has it, e.g., 'Conceptual'/'Ready'
    return new StepResponse(design)
  }
)

// Step 2: Validate the partner exists
const validatePartnerStep = createStep(
  "validate-partner-for-design",
  async (input: SendDesignToPartnerInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    const { data } = await query.graph({
      entity: "partners",
      fields: ["*"],
      filters: { id: input.partnerId },
    })

    if (!data || data.length === 0) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, `Partner ${input.partnerId} not found`)
    }

    const partner = data[0]
    return new StepResponse(partner)
  }
)

// Step 3: Link design with partner via module links
const linkDesignWithPartnerStep = createStep(
  "link-design-with-partner",
  async (input: { designId: string; partnerId: string }, { container }) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK)

    const links: LinkDefinition[] = [
      {
        [DESIGN_MODULE]: {
          design_id: input.designId,
        },
        [PARTNER_MODULE]: {
            partner_id: input.partnerId,
        },
        data: {
          partner_id: input.partnerId,
          design_id: input.designId,
          assigned_at: new Date().toISOString(),
        },
      },
    ]

    await remoteLink.create(links)
    return new StepResponse(links)
  },
  async (links: LinkDefinition[], { container }) => {
    if (!links || links.length === 0) return
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK)
    await remoteLink.dismiss(links)
  }
)

// Step 4: Update design metadata with admin notes
const updateDesignMetadataStep = createStep(
  "update-design-metadata",
  async (input: { designId: string; metadata: Record<string, any> }, { container }) => {
    const designService: DesignService = container.resolve(DESIGN_MODULE)

    const updatedDesign = await designService.updateDesigns({
      id: input.designId,
      metadata: {
        ...input.metadata,
      },
    })

    return new StepResponse(updatedDesign)
  }
)

// Utility step: set workflow transaction IDs on created tasks
const setDesignTaskTransactionIdsStep = createStep(
  "set-design-task-transaction-ids",
  async (input: { partnerTasks: any }, { container, context }) => {
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
    const taskService: TaskService = container.resolve(TASKS_MODULE)
    const workflowTransactionId = context.transactionId

    logger.info("Setting workflow transaction ID on design tasks...")

    const workflowResult = input.partnerTasks
    let createdTasks: any[] = []

    // Extract task IDs from link objects (index 2 contains created links per designs workflow)
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

    if (taskIds.length > 0) {
      const tasks = await taskService.listTasks({ id: taskIds })
      createdTasks = tasks
      logger.info(`Retrieved ${createdTasks.length} task objects from TaskService`)
    }

    // Only set transaction_id; keep all tasks pending initially for design flows
    const updatedTasks: any[] = []
    if (Array.isArray(createdTasks)) {
      for (const task of createdTasks) {
        if (task && typeof task === "object" && "id" in task) {
          const updatedTask = await taskService.updateTasks({
            id: task.id,
            transaction_id: workflowTransactionId,
          })
          updatedTasks.push(updatedTask)
          logger.info(`Updated task ${task.id} with transaction ID: ${workflowTransactionId}`)
        }
      }
    }

    return new StepResponse({ tasks: updatedTasks, transactionId: workflowTransactionId })
  },
  async (taskData, { container }) => {
    if (!taskData || !taskData.tasks || !Array.isArray(taskData.tasks)) return
    const taskService: TaskService = container.resolve(TASKS_MODULE)
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

    for (const task of taskData.tasks) {
      if (task && typeof task === "object" && "id" in task) {
        try {
          await taskService.updateTasks({ id: task.id, transaction_id: null })
          logger.info(`Compensated: removed transaction ID from task ${task.id}`)
        } catch (e: any) {
          logger.warn(`Failed to compensate task ${task.id}: ${e.message}`)
        }
      }
    }
  }
)

// Partner notification step
const notifyPartnerStep = createStep(
  {
    name: "notify-partner-design",
    // make synchronous to avoid racing with external signaling
  },
  async (input: { input: SendDesignToPartnerInput; design: any }, { container }) => {
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
    logger.info("Notifying partner about design assignment...")

    const eventService = container.resolve(Modules.EVENT_BUS)
    eventService.emit({
      name: "design_assigned_to_partner",
      data: {
        design_id: input.input.designId,
        partner_id: input.input.partnerId,
        design: input.design,
        notes: input.input.notes,
      },
    })

    logger.info("Partner notified about design assignment")
  }
)

// Await steps for workflow coordination (external signaling with setStepSuccess)
const awaitDesignStart = createStep(
  { name: "await-design-start", async: true, timeout: 60 * 60 * 24, maxRetries: 2 },
  async (_, { container }) => {
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
    logger.info("Awaiting partner to start design...")
  }
)

const awaitDesignFinish = createStep(
  { name: "await-design-finish", async: true, timeout: 60 * 60 * 24 * 7, maxRetries: 2 },
  async (_, { container }) => {
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
    logger.info("Awaiting design finish (ready for inspection)...")
  }
)

// Optional redo loop gate — partners can request redo after inspection
const awaitDesignRedo = createStep(
  { name: "await-design-redo", async: true, timeout: 60 * 60 * 24 * 3, maxRetries: 1 },
  async (_, { container }) => {
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
    logger.info("Awaiting potential design redo request...")
  }
)

const awaitDesignCompleted = createStep(
  { name: "await-design-completed", async: true, timeout: 60 * 60 * 24 * 14, maxRetries: 2 },
  async (_, { container }) => {
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
    logger.info("Awaiting design completion (post-inspection approved)...")
  }
)

export const sendDesignToPartnerWorkflow = createWorkflow(
  {
    name: "send-design-to-partner",
    store: true,
  },
  (input: SendDesignToPartnerInput) => {
    // 1. Validate entities
    const design = validateDesignStep(input)
    const partner = validatePartnerStep(input)

    // 2. Link design and partner
    const partnerLink = linkDesignWithPartnerStep({ designId: input.designId, partnerId: input.partnerId })

    // 3. Store admin notes on design metadata
    const designWithNotes = updateDesignMetadataStep({
      designId: input.designId,
      metadata: { assignment_notes: input.notes },
    })

    // 4. Create partner coordination tasks (sequential & blocking)
    const partnerTasks = createTasksFromTemplatesWorkflow.runAsStep({
      input: {
        designId: input.designId,
        type: "template",
        template_names: [
          "partner-design-start",
          "partner-design-redo",
          "partner-design-finish",
          "partner-design-completed",
        ],
        dependency_type: "blocking",
        metadata: {
          partner_id: input.partnerId,
          design_id: input.designId,
          workflow_type: "partner_design_assignment",
        },
      },
    })

    // 5. Tag created tasks with transaction ID
    const tasksWithTransactionIds = setDesignTaskTransactionIdsStep({ partnerTasks })

    // 6. Notify partner
    notifyPartnerStep({ input, design })

    // 7. Await partner milestones
    awaitDesignStart()
    awaitDesignFinish()
    awaitDesignRedo() // optional redo after finish/inspection
    awaitDesignCompleted()

    return new WorkflowResponse({ success: true })
  }
)

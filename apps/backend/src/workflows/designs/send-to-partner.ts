import { ContainerRegistrationKeys, MedusaError, Module, Modules } from "@medusajs/framework/utils"
import { createStep, createWorkflow, StepResponse, WorkflowResponse, when, transform } from "@medusajs/framework/workflows-sdk"
import { DESIGN_MODULE } from "../../modules/designs"
import { PARTNER_MODULE } from "../../modules/partner"
import DesignService from "../../modules/designs/service"
import { LinkDefinition } from "@medusajs/framework/types"
import { createTasksFromTemplatesWorkflow } from "./create-tasks-from-templates"
import { TASKS_MODULE } from "../../modules/tasks"
import TaskService from "../../modules/tasks/service"
import { notifyOnFailureStep, sendNotificationsStep } from "@medusajs/medusa/core-flows"
import type { IEventBusModuleService, Logger, RemoteQueryFunction } from "@medusajs/types"
import type { Link } from "@medusajs/modules-sdk"

// Configurable await timeouts (seconds) with sane defaults

const ONE_DAY = 24 * 60 * 60 * 1000; // milliseconds in a day
const timeout = 23 * ONE_DAY; // 23 days
const DEFAULT_AWAIT_TIMEOUT_SECONDS = timeout // 23 days (per requirement)
// Node's setTimeout max is ~2_147_483_647 ms (~24.8 days). The workflows engine converts seconds->ms under the hood,
// so clamp to a safe maximum in seconds to avoid TimeoutOverflowWarning.
const NODE_MAX_TIMEOUT_MS = 2_147_483_647
const SAFE_MAX_TIMEOUT_SECONDS = Math.floor(NODE_MAX_TIMEOUT_MS / 1000) // 2_147_483 seconds (~24.8 days)
const MAX_ALLOWED_SECONDS = 60 * 60 * 24 * 23 // hard cap at 23 days
const envTimeout = Number(process.env.DESIGNS_AWAIT_TIMEOUT_SECONDS)
const desiredTimeoutSeconds = Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : DEFAULT_AWAIT_TIMEOUT_SECONDS
export const DESIGNS_AWAIT_TIMEOUT_SECONDS = Math.min(desiredTimeoutSeconds, MAX_ALLOWED_SECONDS, SAFE_MAX_TIMEOUT_SECONDS)

// Input for sending a design to a partner
type SendDesignToPartnerInput = {
  designId: string
  partnerId: string
  notes?: string
  enableRedo?: boolean
}

// Step 1: Validate the design exists and is eligible
const validateDesignStep = createStep(
  "validate-design",
  async (input: SendDesignToPartnerInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as Omit<RemoteQueryFunction, symbol>

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
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as Omit<RemoteQueryFunction, symbol>

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
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link

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
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
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
    const taskService: TaskService = container.resolve(TASKS_MODULE)
    const workflowTransactionId = context.transactionId

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

    if (taskIds.length > 0) {
      const tasks = await taskService.listTasks({ id: taskIds })
      createdTasks = tasks
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
          // transaction id applied
        }
      }
    }

    return new StepResponse({ tasks: updatedTasks, transactionId: workflowTransactionId })
  },
  async (taskData, { container }) => {
    if (!taskData || !taskData.tasks || !Array.isArray(taskData.tasks)) return
    const taskService: TaskService = container.resolve(TASKS_MODULE)

    for (const task of taskData.tasks) {
      if (task && typeof task === "object" && "id" in task) {
        try {
          await taskService.updateTasks({ id: task.id, transaction_id: null })
        } catch (e: any) {
          // ignore
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
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as Logger
    logger.info("Notifying partner about design assignment...")

    const eventService = container.resolve(Modules.EVENT_BUS) as IEventBusModuleService
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

// Await step factories so timeout reflects current env at composition time
const makeAwaitDesignStart = () =>
  createStep(
    { name: "await-design-start", async: true, maxRetries: 2 },
    async () => {
      // waits for external signaling
    }
  )

const makeAwaitDesignFinish = () =>
  createStep(
    { name: "await-design-finish", async: true, maxRetries: 2 },
    async () => {
      // waits for external signaling
    }
  )

// Optional redo loop gate — partners can request redo after inspection
const makeAwaitDesignRedo = () =>
  createStep(
    { name: "await-design-redo", async: true, maxRetries: 1 },
    async () => {
      // waits for external signaling
    }
  )

const makeAwaitDesignCompleted = () =>
  createStep(
    { name: "await-design-completed", async: true, maxRetries: 2 },
    async () => {
      // waits for external signaling
    }
  )

// --- Redo sub-workflow definitions (inlined to avoid circular imports) ---
export const awaitDesignRefinish = createStep(
  { name: "await-design-refinish", async: true, maxRetries: 1 },
  async (_, { container }) => {
    // waits for external signaling
  }
)

const prepareRedoStep = createStep(
  "prepare-redo",
  async (input: { designId: string }, { container }) => {
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as Logger
    const designService: DesignService = container.resolve(DESIGN_MODULE)
    const updated = await designService.updateDesigns({
      id: input.designId,
      status: "In_Development",
      metadata: { partner_phase: "redo", partner_redo_at: new Date().toISOString() },
    })
    logger.info(`[DesignWF] prepare-redo: design ${input.designId} set to In_Development with phase=redo`)
    return new StepResponse(updated)
  }
)

const revertFinishTasksStep = createStep(
  "revert-finish-tasks",
  async (input: { designId: string }, { container }) => {
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as Logger
    const taskService: TaskService = container.resolve(TASKS_MODULE)
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as Omit<RemoteQueryFunction, symbol>

    const taskLinksResult = await query.graph({
      entity: "designs",
      fields: ["id", "tasks.*"],
      filters: { id: input.designId },
    })
    const taskLinks = taskLinksResult.data || []
    const updates: Promise<any>[] = []
    for (const d of taskLinks) {
      if (Array.isArray(d.tasks)) {
        const finishedTasks = d.tasks.filter((t: any) => t?.title === "partner-design-finish" && t?.status === "completed")
        for (const t of finishedTasks) {
          updates.push(
            taskService.updateTasks({ id: t?.id, status: "assigned", metadata: { ...t?.metadata, rollback_reason: "redo_cycle" } })
          )
        }
        const completedTasks = d.tasks.filter((t: any) => t?.title === "partner-design-completed" && t?.status === "completed")
        for (const t of completedTasks) {
          updates.push(
            taskService.updateTasks({ id: t?.id, status: "assigned", metadata: { ...t?.metadata, rollback_reason: "redo_cycle" } })
          )
        }
      }
    }
    if (updates.length) await Promise.all(updates)
    logger.info(`[DesignWF] revert-finish-tasks: reverted ${updates.length} task(s) for design ${input.designId}`)
    return new StepResponse({ reverted: updates.length })
  }
)

// Find the existing redo parent task linked to this design
const findRedoParentTaskStep = createStep(
  "find-redo-parent-task",
  async (input: { designId: string }, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as Omit<RemoteQueryFunction, symbol>
    const { data } = await query.graph({
      entity: "designs",
      fields: ["id", "tasks.*"],
      filters: { id: input.designId },
    })
    const designs = data || []
    for (const d of designs) {
      if (Array.isArray(d.tasks)) {
        const redoParent = d.tasks.find((t: any) => t?.title === "partner-design-redo")
        if (redoParent) {
          return new StepResponse({ parentTaskId: redoParent.id })
        }
      }
    }
    return new StepResponse({ parentTaskId: "" })
  }
)

// Create redo child subtasks under the redo parent task
const createRedoSubtasksStep = createStep(
  "create-redo-subtasks",
  async (
    input: { designId: string; partnerId: string; parentTaskId: string | null },
    { container }
  ) => {
    const taskService: TaskService = container.resolve(TASKS_MODULE)
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as Logger

    if (!input.parentTaskId) {
      logger.warn("[DesignWF] create-redo-subtasks: No redo parent task found; skipping subtask creation")
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Redo requested but no redo parent task found on design"
      )
    }

    // Resolve template IDs for child subtasks (if templates exist)
    const childTemplateNames = [
      "partner-design-redo-log",
      "partner-design-redo-apply",
      "partner-design-redo-verify",
    ]

    const templates = await taskService.listTaskTemplates({ name: childTemplateNames })
    const templatesByName = new Map<string, string>()
    for (const tpl of templates) {
      if (tpl?.name && tpl?.id) templatesByName.set(tpl.name, tpl.id)
    }

    // Strict validation: all redo child templates must exist
    const missing = childTemplateNames.filter((n) => !templatesByName.has(n))
    if (missing.length) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Missing redo child task templates: ${missing.join(", ")}`
      )
    }

    const created: any[] = []
    for (const name of childTemplateNames) {
      const templateId = templatesByName.get(name)
      try {
        if (templateId) {
          const t = await taskService.createTaskWithTemplates({
            template_ids: [templateId],
            parent_task: input.parentTaskId,
            dependency_type: "subtask",
            metadata: {
              design_id: input.designId,
              partner_id: input.partnerId,
              workflow_type: "partner_design_assignment",
              redo_child_of: input.parentTaskId,
            },
          })
          if (Array.isArray(t)) created.push(...t)
          else created.push(t)
        }
      } catch (e: any) {
        logger.warn(`[DesignWF] create-redo-subtasks: failed to create child '${name}': ${e?.message}`)
      }
    }

    if (!created.length) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Redo child tasks were not created despite valid templates"
      )
    }
    return new StepResponse({ tasks: created })
  }
)

// Link redo child subtasks to the design via module links
const linkRedoSubtasksToDesignStep = createStep(
  "link-redo-subtasks-to-design",
  async (input: { designId: string; tasks: any[] }, { container }) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
    const links: LinkDefinition[] = []
    const tasks = input.tasks || []
    for (const t of tasks) {
      if (!t?.id) continue
      links.push({
        [DESIGN_MODULE]: { design_id: input.designId },
        [TASKS_MODULE]: { task_id: t.id },
      })
    }
    if (!links.length) return new StepResponse([])
    const createdLinks = await remoteLink.create(links)
    return new StepResponse(createdLinks)
  }
)

// Tag redo child subtasks with current workflow transactionId
const tagRedoSubtasksTransactionIdStep = createStep(
  "tag-redo-subtasks-transaction-id",
  async (input: { tasks: any[] }, { container, context }) => {
    const taskService: TaskService = container.resolve(TASKS_MODULE)
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as Logger
    const workflowTransactionId = context.transactionId

    const tasks = input.tasks || []
    const updated: any[] = []
    for (const t of tasks) {
      if (!t?.id) continue
      try {
        const u = await taskService.updateTasks({ id: t.id, transaction_id: workflowTransactionId })
        updated.push(u)
      } catch (e: any) {
        logger.warn(`[DesignWF] tag-redo-subtasks-transaction-id: failed for ${t.id}: ${e?.message}`)
      }
    }
    return new StepResponse(updated)
  }
)

export const sendDesignToPartnerWorkflow = createWorkflow(
  {
    name: "send-design-to-partner",
    store: true,
  },
  (input: SendDesignToPartnerInput) => {
    // Configure failure notification (admin feed) similar to blogs workflow
    const failureNotification = transform({ input }, (data) => {
      return [
        {
          to: "",
          channel: "feed",
          template: "admin-ui",
          data: {
            title: "Design Partner Link",
            description: `Failed to send design ${data.input.designId} to partner ${data.input.partnerId}. The link may have been rolled back.`,
          },
        },
      ]
    })
    notifyOnFailureStep(failureNotification)
    // 1. Validate entities
    const design = validateDesignStep(input)
    const partner = validatePartnerStep(input)

    // Idempotency check: does this design already have partner tasks?
    const checkExistingTasksStep = createStep(
      "check-existing-design-partner-assignment",
      async (i: { designId: string }, { container }) => {
        const query = container.resolve(ContainerRegistrationKeys.QUERY) as Omit<RemoteQueryFunction, symbol>
        const { data } = await query.graph({ entity: "designs", fields: ["id", "tasks.*"], filters: { id: i.designId } })
        const nodes = data || []
        let hasAssignment = false
        if (nodes.length) {
          const d: any = nodes[0]
          const tasks: any[] = Array.isArray(d.tasks) ? d.tasks : []
          hasAssignment = tasks.some((t) =>
            [
              "partner-design-start",
              "partner-design-redo",
              "partner-design-finish",
              "partner-design-completed",
            ].includes(t?.title)
          )
        }
        return new StepResponse({ hasAssignment })
      }
    )
    const existing = checkExistingTasksStep({ designId: input.designId })
    const hasExisting = transform({ existing }, ({ existing }) => Boolean((existing as any)?.hasAssignment))

    // (removed debug existing-assignment log)

    // 2. Link design and partner (only if not already assigned)
    when(hasExisting, (b) => !b).then(() => {
      linkDesignWithPartnerStep({ designId: input.designId, partnerId: input.partnerId })
    })

    // 3. Store admin notes on design metadata
    const designWithNotes = updateDesignMetadataStep({
      designId: input.designId,
      metadata: { assignment_notes: input.notes },
    })

    // 4/5. Create partner tasks only if none; else reset transaction IDs on existing tasks
    const setExistingDesignTasksTransactionIdsStep = createStep(
      "set-existing-design-task-transaction-ids",
      async (i: { designId: string }, { container, context }) => {
        const taskService: TaskService = container.resolve(TASKS_MODULE)
        const query = container.resolve(ContainerRegistrationKeys.QUERY) as Omit<RemoteQueryFunction, symbol>
        const workflowTransactionId = context.transactionId
        const { data } = await query.graph({ entity: "designs", fields: ["id", "tasks.*"], filters: { id: i.designId } })
        const nodes = data || []
        const tasks: any[] = nodes.length ? (nodes[0] as any).tasks || [] : []
        const updated: any[] = []
        for (const t of tasks) {
          if (!t?.id) continue
          const upd = await taskService.updateTasks({ id: t.id, transaction_id: workflowTransactionId })
          updated.push(upd)
        }
        return new StepResponse({ count: updated.length })
      }
    )

    when(hasExisting, (b) => !b).then(() => {
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
      setDesignTaskTransactionIdsStep({ partnerTasks })
    })
    when(hasExisting, (b) => Boolean(b)).then(() => {
      setExistingDesignTasksTransactionIdsStep({ designId: input.designId })
    })

    // 6. Notify partner
    notifyPartnerStep({ input, design })

    // 7. Await partner milestones (dynamic timeout)
    makeAwaitDesignStart()()
    makeAwaitDesignFinish()()

    // Conditional redo branch (runs only if enableRedo !== false)
    // Note: we no longer auto-create redo subtasks here; redo API will create them on-demand
    when(input, (i) => i.enableRedo !== false).then(() => {
      makeAwaitDesignRedo()() // optional redo after finish/inspection
      awaitDesignRefinish()
    })

    // Insert an inventory reporting gate before final completion
    // Partners will POST inventory used and signal this step
    const makeAwaitDesignInventory = () =>
      createStep(
        { name: "await-design-inventory", async: true, maxRetries: 2 },
        async () => {
          // waits for external signaling
        }
      )

    makeAwaitDesignInventory()()

    // Single completion gate at the end (can be signaled after initial finish if no redo, or after redo-refinish and inventory submission)
    makeAwaitDesignCompleted()()

    // Success feed notification
    const successNotification = transform({ input }, (data) => {
      return [
        {
          to: "",
          channel: "feed",
          template: "admin-ui",
          data: {
            title: "Design Partner Link",
            description: `Design ${data.input.designId} sent to partner ${data.input.partnerId}.`,
          },
        },
      ]
    })
    sendNotificationsStep(successNotification)

    return new WorkflowResponse({ success: true })
  }
)

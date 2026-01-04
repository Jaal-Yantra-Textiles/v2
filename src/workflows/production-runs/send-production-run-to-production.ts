import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  transform,
} from "@medusajs/framework/workflows-sdk"
import type { Link } from "@medusajs/modules-sdk"
import type { LinkDefinition } from "@medusajs/framework/types"
import type { IEventBusModuleService, Logger } from "@medusajs/types"

import { PRODUCTION_RUNS_MODULE } from "../../modules/production_runs"
import type ProductionRunService from "../../modules/production_runs/service"

import { PRODUCTION_POLICY_MODULE } from "../../modules/production_policy"
import type ProductionPolicyService from "../../modules/production_policy/service"

import { TASKS_MODULE } from "../../modules/tasks"
import type TaskService from "../../modules/tasks/service"

import { DESIGN_MODULE } from "../../modules/designs"
import { PARTNER_MODULE } from "../../modules/partner"

export type SendProductionRunToProductionInput = {
  production_run_id: string
  template_names: string[]
}

const retrieveProductionRunStep = createStep(
  "retrieve-production-run-for-send",
  async (input: { production_run_id: string }, { container }) => {
    const productionRunService: ProductionRunService = container.resolve(
      PRODUCTION_RUNS_MODULE
    )

    const run = await productionRunService.retrieveProductionRun(input.production_run_id)

    if (!run) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `ProductionRun ${input.production_run_id} not found`
      )
    }

    return new StepResponse(run)
  }
)

const createTasksForProductionRunStep = createStep(
  "create-tasks-for-production-run",
  async (
    input: {
      run: any
      template_names: string[]
    },
    { container, context }
  ) => {
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as Logger
    const productionRunService: ProductionRunService = container.resolve(
      PRODUCTION_RUNS_MODULE
    )
    const productionPolicyService: ProductionPolicyService = container.resolve(
      PRODUCTION_POLICY_MODULE
    )
    const taskService: TaskService = container.resolve(TASKS_MODULE)

    const run = input.run

    await productionPolicyService.assertCanSendToProduction(run)

    const parentTask = await taskService.createTasks({
      title: `production-run-${run.id}`,
      status: "pending",
      priority: "medium",
      start_date: new Date(),
      metadata: {
        workflow_type: "production_run",
        production_run_id: run.id,
        design_id: run.design_id,
        partner_id: run.partner_id,
        role: run.role ?? null,
        transaction_id: context.transactionId,
      },
    } as any)

    const templates = await taskService.listTaskTemplates({
      name: input.template_names,
    } as any)

    const templatesByName = new Map<string, any>()
    for (const t of templates || []) {
      if (t?.name) {
        templatesByName.set(String(t.name), t)
      }
    }

    const missing = (input.template_names || []).filter(
      (name) => !templatesByName.has(String(name))
    )

    if (missing.length) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Missing task templates: ${missing.join(", ")}`
      )
    }

    const templateIds = (input.template_names || [])
      .map((name) => templatesByName.get(String(name))?.id)
      .filter(Boolean)

    const children = await taskService.createTaskWithTemplates({
      template_ids: templateIds,
      parent_task_id: parentTask.id,
      dependency_type: "subtask",
      metadata: {
        workflow_type: "production_run",
        production_run_id: run.id,
        design_id: run.design_id,
        partner_id: run.partner_id,
        role: run.role ?? null,
        transaction_id: context.transactionId,
      },
    } as any)

    const childTasks = Array.isArray(children) ? children : [children]
    const allTasks = [parentTask, ...childTasks]

    await productionRunService.updateProductionRuns({
      id: run.id,
      status: "sent_to_partner" as any,
    })

    logger.info(
      `[ProductionRun] Created ${allTasks.length} task(s) for run ${run.id}`
    )

    return new StepResponse(
      { parentTask, tasks: allTasks },
      { taskIds: allTasks.map((t: any) => t.id).filter(Boolean), runId: run.id }
    )
  },
  async (
    rollbackData: { taskIds: string[]; runId: string } | undefined,
    { container }
  ) => {
    if (!rollbackData?.taskIds?.length) {
      return
    }

    const taskService: TaskService = container.resolve(TASKS_MODULE)
    await taskService.softDeleteTasks(rollbackData.taskIds as any)
  }
)

const linkProductionRunToTasksStep = createStep(
  "link-production-run-to-tasks",
  async (
    input: { production_run_id: string; task_ids: string[] },
    { container }
  ) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link

    const links: LinkDefinition[] = input.task_ids.map((taskId) => ({
      [PRODUCTION_RUNS_MODULE]: {
        production_runs_id: input.production_run_id,
      },
      [TASKS_MODULE]: {
        task_id: taskId,
      },
    }))

    const created = await remoteLink.create(links)
    return new StepResponse(created, links)
  },
  async (links: LinkDefinition[] | undefined, { container }) => {
    if (!links?.length) {
      return
    }

    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
    await remoteLink.dismiss(links)
  }
)

const linkPartnerToTasksStep = createStep(
  "link-partner-to-tasks",
  async (
    input: { partner_id: string; task_ids: string[] },
    { container }
  ) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link

    const links: LinkDefinition[] = input.task_ids.map((taskId) => ({
      [PARTNER_MODULE]: {
        partner_id: input.partner_id,
      },
      [TASKS_MODULE]: {
        task_id: taskId,
      },
    }))

    const created = await remoteLink.create(links)
    return new StepResponse(created, links)
  },
  async (links: LinkDefinition[] | undefined, { container }) => {
    if (!links?.length) {
      return
    }

    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
    await remoteLink.dismiss(links)
  }
)

const linkDesignToTasksStep = createStep(
  "link-design-to-tasks",
  async (
    input: { design_id: string; task_ids: string[] },
    { container }
  ) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link

    const links: LinkDefinition[] = input.task_ids.map((taskId) => ({
      [DESIGN_MODULE]: {
        design_id: input.design_id,
      },
      [TASKS_MODULE]: {
        task_id: taskId,
      },
    }))

    const created = await remoteLink.create(links)
    return new StepResponse(created, links)
  },
  async (links: LinkDefinition[] | undefined, { container }) => {
    if (!links?.length) {
      return
    }

    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
    await remoteLink.dismiss(links)
  }
)

const notifyPartnerStep = createStep(
  "notify-partner-production-run",
  async (input: { run: any }, { container }) => {
    const eventService = container.resolve(Modules.EVENT_BUS) as IEventBusModuleService
    await eventService.emit({
      name: "production_run.sent_to_partner",
      data: {
        production_run_id: input.run.id,
        partner_id: input.run.partner_id,
        design_id: input.run.design_id,
      },
    })
  }
)

export const sendProductionRunToProductionWorkflow = createWorkflow(
  "send-production-run-to-production",
  (input: SendProductionRunToProductionInput) => {
    const run = retrieveProductionRunStep({ production_run_id: input.production_run_id })

    const tasksResult = createTasksForProductionRunStep({
      run,
      template_names: input.template_names,
    })

    const taskIds = transform({ tasksResult }, (data) => {
      const tasks = data.tasksResult?.tasks || []
      return tasks.map((t: any) => t.id).filter(Boolean)
    })

    linkProductionRunToTasksStep({
      production_run_id: input.production_run_id,
      task_ids: taskIds,
    })

    const partnerId = transform({ run }, (data) => (data.run as any).partner_id as string)
    const designId = transform({ run }, (data) => (data.run as any).design_id as string)

    linkPartnerToTasksStep({
      partner_id: partnerId,
      task_ids: taskIds,
    })

    linkDesignToTasksStep({
      design_id: designId,
      task_ids: taskIds,
    })

    notifyPartnerStep({ run })

    return new WorkflowResponse({ run, tasksResult })
  }
)

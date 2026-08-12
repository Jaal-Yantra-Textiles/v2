import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  transform,
} from "@medusajs/framework/workflows-sdk"
import { notifyOnFailureStep, sendNotificationsStep } from "@medusajs/medusa/core-flows"
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
import {
  runProductionRunLifecycleWorkflow,
} from "./run-production-run-lifecycle"
import { mirrorRunPartnerLinkOnUnifiedOrderStep } from "./dual-write-unified-run-order"

export type SendProductionRunToProductionInput = {
  production_run_id: string
  /**
   * Templates BY NAME. Kept because most names are unambiguous and every
   * existing caller uses them, but a name is not an identity: prod carries two
   * rows called "Stitching" that differ only by category (Pre Production vs
   * Production), i.e. two different stages of the process wearing one label.
   * A name that matches more than one row is now REJECTED rather than resolved
   * — see `resolveDispatchTemplateIdsStep`.
   */
  template_names?: string[]
  /**
   * Templates BY ID — preferred. The only way to say which "Stitching" you
   * mean. Takes precedence over `template_names` when both are given.
   */
  template_ids?: string[]
}

/** One resolved template, identified rather than merely named. */
type ResolvedTemplate = {
  id: string
  name: string
  category_name: string | null
}

type TemplateResolution = {
  templates: ResolvedTemplate[]
  /** Whether the caller identified the templates or merely named them. */
  resolved_by: "id" | "name"
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

/**
 * Turn whatever the caller named into identified template rows — BEFORE anything
 * is created.
 *
 * #1261: dispatch used to resolve names with `listTaskTemplates({ name: [...] })`
 * and take the first row per name. On prod that silently picks between two
 * "Stitching" templates in different categories, and the choice is invisible
 * afterwards because the task is titled `Stitching` either way — only
 * `metadata.template_id` records which process the partner actually ran.
 *
 * So: an ambiguous name is a HARD FAILURE, not a coin flip. The error names the
 * colliding categories and the ids to disambiguate with, because a refusal that
 * does not say how to proceed just moves the guessing to the caller.
 *
 * This runs as its own step, ahead of task creation, deliberately. A resolution
 * failure then leaves nothing behind to reverse — no parent task, no children,
 * no run status change — instead of throwing mid-creation.
 */
const resolveDispatchTemplateIdsStep = createStep(
  "resolve-dispatch-template-ids",
  async (
    input: { template_ids?: string[]; template_names?: string[] },
    { container }
  ): Promise<StepResponse<TemplateResolution>> => {
    const taskService: TaskService = container.resolve(TASKS_MODULE)

    const ids = (input.template_ids || []).filter(
      (id): id is string => typeof id === "string" && id.length > 0
    )
    const names = (input.template_names || []).filter(
      (n): n is string => typeof n === "string" && n.length > 0
    )

    if (!ids.length && !names.length) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "No task templates selected: pass template_ids (preferred) or template_names."
      )
    }

    const describe = (t: any): ResolvedTemplate => ({
      id: t.id,
      name: String(t.name),
      category_name: t.category?.name ?? null,
    })

    // Ids win outright. Nothing to disambiguate — an id IS the identity.
    if (ids.length) {
      const rows = await (taskService as any).listTaskTemplates(
        { id: ids },
        { take: null, relations: ["category"] }
      )
      const byId = new Map<string, any>(
        (rows || []).map((t: any) => [String(t.id), t])
      )
      const missing = ids.filter((id) => !byId.has(id))
      if (missing.length) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Missing task templates by id: ${missing.join(", ")}. Nothing was dispatched.`
        )
      }
      // Caller order is the order the partner works in — preserve it rather
      // than whatever order the query came back in.
      return new StepResponse<TemplateResolution>({
        templates: ids.map((id) => describe(byId.get(id))),
        resolved_by: "id",
      })
    }

    const rows = await (taskService as any).listTaskTemplates(
      { name: names },
      { take: null, relations: ["category"] }
    )
    const byName = new Map<string, any[]>()
    for (const t of rows || []) {
      if (!t?.name) {
        continue
      }
      const key = String(t.name)
      byName.set(key, [...(byName.get(key) ?? []), t])
    }

    const missing = names.filter((n) => !(byName.get(n)?.length))
    if (missing.length) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Missing task templates: ${missing.join(", ")}`
      )
    }

    const ambiguous = names.filter((n) => (byName.get(n)?.length ?? 0) > 1)
    if (ambiguous.length) {
      const detail = ambiguous
        .map((n) => {
          const matches = (byName.get(n) ?? []).map(describe)
          return `"${n}" matches ${matches.length} templates — ${matches
            .map(
              (m) =>
                `${m.id} (${m.category_name ?? "uncategorised"})`
            )
            .join(", ")}`
        })
        .join("; ")
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Ambiguous task template name(s): ${detail}. These are DIFFERENT process steps sharing a label, and dispatching the wrong one is invisible afterwards — the task is titled the same either way. Re-send with template_ids to say which you mean. Nothing was dispatched.`
      )
    }

    return new StepResponse<TemplateResolution>({
      templates: names.map((n) => describe((byName.get(n) as any[])[0])),
      resolved_by: "name",
    })
  }
)

const createTasksForProductionRunStep = createStep(
  "create-tasks-for-production-run",
  async (
    input: {
      run: any
      templates: ResolvedTemplate[]
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
    const templates = input.templates || []

    await productionPolicyService.assertCanSendToProduction(run)

    if (!templates.length) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `No task templates resolved for run ${run.id}. Nothing was dispatched.`
      )
    }

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

    const templateIds = templates.map((t) => t.id)

    /**
     * Everything past the parent task is reversed by hand on failure.
     *
     * The step's compensation only runs for a step that RETURNED, and a throw
     * here returns nothing — so without this the parent task (and any children
     * that did get made) would be left orphaned on a dispatch that failed.
     */
    let childTasks: any[] = []
    try {
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

      childTasks = Array.isArray(children) ? children : [children]

      /**
       * `createTaskWithTemplates` re-reads the templates and builds one task per
       * row it finds — so a template deleted between resolution and creation
       * yields FEWER tasks, with no error. A partner would then be handed a
       * process missing a step, and nothing would say so. Refuse the whole
       * dispatch instead.
       */
      if (childTasks.length !== templateIds.length) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Expected ${templateIds.length} task(s) from templates (${templates
            .map((t) => t.name)
            .join(", ")}) but created ${childTasks.length}. A template was likely removed mid-dispatch. Rolled back — nothing was dispatched.`
        )
      }
    } catch (e) {
      const orphaned = [
        parentTask.id,
        ...childTasks.map((t: any) => t?.id),
      ].filter(Boolean)
      try {
        await taskService.softDeleteTasks(orphaned as any)
      } catch (cleanupError: any) {
        logger.error(
          `[ProductionRun] Dispatch of ${run.id} failed AND its ${orphaned.length} task(s) could not be cleaned up: ${cleanupError?.message ?? cleanupError}`
        )
      }
      throw e
    }

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
    await eventService.emit([
      {
        name: "production_run.sent_to_partner",
        data: {
          production_run_id: input.run.id,
          partner_id: input.run.partner_id,
          design_id: input.run.design_id,
        },
      },
      {
        name: "design.production_started",
        data: {
          design_id: input.run.design_id,
          production_run_id: input.run.id,
        },
      },
    ])
  }
)

const startLifecycleWorkflowStep = createStep(
  "start-lifecycle-workflow",
  async (input: { production_run_id: string }, { container }) => {
    // Fire-and-forget: start the lifecycle workflow without awaiting it.
    // The .run() call returns immediately because the workflow suspends
    // at its first async step (await-run-start).
    await runProductionRunLifecycleWorkflow(container).run({
      input: {
        production_run_id: input.production_run_id,
      },
    })

    return new StepResponse(true)
  }
)

export const sendProductionRunToProductionWorkflow = createWorkflow(
  "send-production-run-to-production",
  (input: SendProductionRunToProductionInput) => {
    // Failure notification — shown in admin feed if workflow fails
    const failureNotification = transform({ input }, (data) => [{
      to: "",
      channel: "feed",
      template: "admin-ui",
      data: {
        title: "Production Run Dispatch Failed",
        description: `Failed to dispatch production run ${data.input.production_run_id}. Tasks may not have been created.`,
      },
    }])
    notifyOnFailureStep(failureNotification)

    const run = retrieveProductionRunStep({ production_run_id: input.production_run_id })

    // Identify the templates first. An unresolvable or ambiguous selection
    // fails here, before a single task exists.
    const resolved = resolveDispatchTemplateIdsStep({
      template_ids: input.template_ids,
      template_names: input.template_names,
    })

    const tasksResult = createTasksForProductionRunStep({
      run,
      templates: transform({ resolved }, (data) => data.resolved.templates),
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

    // Start the long-running lifecycle workflow fire-and-forget
    startLifecycleWorkflowStep({
      production_run_id: input.production_run_id,
    })

    // #342 — partner is committed now: D3 link + partner_status "assigned"
    mirrorRunPartnerLinkOnUnifiedOrderStep({
      production_run_id: input.production_run_id,
    })

    // Success notification — shown in admin feed
    const successNotification = transform({ input, run }, (data) => [{
      to: "",
      channel: "feed",
      template: "admin-ui",
      data: {
        title: "Production Run Dispatched",
        description: `Production run ${data.input.production_run_id} sent to partner. Tasks created and ready for acceptance.`,
      },
    }])
    sendNotificationsStep(successNotification)

    // `resolved` is returned so a caller can see WHICH templates ran — the id
    // and category, not just the name that was asked for.
    return new WorkflowResponse({ run, tasksResult, templates: resolved })
  }
)

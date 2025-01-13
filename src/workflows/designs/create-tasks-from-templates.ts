import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  createStep,
  WorkflowResponse,
  StepResponse,
  createWorkflow,
  transform,
} from "@medusajs/framework/workflows-sdk"
import { LinkDefinition } from "@medusajs/framework/types"
import { DESIGN_MODULE } from "../../modules/designs"
import { TASKS_MODULE } from "../../modules/tasks"
import TaskService from "../../modules/tasks/service"
import { createTaskWorkflow } from "../tasks/create-task"

type CreateTasksFromTemplatesInput = {
  designId: string
  templateNames: string[]
}

const validateAndRetrieveTemplatesStep = createStep(
  "validate-and-retrieve-templates",
  async (input: CreateTasksFromTemplatesInput, { container }) => {
    const taskTemplateService: TaskService = container.resolve(TASKS_MODULE)
    
    const templates = await taskTemplateService.listTaskTemplates({
      name: input.templateNames
    }, {
      relations: ["category"]
    })

    if (templates.length !== input.templateNames.length) {
      const foundNames = templates.map(t => t.name)
      const missingNames = input.templateNames.filter(name => !foundNames.includes(name))
      throw new Error(`Templates not found: ${missingNames.join(", ")}`)
    }

    return new StepResponse(templates)
  }
)

const createDesignTaskLinksStep = createStep(
  "create-design-task-links",
  async (input: { tasks: any[], designId: string }, { container }) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK)
    const links: LinkDefinition[] = []

    for (const task of input.tasks) {
      links.push({
        [DESIGN_MODULE]: {
          design_id: input.designId
        },
        [TASKS_MODULE]: {
          task_id: task.id
        },
        data: {
          design_id: input.designId,
          task_id: task.id
        }
      })
    }

    await remoteLink.create(links)
    return new StepResponse(links)
  },
  async (links, { container }) => {
    if (!links?.length) return
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK)
    
    for (const link of links) {
      await remoteLink.dismiss(link)
    }
  }
)

export const createTasksFromTemplatesWorkflow = createWorkflow(
  "create-tasks-from-templates",
  (input: CreateTasksFromTemplatesInput) => {
    const validateStep = validateAndRetrieveTemplatesStep(input)
    
    // Transform templates into task input
    const taskInput = transform(
      { templates: validateStep },
      (data) => ({
        template_ids: data.templates.map(t => t.id)
      })
    )

    // Create tasks with templates
    const createTasksStep = createTaskWorkflow.runAsStep({
      input: taskInput
    })

    // Create links for all tasks
    const createLinksStep = createDesignTaskLinksStep({
      tasks: createTasksStep,
      designId: input.designId
    })

    return new WorkflowResponse([validateStep, createTasksStep, createLinksStep])
  }
)

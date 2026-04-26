import {
  createWorkflow,
  createStep,
  transform,
  StepResponse,
  WorkflowResponse,
  createHook
} from "@medusajs/framework/workflows-sdk"
import { LinkDefinition } from "@medusajs/framework/types"
import { DESIGN_MODULE } from "../../modules/designs"
import { createTaskWorkflow } from "../tasks/create-task"
import { AdminPostDesignTasksReqType } from "../../api/admin/designs/[id]/tasks/validators"
import { TASKS_MODULE } from "../../modules/tasks"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

// Extend the validator type with designId
type CreateTasksInput = AdminPostDesignTasksReqType & {
  designId: string
}

export const determineTaskDataStep = createStep(
  "determine-task-data",
  async (input: any) => {
    console.log("determineTaskDataStep", input)
    if (input.withTemplates) {
      return new StepResponse(input.withTemplates);
    } 
    
    if (input.withParent) {
      const parentResponse = input.withParent;
      
      if ('parent' in parentResponse && 'children' in parentResponse) {
        // For parent-child relationships where parent is an object with task data (not an array)
        if (!Array.isArray(parentResponse.parent) && typeof parentResponse.parent === 'object' && 'id' in parentResponse.parent) {
          // Return the parent task object directly
          return new StepResponse([parentResponse.parent]);
        }
        
        // For parent-child relationships where parent is an array
        if (Array.isArray(parentResponse.parent) && parentResponse.parent.length > 0) {
          return new StepResponse([parentResponse.parent[0]]);
        }
      }
      
      // Handle other cases where parentResponse doesn't have expected structure
      return new StepResponse([parentResponse]);
    } 
    
    if (input.withoutTemplates) {
      return new StepResponse([input.withoutTemplates]);
    }
    
    throw new Error("No valid task response found");
  }
)

export const createDesignTaskLinksStep = createStep(
  "create-design-task-links-step",
  async (input: { tasks: any[], designId: string }, { container }) => {
    const remoteLink:any = container.resolve(ContainerRegistrationKeys.LINK)
    const links: LinkDefinition[] = []
    for (const task of input.tasks) {
      links.push({
        [DESIGN_MODULE]: {
          design_id: input.designId,
        },
        [TASKS_MODULE]: {
          task_id: task.id,
        },
      })
    }

    const createdLinks = await remoteLink.create(links)
    return new StepResponse(createdLinks)
  }
)

export const createTasksFromTemplatesWorkflow = createWorkflow(
  "create-tasks-from-templates",
  (input: CreateTasksInput) => {
    
    // Transform input to match CreateTaskStepInput | CreateTaskWithParentInput
    const transformedInput = transform(
      { input },
      (data) => {
        const { designId, ...taskInput } = data.input;
        return taskInput;
      }
    );

    // Create tasks with templates
    const createTasksStep = createTaskWorkflow.runAsStep({
      input: transformedInput
    });

    // Determine task data from the response
    const taskDataStep = determineTaskDataStep(createTasksStep);

    // Create links for all tasks
    const createLinksStep = createDesignTaskLinksStep({
      tasks: taskDataStep,
      designId: input.designId
    });

    const designTaskCreated = createHook(
      "designTaskCreated", 
      { 
       designId: input.designId,
       tasks: taskDataStep
      }
    )
        
    return new WorkflowResponse([createTasksStep, taskDataStep, createLinksStep], {
      hooks: [designTaskCreated]
    });
  }
)

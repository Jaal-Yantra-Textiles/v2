import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import TaskService from "../../modules/tasks/service";
import { TASKS_MODULE } from "../../modules/tasks";

type DeleteTaskTemplateInput = {
  id: string;
};

export const deleteTaskTemplateStep = createStep(
  "delete-task-template-step",
  async (input: DeleteTaskTemplateInput, { container }) => {
    const taskService: TaskService = container.resolve(TASKS_MODULE);
    
    // Store the template for compensation
    const template = await taskService.retrieveTaskTemplate(input.id);
    
    // Delete the template
    await taskService.deleteTaskTemplates(input.id);
    
    return new StepResponse(undefined, { id: input.id, template });
  },
  async (data: { id: string; template: any }, { container }) => {
    const taskService: TaskService = container.resolve(TASKS_MODULE);
    // Recreate the deleted template
    await taskService.createTaskTemplates({
      ...data.template,
      id: data.id
    });
  }
);

export const deleteTaskTemplateWorkflow = createWorkflow(
  "delete-task-template",
  (input: DeleteTaskTemplateInput) => {
    const result = deleteTaskTemplateStep(input);
    return new WorkflowResponse(result);
  }
);

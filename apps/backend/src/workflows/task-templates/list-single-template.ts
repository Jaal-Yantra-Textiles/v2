import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import TaskService from "../../modules/tasks/service";
import { TASKS_MODULE } from "../../modules/tasks";


type ListSingleTaskTemplateInput = {
  id: string;
  config?: {
    select?: string[];
    relations?: string[];
  };
};

export const listSingleTaskTemplateStep = createStep(
  "list-single-task-template-step",
  async (input: ListSingleTaskTemplateInput, { container }) => {
    const taskService: TaskService = container.resolve(TASKS_MODULE);
    const template = await taskService.retrieveTaskTemplate(input.id, input.config); 
    return new StepResponse(template);
  }
);

export const listSingleTaskTemplateWorkflow = createWorkflow(
  "list-single-task-template",
  (input: ListSingleTaskTemplateInput) => {
    const template = listSingleTaskTemplateStep(input);
    return new WorkflowResponse(template);
  }
);

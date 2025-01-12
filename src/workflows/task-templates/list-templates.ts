import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import TaskService from "../../modules/tasks/service";
import { TASKS_MODULE } from "../../modules/tasks";


type ListTaskTemplatesInput = {
  filters?: {
    id?: string[];
    name?: string;
    category_id?: string;
    priority?: 'low' | 'medium' | 'high';
  };
  config?: {
    skip?: number;
    take?: number;
    select?: string[];
    relations?: string[];
  };
};

export const listTaskTemplatesStep = createStep(
  "list-task-templates-step",
  async (input: ListTaskTemplatesInput, { container }) => {
    const taskService: TaskService = container.resolve(TASKS_MODULE);
    const [templates, count] = await taskService.listAndCountTaskTemplates(
      input.filters,
      input.config
    );
    return new StepResponse({ templates, count });
  }
);

export const listTaskTemplatesWorkflow = createWorkflow(
  "list-task-templates",
  (input: ListTaskTemplatesInput) => {
    const result = listTaskTemplatesStep(input);
    return new WorkflowResponse(result);
  }
);

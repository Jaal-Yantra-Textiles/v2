import {
    createWorkflow,
    createStep,
    StepResponse,
    WorkflowResponse,
  } from "@medusajs/framework/workflows-sdk";
  import TaskService from "../../modules/tasks/service";
  import { TASKS_MODULE } from "../../modules/tasks";
  

  type ListTaskTemplatesCategories = {
    filters?: {
      id?: string[];
      name?: string;
      description?: string;
      metadata?: Record<string, any>;
    };
    config?: {
      skip?: number;
      take?: number;
      select?: string[];
      relations?: string[];
    };
  };
  
  export const listTaskTemplatesCategoriesStep = createStep(
    "list-task-templates-categories-step",
    async (input: ListTaskTemplatesCategories, { container }) => {
      const taskService: TaskService = container.resolve(TASKS_MODULE);
      const [categories, count] = await taskService.listAndCountTaskCategories(
        input.filters,
        input.config
      );
      return new StepResponse({ categories, count });
    }
  );
  
  export const listTaskTemplatesCategoriesWorkflow = createWorkflow(
    "list-task-templates-categories",
    (input: ListTaskTemplatesCategories) => {
      const result = listTaskTemplatesCategoriesStep(input);
      return new WorkflowResponse(result);
    }
  );
  
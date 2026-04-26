import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import TaskService from "../../modules/tasks/service";
import { TASKS_MODULE } from "../../modules/tasks";

type ListTasksStepInput = {
  filters?: Record<string, any>;
  config?: {
    skip?: number;
    take?: number;
    select?: string[];
    relations?: string[];
  };
};

export const listTasksStep = createStep(
  "list-tasks-step",
  async (input: ListTasksStepInput, { container }) => {
    const taskService: TaskService = container.resolve(TASKS_MODULE);
    const [tasks, count] = await taskService.listAndCountTasks(
      input.filters,
      input.config
    );
    return new StepResponse({ tasks, count });
  }
);

type ListTasksWorkflowInput = ListTasksStepInput;

export const listTasksWorkflow = createWorkflow(
  "list-tasks",
  (input: ListTasksWorkflowInput) => {
    const result = listTasksStep(input);
    return new WorkflowResponse(result);
  }
);

import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import TaskService from "../../modules/tasks/service";
import { TASKS_MODULE } from "../../modules/tasks";


type UpdateTaskStepInput = {
  id: string;
  update: {
    title?: string;
    description?: string;
    status?: string;
    priority?: string;
    due_date?: Date;
    assignee_id?: string;
    category_id?: string;
    template_id?: string;
    metadata?: Record<string, any>;
  };
};

export const updateTaskStep = createStep(
  "update-task-step",
  async (input: UpdateTaskStepInput, { container }) => {
    const taskService: TaskService = container.resolve(TASKS_MODULE);
    const task = await taskService.updateTasks(input.id, input.update);
    return new StepResponse(task);
  }
);

type UpdateTaskWorkflowInput = UpdateTaskStepInput;

export const updateTaskWorkflow = createWorkflow(
  "update-task",
  (input: UpdateTaskWorkflowInput) => {
    const task = updateTaskStep(input);
    return new WorkflowResponse(task);
  }
);
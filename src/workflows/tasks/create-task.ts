import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
  when,
} from "@medusajs/framework/workflows-sdk";
import TaskService from "../../modules/tasks/service";
import { TASKS_MODULE } from "../../modules/tasks";

type CreateTaskStepInput = {
  title: string;
  description?: string;
  status?: string;
  priority?: string;
  due_date?: Date;
  assignee_id?: string;
  template_ids?: string[];  // Optional template IDs to create task from
  eventable?: boolean;
  notifiable?: boolean;
  message?: string;
  metadata?: Record<string, any>;
};

type CreateTaskInput = {
  title: string;
  description?: string;
  status?: string;
  priority?: string;
  due_date?: Date;
  assignee_id?: string;
  template_ids?: string[];
  eventable?: boolean;
  notifiable?: boolean;
  message?: string;
  metadata?: Record<string, any>;
};

// Step for creating task with templates
export const createTaskWithTemplatesStep = createStep(
  "create-task-with-templates-step",
  async (input: CreateTaskInput, { container }) => {
    const taskService: TaskService = container.resolve(TASKS_MODULE);
    const task = await taskService.createTaskWithTemplates(input);
    return new StepResponse(task, task.id);
  }
);

// Step for creating task directly
export const createTaskDirectlyStep = createStep(
  "create-task-directly-step",
  async (input: CreateTaskInput, { container }) => {
    const taskService: TaskService = container.resolve(TASKS_MODULE);
    const task = await taskService.createTasks(input);
    return new StepResponse(task, task.id);
  }
);

export const createTaskWorkflow = createWorkflow(
  "create-task",
  (input: CreateTaskInput) => {
    // When task has templates
    const withTemplatesResult = when(
      input,
      (input) => Boolean(input.template_ids?.length)
    ).then(() => {
      return createTaskWithTemplatesStep(input);
    });

    // When task has no templates
    const withoutTemplatesResult = when(
      input,
      (input) => !Boolean(input.template_ids?.length)
    ).then(() => {
      return createTaskDirectlyStep(input);
    });

    return new WorkflowResponse(withTemplatesResult || withoutTemplatesResult);
  }
);

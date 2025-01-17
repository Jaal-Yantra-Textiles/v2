import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import TaskService from "../../modules/tasks/service";
import { TASKS_MODULE } from "../../modules/tasks";

type CreateTaskTemplateInput = {
  name: string;
  description?: string;
  priority?: string;
  estimated_duration?: number;
  required_fields?: Record<string, any>;
  eventable?: boolean;
  notifiable?: boolean;
  message_template?: string;
  metadata?: Record<string, any>;
  category?: {
    id?: string;
    name?: string;
    description?: string;
    metadata?: Record<string, any>;
  };
  category_id?: string;
};

export const createTaskTemplateStep = createStep(
  "create-task-template-step",
  async (input: CreateTaskTemplateInput, { container }) => {
    const taskService: TaskService = container.resolve(TASKS_MODULE);
    if (input.category?.id) {
      input.category_id = input.category.id
      delete input.category
    }
    const template = await taskService.createTaskTemplates({...input});
    return new StepResponse(template, template.id);
  },
  async (id: string, { container }) => {
    const taskService: TaskService = container.resolve(TASKS_MODULE);
    // Delete the created template to compensate
    await taskService.deleteTaskTemplates(id);
  }
);

export const createTaskTemplateWorkflow = createWorkflow(
  "create-task-template",
  (input: CreateTaskTemplateInput) => {
    const result = createTaskTemplateStep(input);
    return new WorkflowResponse(result);
  }
);

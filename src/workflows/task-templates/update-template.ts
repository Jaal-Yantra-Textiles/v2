import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import TaskService from "../../modules/tasks/service";
import { TASKS_MODULE } from "../../modules/tasks";

type UpdateTaskTemplateInput = {
  id: string;
  update: {
    name?: string;
    description?: string;
    category?: {
      name?: string;
      description?: string;
      metadata?: Record<string, any>;
    };
    estimated_duration?: number;
    priority?: 'low' | 'medium' | 'high';
    required_fields?: Record<string, any>;
    eventable?: boolean;
    notifiable?: boolean;
    message_template?: string;
    metadata?: Record<string, any>;
  };
};

export const updateTaskTemplateStep = createStep(
  "update-task-template-step",
  async (input: UpdateTaskTemplateInput, { container }) => {
    const taskService: TaskService = container.resolve(TASKS_MODULE);
    
    // Store the original template for compensation
    const originalTemplate = await taskService.retrieveTaskTemplate(input.id);
    
    // Update the template
    const updatedTemplate = await taskService.updateTaskTemplates({
      selector: {
        id: input.id,
      },
      data: {
        ...input.update
      }
    });
    
    return new StepResponse(updatedTemplate, {
      id: updatedTemplate.id,
      original: originalTemplate
    });
  },
  async (data: { id: string; original: any }, { container }) => {
    const taskService: TaskService = container.resolve(TASKS_MODULE);
    // Restore the template to its original state
    await taskService.updateTaskTemplates(data.id, data.original);
  }
);

export const updateTaskTemplateWorkflow = createWorkflow(
  "update-task-template",
  (input: UpdateTaskTemplateInput) => {
    const template = updateTaskTemplateStep(input);
    return new WorkflowResponse(template);
  }
);

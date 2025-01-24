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
      id?: string;
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
    category_id?: string;
  };
};

export const updateTaskTemplateStep = createStep(
  "update-task-template-step",
  async (input: UpdateTaskTemplateInput, { container }) => {
    const taskService: TaskService = container.resolve(TASKS_MODULE);
    
    // Store the original template for compensation and comparison
    const originalTemplate = await taskService.retrieveTaskTemplate(input.id);
    
    // If category update is requested
    if (input.update.category) {
      const updateCategory = input.update.category;

      // If category ID is provided, check if it's different from current
      if (updateCategory.id) {
        if (originalTemplate.category_id !== updateCategory.id) {
          // Only update the category ID if it's different
          input.update.category_id = updateCategory.id;
        } 
      } else {
          // Create new category
          const newCategory = await taskService.createTaskCategories({
            name: updateCategory.name,
            description: updateCategory.description,
            metadata: updateCategory.metadata,
          });
          
          // Update input with new category ID
          input.update.category_id = newCategory.id;
        
      }
    }
    
    // Update the template with new data
    const updatedTemplate = await taskService.updateTaskTemplates({
      selector: {
        id: input.id,
      },
      data: {
        ...input.update,
      }
    });
    
    return new StepResponse(updatedTemplate, {
      id: updatedTemplate.id,
      compensation: originalTemplate
    });
  },
  async (data: { id: string; compensation: any }, { container }) => {
    const taskService: TaskService = container.resolve(TASKS_MODULE);
    // Restore the template to its original state
    await taskService.updateTaskTemplates(data.id, data.compensation.update);
  }
);

export const updateTaskTemplateWorkflow = createWorkflow(
  "update-task-template",
  (input: UpdateTaskTemplateInput) => {
    const template = updateTaskTemplateStep(input);
    return new WorkflowResponse(template);
  }
);

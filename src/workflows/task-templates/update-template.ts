import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import TaskService from "../../modules/tasks/service";
import { TASKS_MODULE } from "../../modules/tasks";
import { InferTypeOf } from "@medusajs/framework/types";
import TaskTemplate from "../../modules/tasks/models/tasktemplate";
export type TaskTemplateType = InferTypeOf<typeof TaskTemplate>;

type UpdateTaskTemplateInput = {
  id: string;
  update: {
    name?: string;
    description?: string;
    category?: string;
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
    
    // Retrieve the original template for compensation and comparison
    const originalTemplate = await taskService.retrieveTaskTemplate(input.id);
    
    // If category update is requested
    if (input.update.category) {
      const categoryName = input.update.category; 

      // If category_id is provided, use it directly
      if (!input.update.category_id) {
        // If category_id is not provided, check if it matches any existing category first
        let existingCategory: any;
        
        try {
          const categories = await taskService.listTaskCategories({
            name: categoryName
          });
          
          // Check if we got any results
          if (categories && categories.length > 0) {
            existingCategory = categories[0];
          }
        } catch (error) {
          // Category not found, will create a new one
        }

        if (existingCategory) {
          // Use existing category id
          input.update.category_id = existingCategory.id;
        } else {
          // Create new category with the string name
          const newCategory = await taskService.createTaskCategories({
            name: categoryName,
          });
          
          // Update input with new category ID
          input.update.category_id = newCategory.id;
        }
      }

      // Remove the category field as we're using category_id
      delete input.update.category;
    }
    
    // Update the template with new data
    const updatedTemplate = await taskService.updateTaskTemplates({
      selector: {
        id: input.id,
      },
      data: {
        ...input.update,
      }
    }) as unknown as TaskTemplateType;
    
    return new StepResponse(updatedTemplate, {
      id: updatedTemplate.id,
      compensation: originalTemplate
    });
  },
  async (data: { id: string; compensation: any }, { container }) => {
    const taskService: TaskService = container.resolve(TASKS_MODULE);
    // Restore the template to its original state
    await taskService.updateTaskTemplates({
      selector: {
        id: data.id
      },
      data: data.compensation
    });
  }
);

export const updateTaskTemplateWorkflow = createWorkflow(
  "update-task-template",
  (input: UpdateTaskTemplateInput) => {
    const template = updateTaskTemplateStep(input);
    return new WorkflowResponse(template);
  }
);

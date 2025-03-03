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
  priority?: 'low'| 'medium' | 'high' | undefined;
  estimated_duration?: number;
  required_fields?: Record<string, any>;
  eventable?: boolean;
  notifiable?: boolean;
  message_template?: string;
  metadata?: Record<string, any>;
  category?: string;
  category_id?: string;
};

export const createTaskTemplateStep = createStep(
  "create-task-template-step",
  async (input: CreateTaskTemplateInput, { container }) => {
    const taskService: TaskService = container.resolve(TASKS_MODULE);
    
    const template = await taskService.createTaskTemplates({
      ...input,
    });
    return new StepResponse(template, template.id);
  },
  async (id: string, { container }) => {
    const taskService: TaskService = container.resolve(TASKS_MODULE);
    // Delete the created template to compensate
    await taskService.deleteTaskTemplates(id);
  }
);

export const checkCategory = createStep(
  "check-category",
  async (input: CreateTaskTemplateInput, { container }) => {
    const taskService: TaskService = container.resolve(TASKS_MODULE);
    let category;
    
    // Check for existing category using either category_id or category name
    if (input.category_id) {
      try {
        category = await taskService.retrieveTaskCategory(input.category_id);
      } catch (error) {
        // Category not found by ID
      }
    } else if (input.category) {
      try {
        const categories = await taskService.listTaskCategories({
          name: input.category
        });
        
        if (categories && categories.length > 0) {
          category = categories[0];
        }
      } catch (error) {
        // No categories found by name
      }
    }
    
    // Create new category if none found
    if (!category && input.category) {
      category = await taskService.createTaskCategories({
        name: input.category
      });
      
      // Update input with new category_id
      input.category_id = category.id;
    }
    
    // Remove category field as we're using category_id
    if (input.category && input.category_id) {
      delete input.category;
    }
    
    return new StepResponse(input);
  }
)

export const createTaskTemplateWorkflow = createWorkflow(
  {
    name: "create-task-template",
    store: true
  },
  (input: CreateTaskTemplateInput) => {
    // First check/create category if needed
    const inputWithCategory = checkCategory(input);
    
    // Then create the template with the processed input
    const result = createTaskTemplateStep(inputWithCategory);
    
    return new WorkflowResponse(result);
  }
);

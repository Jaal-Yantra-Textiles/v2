import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import TaskService from "../../modules/tasks/service";
import { TASKS_MODULE } from "../../modules/tasks";
import { resolveUniqueTemplateName } from "./unique-name";
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
    estimated_cost?: number;
    cost_currency?: string;
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
    
    /**
     * #1261 — a rename must not manufacture the collision creates now avoid.
     *
     * Renaming a template onto a name another template already holds would put
     * dispatch back where it started: two rows answering to one name, and a
     * dispatch that can pick the wrong process. Same rule as create — qualify
     * with the category rather than refuse, and only when it actually collides.
     */
    if (typeof input.update.name === "string" && input.update.name.trim()) {
      const existing = await (taskService as any).listTaskTemplates(
        {},
        { take: null, relations: ["category"] }
      );

      let categoryName: string | null = null;
      const categoryId =
        input.update.category_id ?? (originalTemplate as any)?.category_id;
      if (categoryId) {
        try {
          const category = await taskService.retrieveTaskCategory(categoryId);
          categoryName = (category as any)?.name ?? null;
        } catch {
          // No qualifier available; the helper falls back to a counter.
        }
      }

      const unique = resolveUniqueTemplateName(
        input.update.name,
        categoryName,
        (existing || []).map((t: any) => ({
          id: t.id,
          name: t.name,
          category_name: t.category?.name ?? null,
        })),
        // The row being renamed must not collide with its own current name.
        input.id
      );

      if (unique.qualified) {
        const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER);
        logger.info(
          `[TaskTemplate] Rename of ${input.id} to "${unique.requested}" collides with ${unique.collided_with
            .map((t) => t.id)
            .join(", ")} — stored as "${unique.name}".`
        );
      }

      input.update.name = unique.name;
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

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

type CreateTaskTemplateInput = {
  name: string;
  description?: string;
  priority?: 'low'| 'medium' | 'high' | undefined;
  estimated_duration?: number;
  estimated_cost?: number;
  cost_currency?: string;
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

    /**
     * #1261 — a name has to identify a template.
     *
     * Prod ended up with two rows called "Stitching" differing only by
     * category, and dispatch resolved by name, so it could run the wrong
     * process invisibly. Creating a second template under a name that is
     * already taken now qualifies it with its category — "Stitching" filed
     * under Pre Production is created as "Stitching (Pre Production)".
     *
     * Qualified rather than rejected: the operator's intent is clear and
     * legitimate (the same step exists in two stages), so refusing the create
     * would just make them invent a name by hand. Only the LABEL is adjusted.
     */
    const existing = await (taskService as any).listTaskTemplates(
      {},
      { take: null, relations: ["category"] }
    );

    let categoryName: string | null = input.category ?? null;
    if (!categoryName && input.category_id) {
      try {
        const category = await taskService.retrieveTaskCategory(
          input.category_id
        );
        categoryName = (category as any)?.name ?? null;
      } catch {
        // A category we cannot read just means no qualifier is available;
        // `resolveUniqueTemplateName` falls back to a counter.
      }
    }

    const unique = resolveUniqueTemplateName(
      input.name,
      categoryName,
      (existing || []).map((t: any) => ({
        id: t.id,
        name: t.name,
        category_name: t.category?.name ?? null,
      }))
    );

    if (unique.qualified) {
      const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER);
      logger.info(
        `[TaskTemplate] "${unique.requested}" is already taken by ${unique.collided_with
          .map(
            (t) => `${t.id} (${t.category_name ?? "uncategorised"})`
          )
          .join(", ")} — creating it as "${unique.name}" so the name identifies one template.`
      );
    }

    const template = await taskService.createTaskTemplates({
      ...input,
      name: unique.name,
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

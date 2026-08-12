import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import TaskService from "../../modules/tasks/service";
import { TASKS_MODULE } from "../../modules/tasks";


type ListTaskTemplatesInput = {
  filters?: {
    id?: string[];
    name?: string;
    category_id?: string;
    /**
     * Filter by the category's NAME rather than its id.
     *
     * The id is the natural key here but nobody outside the database knows it —
     * an operator (or the assistant) says "the Production ones", never
     * "01K5S2WE…". Without this, narrowing by category means listing everything
     * first just to read an id back, which is the round trip the filter exists
     * to avoid.
     */
    category_name?: string;
    priority?: 'low' | 'medium' | 'high';
  };
  config?: {
    skip?: number;
    take?: number;
    select?: string[];
    relations?: string[];
  };
};

export const listTaskTemplatesStep = createStep(
  "list-task-templates-step",
  async (input: ListTaskTemplatesInput, { container }) => {
    const taskService: TaskService = container.resolve(TASKS_MODULE);

    const { category_name, ...rest } = input.filters ?? {};

    // Undefined keys would still be sent as explicit filters by the spread, so
    // strip them — a `{ name: undefined }` filter is not the same as no filter.
    const filters: Record<string, any> = {};
    for (const [k, v] of Object.entries(rest)) {
      if (v !== undefined && v !== null) {
        filters[k] = v;
      }
    }

    if (category_name) {
      filters.category = { name: category_name };
    }

    const [templates, count] = await taskService.listAndCountTaskTemplates(
      filters,
      {
        relations: ["category"]
      }

    );
    return new StepResponse({ templates, count });
  }
);

export const listTaskTemplatesWorkflow = createWorkflow(
  "list-task-templates",
  (input: ListTaskTemplatesInput) => {
    const result = listTaskTemplatesStep(input);
    return new WorkflowResponse(result);
  }
);

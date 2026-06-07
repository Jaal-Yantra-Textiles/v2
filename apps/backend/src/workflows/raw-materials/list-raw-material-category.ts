import {
    createWorkflow,
    createStep,
    StepResponse,
    WorkflowResponse,
  } from "@medusajs/framework/workflows-sdk";
import { RAW_MATERIAL_MODULE } from "../../modules/raw_material";
import RawMaterialService from "../../modules/raw_material/service";
  

  type ListRawMaterialCategories = {
    filters?: {
      id?: string[];
      /** Free-text search across name + description (partial, case-insensitive) */
      q?: string;
      name?: string;
      description?: string;
      metadata?: Record<string, any>;
    };
    config?: {
      skip?: number;
      take?: number;
      select?: string[];
      relations?: string[];
    };
  };

  export const listRawMaterialCategoriesStep = createStep(
    "list-raw-materials-categories-step",
    async (input: ListRawMaterialCategories, { container }) => {
      const rawMaterialService: RawMaterialService = container.resolve(RAW_MATERIAL_MODULE);

      // Normalize free-text search to an ilike $or so partial matches
      // work (the service does exact matching on a bare `name`, and a
      // top-level `name` filter is intercepted by translatable-field
      // handling — wrapping it in $or keeps it a raw, reliable filter).
      // Both `q` and `name` are treated as search-across-name+description.
      const { q, name, ...restFilters } = input.filters || {};
      const searchTerm = (q ?? name ?? "").trim();
      const normalized: Record<string, any> = { ...restFilters };
      if (searchTerm.length > 0) {
        const term = `%${searchTerm}%`;
        normalized.$or = [
          { name: { $ilike: term } },
          { description: { $ilike: term } },
        ];
      }

      const [categories, count] = await rawMaterialService.listAndCountMaterialTypes(
        normalized,
        input.config
      );
      return new StepResponse({ categories, count });
    }
  );
  
  export const listRawMaterialCategoriesWorkflow = createWorkflow(
    "list-raw-materials-categories",
    (input: ListRawMaterialCategories) => {
      const result = listRawMaterialCategoriesStep(input);
      return new WorkflowResponse(result);
    }
  );
  
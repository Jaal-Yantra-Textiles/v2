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
      const [categories, count] = await rawMaterialService.listAndCountMaterialTypes(
        input.filters,
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
  
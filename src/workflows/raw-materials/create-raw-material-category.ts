import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk";
import { RAW_MATERIAL_MODULE } from "../../modules/raw_material";
import RawMaterialService from "../../modules/raw_material/service";




export type CreateRawMaterialCategoryInput = {
    name: string
    description?: string
    category?: "Fiber" | "Yarn" | "Fabric" | "Trim" | "Dye" | "Chemical" | "Accessory" | "Other"
    properties?: Record<string, any>
    metadata?: Record<string, any>
}


const createRawMaterialCategoryStep = createStep(
  "create-raw-material-category",
  async (input: CreateRawMaterialCategoryInput, { container }) => {
    const rawMaterialService: RawMaterialService = container.resolve(RAW_MATERIAL_MODULE);
    const category = await rawMaterialService.createMaterialTypes(input);
    return new StepResponse(category);
  }
);


export const createRawMaterialCategoryWorkflow = createWorkflow(
  {
    name: "create-raw-material-category",
    store: true,
    storeExecution: true
  },
  (input: CreateRawMaterialCategoryInput) => {
    const result = createRawMaterialCategoryStep(input);

    return new WorkflowResponse(result);
  }
);

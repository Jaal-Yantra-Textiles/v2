import { container } from "@medusajs/framework"
import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { RAW_MATERIAL_MODULE } from "../../modules/raw_material"
import RawMaterialService from "../../modules/raw_material/service"

type UpdateRawMaterialStepInput = {
  id: string;
  update: {
    name?: string;
    description?: string;
    composition?: string;
    specifications?: Record<string, any> | null;
    unit_of_measure?: "Meter" | "Yard" | "Kilogram" | "Gram" | "Piece" | "Roll" | "Other";
    minimum_order_quantity?: number;
    lead_time_days?: number;
    color?: string;
    width?: string;
    weight?: string;
    grade?: string;
    certification?: Record<string, any> | null;
    usage_guidelines?: string | null;
    storage_requirements?: string | null;
    status?: "Active" | "Discontinued" | "Under_Review" | "Development";
    metadata?: Record<string, any> | null;
    material_type_id?: string;
    material_type?: string;
  };
};

export const updateRawMaterialStep = createStep(
  "update-raw-material-step",
  async (input: UpdateRawMaterialStepInput, { container }) => {
    console.log(input)
    const rawMaterialService: RawMaterialService = container.resolve(RAW_MATERIAL_MODULE);
    
    // Retrieve the original raw material for compensation and comparison
    const originalRawMaterial = await rawMaterialService.retrieveRawMaterial(input.id);
    
    // If material_type update is requested (as string name)
    if (input.update.material_type) {
      const materialTypeName = input.update.material_type;
      
      // If material_type_id is not provided, check if the name matches any existing category
      if (!input.update.material_type_id) {
        let existingMaterialType: any;
        
        try {
          // Try to find an existing material type with the same name
          const [materialTypes] = await rawMaterialService.listAndCountMaterialTypes({
            name: materialTypeName
          });
          
          // Check if we found a matching material type
          if (materialTypes && materialTypes.length > 0) {
            existingMaterialType = materialTypes[0];
          }
        } catch (error) {
          // Material type not found, will create a new one
        }
        
        if (existingMaterialType) {
          // Use existing material type ID
          input.update.material_type_id = existingMaterialType.id;
        } else {
          // Create a new material type with the string name
          const newMaterialType = await rawMaterialService.createMaterialTypes({
            name: materialTypeName,
            // Default category if needed
            category: 'Other'
          });
          
          // Update input with new material type ID
          input.update.material_type_id = newMaterialType.id;
        }
      }
      
      // Remove the material_type field as we're using material_type_id
      delete input.update.material_type;
    }
    
    // Update the raw material with processed data
    const updatedRawMaterial = await rawMaterialService.updateRawMaterials({
      selector: {
        id: input.id,
      },
      data: input.update
    });
    
    return new StepResponse(updatedRawMaterial, originalRawMaterial);
  },
  async (originalRawMaterial, { container }) => {
    if (!originalRawMaterial) return;
    const rawMaterialService: RawMaterialService = container.resolve(RAW_MATERIAL_MODULE);
    await rawMaterialService.updateRawMaterials({
      selector: {
        id: originalRawMaterial.id
      },
      data: {
        name: originalRawMaterial.name,
        description: originalRawMaterial.description,
        composition: originalRawMaterial.composition,
        specifications: originalRawMaterial.specifications,
        unit_of_measure: originalRawMaterial.unit_of_measure,
        minimum_order_quantity: originalRawMaterial.minimum_order_quantity,
        lead_time_days: originalRawMaterial.lead_time_days,
        color: originalRawMaterial.color,
        width: originalRawMaterial.width,
        weight: originalRawMaterial.weight,
        grade: originalRawMaterial.grade,
        certification: originalRawMaterial.certification,
        usage_guidelines: originalRawMaterial.usage_guidelines,
        storage_requirements: originalRawMaterial.storage_requirements,
        status: originalRawMaterial.status,
        metadata: originalRawMaterial.metadata,
        material_type_id: originalRawMaterial.material_type_id
      }
    });
  },
);

const updateRawMaterialWorkflow = createWorkflow(
  {
    name: "update-raw-material",
    store: true,
    storeExecution: true
  },
  (input: UpdateRawMaterialStepInput) => {
    const updatedRawMaterial = updateRawMaterialStep(input);
    return new WorkflowResponse(updatedRawMaterial);
  },
);

export default updateRawMaterialWorkflow;

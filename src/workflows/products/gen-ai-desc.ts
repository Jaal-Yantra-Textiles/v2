import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { mastra } from "../../mastra";

// 1. Define the input type for the workflow
export type GenerateProductDescriptionInput = {
  imageUrl: string;
  productData: {
    designers?: string[];
    modelUsed?: string;
    materialType?: string;
  };
};

// 2. Define the step that calls the Mastra workflow
export const generateProductDescriptionStep = createStep(
  "generate-product-description-step",
  async (input: GenerateProductDescriptionInput, { container }) => {
    try {
      const { runId, start } = mastra.getWorkflow('productDescriptionWorkflow').createRun();
      const runResult = await start({
        inputData: {
          imageUrl: input.imageUrl,
          productData: input.productData,
        },
      });

      if (runResult.steps.validateDescription?.status !== 'success') {
        const error = runResult.steps.validateDescription || 'Unknown error during validation.';
        throw new Error(`Product description validation failed: ${error}`);
      }

      const descriptionData = runResult.steps.validateDescription.output;
      return new StepResponse(descriptionData);
    } catch (error) {
      console.error("Error generating product description:", error);
      throw error;
    }
  }
);

// 3. Define the main workflow
export const generateProductDescriptionWorkflow = createWorkflow(
  "generate-product-description-from-image",
  (input: GenerateProductDescriptionInput) => {
    const descriptionData = generateProductDescriptionStep(input);
    return new WorkflowResponse(descriptionData);
  }
);

export default generateProductDescriptionWorkflow;

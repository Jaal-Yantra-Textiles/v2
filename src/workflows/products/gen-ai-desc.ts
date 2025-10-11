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
  hint?: string;
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
      // createRunAsync returns a Run object, we need to call .start() on it
      const run = await mastra.getWorkflow('productDescriptionWorkflow').createRunAsync();
      const workflowResult = await run.start({
        inputData: {
          imageUrl: input.imageUrl,
          productData: input.productData || {},
          hint: input.hint,
        },
      });

      // Check if validateDescription step succeeded
      if (workflowResult.steps.validateDescription?.status === 'success') {
        const descriptionData = workflowResult.steps.validateDescription.output;
        return new StepResponse(descriptionData);
      }

      // Check if validateDescription step failed
      if (workflowResult.steps.validateDescription?.status === 'failed') {
        const error = workflowResult.steps.validateDescription.error || 'Unknown validation error';
        throw new Error(`Product description validation failed: ${error}`);
      }

      // Fallback: try to get from generateDescription step
      if (workflowResult.steps.generateDescription?.status === 'success') {
        const descriptionData = workflowResult.steps.generateDescription.output;
        return new StepResponse(descriptionData);
      }

      throw new Error('Mastra workflow did not complete successfully');
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

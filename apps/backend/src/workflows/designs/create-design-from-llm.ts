import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
  transform,
} from "@medusajs/framework/workflows-sdk";
import { DESIGN_MODULE } from "../../modules/designs";
import DesignService from "../../modules/designs/service";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { sendNotificationsStep } from "@medusajs/medusa/core-flows";
import { mastra } from "../../mastra";
import {
  convertColorPaletteToColors,
  convertCustomSizesToSizeSets,
} from "./helpers/size-set-utils";

// Input type for the generate design step
export type GenerateDesignFromLLMInput = {
  designPrompt: string;
  existingValues?: Record<string, any>;
};

// Step to generate design data from LLM
export const generateDesignDataStep = createStep(
  "generate-design-data-step",
  async (input: GenerateDesignFromLLMInput, { container, context }) => {
    // For testing purposes, return mock data
    if (process.env.NODE_ENV === "test") {
      const mockDesign = {
        name: "Summer Floral Collection",
        description: "A vibrant collection inspired by tropical flowers",
        design_type: "Original",
        status: "Conceptual",
        priority: "Medium",
        tags: ["summer", "floral", "vibrant"],
        designer_notes: "Use sustainable cotton fabrics with eco-friendly dyes"
      };
      return new StepResponse(mockDesign);
    }


    try {
      // Call the Mastra designValidator workflow
      const run = await mastra.getWorkflow('designValidationWorkflow').createRun();
      const runResult = await run.start({
        inputData: {
          designPrompt: input.designPrompt,
          existingValues: input.existingValues || {}
        }
      });

      if (runResult.steps.validateDesignData?.status !== 'success') {
        const error = runResult.steps.validateDesignData.status;
        throw new Error(`Design validation failed: ${error}`);
      }

      const designData = runResult.steps.validateDesignData.output;
      return new StepResponse(designData);
        
     
      // const response = await fetch(process.env.MASTRA_URL! + `/api/workflows/designValidationWorkflow`, {
      //   method: 'POST',
      //   headers: {
      //     'Content-Type': 'application/json',
      //   },
      //   body: JSON.stringify({
      //     triggerData: {
      //       designPrompt: input.designPrompt,
      //       existingValues: input.existingValues || {}
      //     }
      //   })
      // });

      // if (!response.ok) {
      //   throw new Error(`Design generation request failed: ${response.statusText}`);
      // }

      // const workflowResult = await response.json();
      
      // // Check if workflow execution was successful
      // if (workflowResult.results.validateDesignData?.status === 'failed') {
      //   const error = workflowResult.results.validateDesignData.error;
      //   throw new Error(`Design validation failed: ${error}`);
      // }

      // if (workflowResult.results.validateDesignData?.status === 'success') {
      //   const designData = workflowResult.results.validateDesignData.output;
      //   return new StepResponse(designData);
      // }

      // throw new Error('Design generation workflow execution failed');
    } catch (error) {
      console.error("Error generating design data:", error);
      throw error;
    }
  }
);

// Step to create design in the database
export const createDesignFromDataStep = createStep(
  "create-design-from-data-step",
  async (input: Record<string, any>, { container }) => {
    const designService: DesignService = container.resolve(DESIGN_MODULE);

    // Normalize the LLM's loose `custom_sizes` / `color_palette` into the
    // structured `size_sets` / `colors` relations — same as the manual
    // `create-design` path. Without this, AI-generated designs only ever
    // carried `custom_sizes` and their `size_sets` relation stayed empty, so
    // the design manager's Sizes section had nothing to show.
    const normalizedSizeSets = convertCustomSizesToSizeSets(input.custom_sizes);
    const normalizedColors = convertColorPaletteToColors(input.color_palette);

    // Process the input data to match the design model
    const designData = {
      name: input.name,
      description: input.description,
      inspiration_sources: input.inspiration_sources,
      design_type: input.design_type,
      status: input.status,
      priority: input.priority,
      target_completion_date: input.target_completion_date ? new Date(input.target_completion_date) : null,
      custom_sizes: normalizedSizeSets ? null : input.custom_sizes,
      color_palette: normalizedColors ? null : input.color_palette,
      tags: input.tags,
      estimated_cost: input.estimated_cost,
      designer_notes: input.designer_notes,
      metadata: input.metadata
    };

    const design = await designService.createDesigns(designData);

    if (normalizedColors?.length) {
      await designService.createDesignColors(
        normalizedColors.map((c) => ({ design_id: design.id, ...c }))
      );
    }
    if (normalizedSizeSets?.length) {
      await designService.createDesignSizeSets(
        normalizedSizeSets.map((s) => ({ design_id: design.id, ...s }))
      );
    }

    return new StepResponse(design, design.id);
  },
  // Compensation function to handle rollback
  async (designId, { container }) => {
    if (designId) {
      const designService: DesignService = container.resolve(DESIGN_MODULE);
      await designService.deleteDesigns(designId);
    }
  }
);

// Main workflow that combines the steps
export const createDesignFromLLMWorkflow = createWorkflow(
  "create-design-from-llm",
  (input: GenerateDesignFromLLMInput) => {
    const designData = generateDesignDataStep(input);
    const design = createDesignFromDataStep(designData);
    const designInfo = transform({design}, (data) => {
      return [
      {
        to: "",
        channel: "feed",
        template: "admin-ui",
        data: {
          title: "Design created",
          description: `Design created successfully with the help of LLM! Design ID: ${data.design.id}`
        }
      }
      ]
    });
    
    sendNotificationsStep(designInfo)
    return new WorkflowResponse(design);
  }
);

export default createDesignFromLLMWorkflow;
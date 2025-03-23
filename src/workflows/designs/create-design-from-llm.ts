import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { Modules } from "@medusajs/framework/utils";
import { INotificationModuleService } from "@medusajs/types";
import { DESIGN_MODULE } from "../../modules/designs";
import DesignService from "../../modules/designs/service";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { sendNotificationsStep } from "@medusajs/medusa/core-flows";
import { template, transform } from "lodash";
import { title } from "process";

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

    const notificationModuleService: INotificationModuleService = 
      container.resolve(Modules.NOTIFICATION);

    try {
      // Call the Mastra designValidator workflow
      const response = await fetch('http://localhost:4111/api/workflows/designValidationWorkflow/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          triggerData: {
            designPrompt: input.designPrompt,
            existingValues: input.existingValues || {}
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Design generation request failed: ${response.statusText}`);
      }

      const workflowResult = await response.json();
      
      // Check if workflow execution was successful
      if (workflowResult.results.validateDesignData?.status === 'failed') {
        const error = workflowResult.results.validateDesignData.error;

        
        await notificationModuleService.createNotifications({
          to: "",
          channel: "feed",
          template: "admin-ui",
          data: {
            prompt: input.designPrompt,
            error,
            designData: workflowResult.results.generateDesignData?.output
          },
        });
        throw new Error(`Design validation failed: ${error}`);
      }

      if (workflowResult.results.validateDesignData?.status === 'success') {
        const designData = workflowResult.results.validateDesignData.output;
        await notificationModuleService.createNotifications({
          to: "",
          channel: "feed",
          template: "admin-ui",
          data: {
            prompt: input.designPrompt,
            designData
          },
        });
        return new StepResponse(designData);
      }

      throw new Error('Design generation workflow execution failed');
    } catch (error) {
      console.error("Error generating design data:", error);
      await notificationModuleService.createNotifications({
        to: "",
        channel: "feed",
        template: "design-generation-error",
        data: {
          prompt: input.designPrompt,
          error: error.message
        },
      });
      throw error;
    }
  }
);

// Step to create design in the database
export const createDesignFromDataStep = createStep(
  "create-design-from-data-step",
  async (input: Record<string, any>, { container }) => {
    const link = container.resolve(ContainerRegistrationKeys.LINK);
    const designService: DesignService = container.resolve(DESIGN_MODULE);
    
    // Process the input data to match the design model
    const designData = {
      name: input.name,
      description: input.description,
      inspiration_sources: input.inspiration_sources,
      design_type: input.design_type,
      status: input.status,
      priority: input.priority,
      target_completion_date: input.target_completion_date ? new Date(input.target_completion_date) : null,
      custom_sizes: input.custom_sizes,
      color_palette: input.color_palette,
      tags: input.tags,
      estimated_cost: input.estimated_cost,
      designer_notes: input.designer_notes,
      metadata: input.metadata
    };
    
    const design = await designService.createDesigns(designData);
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
    const notifications = 
     [
        {
          to: "",
          channel: "feed",
          template: "admin-ui",
          data: {
            title: "Design created",
            description: `Design created successfully with the help of LLM!`
          }
        }
      ]
    sendNotificationsStep(notifications)
    return new WorkflowResponse(design);
  }
);

export default createDesignFromLLMWorkflow;
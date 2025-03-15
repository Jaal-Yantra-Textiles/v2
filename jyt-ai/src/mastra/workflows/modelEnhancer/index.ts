
import { Workflow, Step } from "@mastra/core";
import { z } from "zod";
import { modelAgent } from "../../agents";
import { mastra } from "../..";
const logger = mastra.getLogger()

// Schema definitions
const triggerSchema = z.object({
  modelName: z.string(),
  categoryOptions: z.array(z.string()),
  currentValues: z.record(z.any()).optional()
});

const enhancementSchema = z.object({
  category: z.string(),
  properties: z.record(z.any()),
  validationRules: z.array(z.string()),
  metadata: z.object({
    description: z.string(),
    relatedCategories: z.array(z.string()).optional()
  })
});

// Create the workflow
export const modelEnhancementWorkflow = new Workflow({
  name: 'model-enhancement',
  triggerSchema
});

// Model analysis step
const analyzeModel = new Step({
  id: 'analyzeModel',
  outputSchema: enhancementSchema,
  execute: async ({ context }) => {
    const { modelName, categoryOptions, currentValues } = context.triggerData;
    
    const response = await modelAgent.generate(
      [{
        role: "user",
        content: `Analyze and enhance data model based on requirements:
        - Model Name: ${modelName}
        - Available Categories: ${categoryOptions.join(", ")}
        ${currentValues ? `- Current Values: ${JSON.stringify(currentValues)}` : ""}
        
        Required Enhancements:
        1. Select most appropriate category
        2. Generate relevant properties with types
        3. Create validation rules
        4. Add descriptive metadata`
      }],
      { output: enhancementSchema }
    );

    return response.object;
  }
});

// Validation step
const validateEnhancement = new Step({
  id: 'validateEnhancement',
  execute: async ({ context }) => {
    const analysis = context.steps.analyzeModel;
    
    if (!analysis || analysis.status !== "success") {
      throw new Error("Model analysis step failed");
    }

    try {
      return enhancementSchema.parse(analysis.output);
    } catch (error) {
      
      logger.error("Enhancement validation failed");
      throw new Error(`Validation failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }
});

// Link workflow steps
modelEnhancementWorkflow
  .step(analyzeModel)
  .then(validateEnhancement)
  .commit();
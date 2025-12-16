// @ts-nocheck - Ignore all TypeScript errors in this file
import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod/v4";
import { designAgent } from "../../agents";
import { PinoLogger } from "@mastra/loggers";
const logger = new PinoLogger()

// Schema definitions for design validation
const triggerSchema = z.object({
  designPrompt: z.string(),
  existingValues: z.record(z.any()).optional()
});

// EditorJS block types schema
const editorJsBlockSchema = z.object({
  type: z.string(),
  data: z.record(z.any())
});

const editorJsSchema = z.object({
  time: z.number(),
  blocks: z.array(editorJsBlockSchema),
  version: z.string()
});

const designSchema = z.object({
  name: z.string(),
  description: z.string(),
  inspiration_sources: z.array(z.string()).optional(),
  design_type: z.enum(["Original", "Derivative", "Custom", "Collaboration"]),
  status: z.enum([
    "Conceptual",
    "In_Development",
    "Technical_Review",
    "Sample_Production",
    "Revision",
    "Approved",
    "Rejected",
    "On_Hold"
  ]),
  priority: z.enum(["Low", "Medium", "High", "Urgent"]),
  target_completion_date: z.string().optional(),
  custom_sizes: z.record(z.record(z.number())).optional(),
  color_palette: z.array(z.object({
    name: z.string(),
    code: z.string()
  })).optional(),
  tags: z.array(z.string()),
  estimated_cost: z.number().optional(),
  designer_notes: z.union([z.string(), editorJsSchema]),
  metadata: z.record(z.any()).optional()
});

// Design generation step
const generateDesignData = createStep({
  id: 'generateDesignData',
  inputSchema: triggerSchema,
  outputSchema: designSchema,
  execute: async ({ inputData }) => {
    const { designPrompt, existingValues } = inputData;
    
    logger.info(`Generating design data from prompt: ${designPrompt}...`);
    
    const response = await designAgent.generate(
      [{
        role: "user",
        content: `Create a structured design based on the following prompt:
        
        "${designPrompt}"
        
        ${existingValues ? `Consider these existing values: ${JSON.stringify(existingValues, null, 2)}` : ""}
        
        Generate a complete design with the following properties:
        
        1. name: A creative and descriptive name for the design
        2. description: A detailed description of the design in less than 40 words
        3. inspiration_sources: Array of URLs or references that inspired this design
        4. design_type: One of ["Original", "Derivative", "Custom", "Collaboration"]
        5. status: One of ["Conceptual", "In_Development", "Technical_Review", "Sample_Production", "Revision", "Approved", "Rejected", "On_Hold"]
        6. priority: One of ["Low", "Medium", "High", "Urgent"]
        7. target_completion_date: Optional ISO date string for target completion
        8. custom_sizes: Include standard textile size measurements in this format:
            {
              "M": {
                "chest": 38,
                "length": 29
              },
              "S": {
                "chest": 36,
                "length": 28
              },
              "L": {
                "chest": 40,
                "length": 30
              }
            }
            
            Use these standard size options: XS, S, M, L, XL, XXL, XXXL
            Include these measurement types as appropriate: chest, length, shoulder, sleeve, waist, hip
            Provide realistic measurements in inches for each size
        9. color_palette: Array of objects with { name, code } for each color
        10. tags: Array of relevant tags for categorization
        11. estimated_cost: Optional numeric value
        12. designer_notes: Detailed notes about the design process, materials, etc. Format this as a string - it will be converted to EditorJS format later.
        13. metadata: Any additional information including the ai generated stuff 
        
        Return the data as a valid JSON object with these fields.`
      }],
      { output: designSchema }
    );

    return response.object;
  }
});

// Validation step
const validateDesignData = createStep({
  id: 'validateDesignData',
  inputSchema: designSchema,
  outputSchema: designSchema,
  execute: async ({ inputData }) => {
    const designData = inputData;

    try {
      
      // Perform additional validation and normalization
      
      // Check for minimum description length
      if (designData.description.length < 20) {
        logger.warn("Description is too short");
      }
      
      // Validate color palette exists if provided
      if (designData.color_palette && designData.color_palette.length === 0) {
        logger.warn("Color palette is empty");
      }
      
      // Validate custom_sizes format if provided
      if (designData.custom_sizes && Object.keys(designData.custom_sizes).length === 0) {
        logger.warn("Custom sizes are empty");
      }
      
      // Ensure tags are lowercase and trimmed
      if (designData.tags && designData.tags.length > 0) {
        designData.tags = designData.tags.map(tag => tag.toLowerCase().trim());
      }
      
      // Convert designer_notes to EditorJS format if it's a string
      if (typeof designData.designer_notes === 'string') {
        const notesText = designData.designer_notes;
        
        // Convert to EditorJS format
        designData.designer_notes = {
          time: Date.now(),
          blocks: [
            {
              type: "paragraph",
              data: {
                text: notesText
              }
            }
          ],
          version: "2.26.5"
        };
        
        logger.info("Converted designer_notes to EditorJS format");
      }
      
      return designData;
    } catch (error) {
      logger.error("Design validation failed");
      throw new Error(`Validation failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }
});

// Create and export the workflow
export const designValidationWorkflow = createWorkflow({
  id: 'design-validation',
  inputSchema: triggerSchema,
  outputSchema: designSchema
})
.then(generateDesignData)
.then(validateDesignData)
.commit();

export default designValidationWorkflow;

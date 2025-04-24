// @ts-nocheck - Ignore all TypeScript errors in this file
import { Workflow, Step } from "@mastra/core/workflows";
import { z } from "zod";
import { seoAgent } from "../../agents";

// Define our schemas
const triggerSchema = z.object({
  title: z.string(),
  content: z.string(),
  page_type: z.string()
});

const metadataSchema = z.object({
  meta_title: z.string().max(40),  // Reduced from 60
  meta_description: z.string().max(120),  // Reduced from 160
  meta_keywords: z.string().max(100),
  og_title: z.string().max(40).optional(),
  og_description: z.string().max(120).optional(),
  og_image: z.string().max(200).optional(),
  twitter_card: z.string().max(15).optional(),
  twitter_title: z.string().max(40).optional(),
  twitter_description: z.string().max(120).optional(),
  twitter_image: z.string().max(200).optional(),
  schema_markup: z.string().max(500).optional()
});

// Create the workflow
export const seoWorkflow = new Workflow({
  name: 'seo-metadata',
  triggerSchema
});

// Define the metadata generation step
const generateMetadata = new Step({
  id: 'generateMetadata',
  outputSchema: metadataSchema,
  execute: async ({ context }) => {
    const response = await seoAgent.generate(
      [{
        role: "user",
        content: `Generate concise SEO metadata for this page. Keep it brief but impactful.

Requirements:
- Meta title: Max 40 chars
- Meta description: Max 120 chars
- Keywords: Max 100 chars, comma-separated
- Optional: Short OpenGraph and Twitter metadata (same length limits)

Page context: ${JSON.stringify(context.triggerData)}`
      }],
      { output: metadataSchema }
    );
    return response.object;
    
  }
});

// Define validation step
const validateMetadata = new Step({
  id: 'validateMetadata',
  execute: async ({ context }) => {
    const generationStep = context.steps.generateMetadata;
      if (!generationStep || generationStep.status !== "success") {
      throw new Error(`Metadata generation failed or not found. Steps: ${JSON.stringify(context)}`);
    }

    const metadata = generationStep.output;
    
    try {
      // Use the same schema for validation
      const validatedMetadata = metadataSchema.parse(metadata);
      return validatedMetadata;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const issues = error.issues.map(i => i.message).join(', ');
        throw new Error(`Metadata validation failed: ${issues}`);
      }
      throw error;
    }
  }
});

// Link the steps and commit the workflow
seoWorkflow
  .step(generateMetadata)
  .then(validateMetadata)
  .commit();
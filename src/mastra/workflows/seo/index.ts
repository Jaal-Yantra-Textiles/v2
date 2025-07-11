import { createWorkflow, createStep } from "@mastra/core/workflows";
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

// Define the metadata generation step
const generateMetadata = createStep({
  id: 'generateMetadata',
  inputSchema: triggerSchema,
  outputSchema: metadataSchema,
  execute: async ({ inputData }) => {
    const response = await seoAgent.generate(
      [{
        role: "user",
        content: `Generate concise SEO metadata for this page. Keep it brief but impactful.

Requirements:
- Meta title: Max 40 chars
- Meta description: Max 120 chars
- Keywords: Max 100 chars, comma-separated
- Optional: Short OpenGraph and Twitter metadata (same length limits)

Page context: ${JSON.stringify(inputData)}`
      }],
      { output: metadataSchema }
    );
    return response.object;
  }
});

// Define validation step
const validateMetadata = createStep({
  id: 'validateMetadata',
  inputSchema: metadataSchema,
  outputSchema: metadataSchema,
  execute: async ({ inputData }) => {
    // The input is already validated against the schema by the workflow engine.
    // This step can be used for additional, more complex validation logic if needed.
    return inputData;
  }
});

// Create and export the workflow
export const seoWorkflow = createWorkflow({
  id: 'seo-metadata',
  inputSchema: triggerSchema,
  outputSchema: metadataSchema
})
.then(generateMetadata)
.then(validateMetadata)
.commit();
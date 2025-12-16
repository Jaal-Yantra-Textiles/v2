// @ts-nocheck - Ignore all TypeScript errors in this file
import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod/v4";
import { productDescriptionAgent } from "../../agents";
import { PinoLogger } from "@mastra/loggers";

const logger = new PinoLogger();

// 1. Define the input schema for the workflow
const triggerSchema = z.object({
  imageUrl: z.string().url("A valid image URL is required."),
  hint: z.string().optional(),
  productData: z.object({
    designers: z.array(z.string()).optional(),
    modelUsed: z.string().optional(),
    materialType: z.string().optional(),
  }).optional().default({}),
});

// 2. Define the output schema for the AI-generated content
const productDescriptionSchema = z.object({
  title: z.string(),
  description: z.string(),
});

// 4. Create the step to generate the description from the AI agent
const generateDescriptionStep = createStep({
  id: 'generateDescription',
  inputSchema: triggerSchema,
  outputSchema: productDescriptionSchema,
  execute: async ({ inputData }) => {
    const { imageUrl, productData, hint } = inputData;

    logger.info(`Generating product description for image: ${imageUrl}`);

    const response = await productDescriptionAgent.generate(
      [
        {
          role: "user",
          content: [
            { type: "text", text: `Generate a product title and description. You MUST respond with ONLY a JSON object in this exact format, no other text:\n{"title": "your title here", "description": "your description here"}\n\n${hint ? `Writer hint: ${hint}\n` : ""}Product Details: ${JSON.stringify(productData || {}, null, 2)}` },
            { type: "image_url", imageUrl: { url: imageUrl } },
          ],
        },
      ]
    );

    // Parse JSON from response (handles markdown code blocks)
    let parsed: { title: string; description: string };
    const text = response.text.trim();
    
    try {
      parsed = JSON.parse(text);
    } catch {
      // Try extracting JSON from markdown code blocks
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[1].trim());
      } else {
        // Try to find JSON object in the text
        const objectMatch = text.match(/\{[\s\S]*?"title"[\s\S]*?"description"[\s\S]*?\}/);
        if (objectMatch) {
          parsed = JSON.parse(objectMatch[0]);
        } else {
          throw new Error(`Could not parse JSON from response: ${text.substring(0, 200)}...`);
        }
      }
    }

    return { title: parsed.title, description: parsed.description };
  },
});

// 5. Create a validation step
const validateDescriptionStep = createStep({
  id: 'validateDescription',
  inputSchema: productDescriptionSchema,
  outputSchema: productDescriptionSchema,
  execute: async ({ inputData }) => {
    const { description } = inputData;

    if (description.length < 50) {
        logger.warn(`Generated description is very short (${description.length} characters).`);
    }

    if (description.length > 1000) {
        logger.warn(`Generated description is very long (${description.length} characters).`);
    }

    // Return the validated data
    return inputData;
  },
});

// 6. Create and export the workflow
export const productDescriptionWorkflow = createWorkflow({
    id: 'product-description-generation',
    inputSchema: triggerSchema,
    outputSchema: productDescriptionSchema,
})
.then(generateDescriptionStep)
.then(validateDescriptionStep)
.commit();

export default productDescriptionWorkflow;

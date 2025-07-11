import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { productDescriptionAgent } from "../../agents";
import { PinoLogger } from "@mastra/loggers";

const logger = new PinoLogger();

// 1. Define the input schema for the workflow
const triggerSchema = z.object({
  imageUrl: z.string().url("A valid image URL is required."),
  productData: z.object({
    designers: z.array(z.string()).optional(),
    modelUsed: z.string().optional(),
    materialType: z.string().optional(),
  }),
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
    const { imageUrl, productData } = inputData;

    logger.info(`Generating product description for image: ${imageUrl}`);

    const response = await productDescriptionAgent.generate(
      [
        {
          role: "user",
          content: [
            { type: "text", text: `Generate a compelling product title and description based on the provided image and product details. Product Details: ${JSON.stringify(productData, null, 2)}` },
            { type: "image", image: new URL(imageUrl) },
          ],
        },
      ],
      { output: productDescriptionSchema }
    );

    return response.object;
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

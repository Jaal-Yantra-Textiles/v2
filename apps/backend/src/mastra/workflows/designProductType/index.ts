// @ts-nocheck - Ignore all TypeScript errors in this file
import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { designAgent } from "../../agents";
import { PinoLogger } from "@mastra/loggers";

const logger = new PinoLogger();

/**
 * Infer a design's garment TYPE (#938) — "trousers", "saree", "kurta".
 *
 * This is deliberately the narrowest possible ask of a model: one word, from
 * text a designer already wrote. It is NOT design generation (see
 * designValidator) — the design already exists and we are classifying it, so
 * everything the model needs is in the prompt and nothing it returns is
 * allowed to reach the record unnormalised.
 *
 * `confidence` is returned so the caller may refuse a guess. A model asked to
 * name a garment will always name one; the useful signal is how sure it is.
 */
const triggerSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  designer_notes: z.string().optional(),
});

const productTypeSchema = z.object({
  /**
   * A single lowercase garment noun, underscore-separated. The caller
   * normalises again regardless — a schema states an intention, it does not
   * enforce one on a generative model.
   */
  product_type: z.string(),
  /** 0-1. Below the caller's floor, the inference is discarded. */
  confidence: z.number().min(0).max(1),
  /** One short line a human can read when checking a provisional type. */
  reasoning: z.string().optional(),
});

const inferProductType = createStep({
  id: "inferProductType",
  inputSchema: triggerSchema,
  outputSchema: productTypeSchema,
  execute: async ({ inputData }) => {
    const { name, description, tags, designer_notes } = inputData;

    logger.info(`Inferring garment type for design: ${name}`);

    const response = await designAgent.generate(
      [
        {
          role: "user",
          content: `Classify this textile design into a single garment type.

Design name: ${name}
${description ? `Description: ${description}` : ""}
${tags?.length ? `Tags: ${tags.join(", ")}` : ""}
${designer_notes ? `Designer notes: ${designer_notes}` : ""}

Return:
1. product_type — ONE garment category as a single lowercase noun, using
   underscores for multi-word types. Examples: trousers, shirt, saree, kurta,
   palazzo, dupatta, blouse, jacket, scarf, stole, cushion_cover, table_runner.
   Name the garment, not the fabric, the technique, or the collection: a
   "handwoven pashmina stole" is a "stole", not "pashmina" and not "handloom".
2. confidence — 0 to 1, how certain you are. Be honest and use low values: if
   the text describes fabric or motif without saying what is made from it, you
   do not know, and a confident wrong type is worse than none.
3. reasoning — one short sentence naming the words you classified from.`,
        },
      ],
      { output: productTypeSchema }
    );

    return response.object;
  },
});

export const designProductTypeWorkflow = createWorkflow({
  id: "designProductTypeWorkflow",
  inputSchema: triggerSchema,
  outputSchema: productTypeSchema,
})
  .then(inferProductType)
  .commit();

export default designProductTypeWorkflow;

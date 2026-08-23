// @ts-nocheck - Ignore all TypeScript errors in this file
import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { designAgent } from "../../agents";
import { PinoLogger } from "@mastra/loggers";
import { parseInferredProductType } from "../../../modules/designs/lib/product-type";
import {
  generateStructuredWithCloudflare,
  isCloudflareAiConfigured,
} from "../../../lib/ai/cloudflare-structured";

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
  reasoning: z.string().nullable().optional(),
});

const inferProductType = createStep({
  id: "inferProductType",
  inputSchema: triggerSchema,
  outputSchema: productTypeSchema,
  execute: async ({ inputData }) => {
    const { name, description, tags, designer_notes } = inputData;

    logger.info(`Inferring garment type for design: ${name}`);

    const prompt = `Classify this textile design into a single garment type.

Design name: ${name}
${description ? `Description: ${description}` : ""}
${tags?.length ? `Tags: ${tags.join(", ")}` : ""}
${designer_notes ? `Designer notes: ${designer_notes}` : ""}

Reply with ONLY a JSON object and nothing else — no prose, no markdown, no
code fences:

{"product_type": "...", "confidence": 0.0, "reasoning": "..."}

Fields:
1. product_type — ONE garment category as a single lowercase noun, using
   underscores for multi-word types. Examples: trousers, shirt, saree, kurta,
   palazzo, dupatta, blouse, jacket, scarf, stole, cushion_cover, table_runner.
   Name the garment, not the fabric, the technique, or the collection: a
   "handwoven pashmina stole" is a "stole", not "pashmina" and not "handloom".
2. confidence — 0 to 1, how certain you are. Be honest and use low values: if
   the text describes fabric or motif without saying what is made from it, you
   do not know, and a confident wrong type is worse than none.
3. reasoning — one short sentence naming the words you classified from.`;

    // ── Tier 1: Cloudflare Workers AI ───────────────────────────────────
    // Measured, not assumed: four Workers AI models were probed and all four
    // returned clean schema-conforming JSON, where the OpenRouter free pool
    // returned prose. Classification is exactly what a small model is for, so
    // this is both the more reliable and the cheaper answer.
    if (isCloudflareAiConfigured()) {
      const cf = await generateStructuredWithCloudflare({
        prompt,
        schema: {
          type: "object",
          properties: {
            product_type: { type: "string" },
            confidence: { type: "number" },
            reasoning: { type: "string" },
          },
          required: ["product_type", "confidence"],
        },
        logger,
      });

      if (cf) {
        // Still routed through the tolerant parser rather than trusted whole:
        // a model that answers in prose despite a schema is precisely the
        // failure this whole path exists to survive.
        const parsed = parseInferredProductType(
          typeof cf.value === "string"
            ? { text: cf.value }
            : { object: cf.value }
        );
        if (parsed) {
          logger.info(`Garment type via Cloudflare (${cf.model}): ${parsed.product_type}`);
          return parsed;
        }
        logger.warn(`Cloudflare (${cf.model}) gave no usable type; falling back to the agent`);
      }
    }

    // ── Tier 2: the Mastra agent on the free OpenRouter pool ─────────────
    const response = await designAgent.generate(
      [{ role: "user", content: prompt }],
      { output: productTypeSchema }
    );

    // 🔴 Do NOT read `response.object` directly. `designAgent` runs on
    // `dynamicFreeTextModel`, which picks a FREE OpenRouter model, and several
    // of those ignore structured output entirely: on `stealth/ox-alpha` the
    // answer was correct but arrived as markdown prose in `response.text` with
    // `response.object` UNDEFINED, so `.object.product_type` threw on every
    // call. Found by running this against the real model — the integration
    // tests short-circuit it and could never have shown it.
    const parsed = parseInferredProductType({
      object: (response as any)?.object,
      text: (response as any)?.text,
    });

    if (!parsed) {
      throw new Error(
        `Could not read a garment type from the model response: ${String(
          (response as any)?.text ?? ""
        ).slice(0, 200)}`
      );
    }

    return parsed;
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

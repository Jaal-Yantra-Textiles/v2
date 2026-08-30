// @ts-nocheck - Ignore all TypeScript errors in this file
import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";
import {
  createTextileAgentWithModel,
  getTextileFallbackModels,
  isRateLimitError,
  sleep,
  MAX_RETRIES,
  INITIAL_RETRY_DELAY_MS,
  MAX_RETRY_DELAY_MS,
} from "../../agents/textileExtractionAgent";
import { PinoLogger } from "@mastra/loggers";
import { readModelJsonOrThrow } from "../../../lib/ai/model-json";

const logger = new PinoLogger();

// Input schema for the workflow
export const triggerSchema = z.object({
  image_url: z
    .string()
    .refine(
      (s) => {
        if (!s) return false;
        if (s.startsWith("data:")) {
          const allowed = ["image/png", "image/jpeg", "image/webp", "image/gif"];
          const mime = s.slice(5, s.indexOf(";")) || "";
          return allowed.includes(mime);
        }
        try {
          new URL(s);
          return true;
        } catch {
          return false;
        }
      },
      { message: "image_url must be a valid URL or a data URI of type png/jpeg/webp/gif" }
    ),
  hints: z.array(z.string()).optional().default([]),
  gender: z.enum(["female", "male", "unisex"]).optional().default("unisex"),
  threadId: z.string().optional(),
  resourceId: z.string().optional(),
});

// ─────────────────────────────────────────────────────────────
// Visual observations — the FEEDBACK-ORIENTED first pass.
// Describes ONLY what is visible in the image. No inference,
// no e-commerce fields. This becomes ground truth for pass 2.
// ─────────────────────────────────────────────────────────────
export const visualObservationsSchema = z.object({
  visible_colors: z
    .array(z.string())
    .optional()
    .default([])
    .describe("Every color visibly present, be specific e.g. 'navy blue', 'off-white'"),
  visible_pattern: z
    .string()
    .nullable()
    .optional()
    .describe("Surface pattern as seen: solid, stripes, checks, floral, ikat, block-print, abstract… or null"),
  pattern_description: z
    .string()
    .nullable()
    .optional()
    .describe("One or two sentences describing how the pattern looks (scale, repeat, placement)"),
  design_elements: z
    .array(z.string())
    .optional()
    .default([])
    .describe("Observable design details: motifs, embroidery, borders, seams, buttons, zippers, tassels, prints"),
  fabric: z
    .object({
      type_idea: z
        .string()
        .nullable()
        .optional()
        .describe("Best guess of fabric family from visual cues only (e.g. 'cotton-like', 'silk sheen')"),
      texture: z.string().nullable().optional().describe("Visible texture: matte, glossy, slubbed, ribbed, woven, knit…"),
      weave_or_knit: z.string().nullable().optional().describe("Visible weave/knit structure if discernible"),
      perceived_weight: z
        .string()
        .nullable()
        .optional()
        .describe("Visual weight impression: lightweight/drapey, medium, heavyweight/structured"),
      finish: z.string().nullable().optional().describe("Visible finish: sheen, washed, raw edge, printed, dyed…"),
    })
    .optional(),
  visible_item: z
    .string()
    .nullable()
    .optional()
    .describe("What the item physically appears to be, described from what is seen (e.g. 'long tunic with side slits')"),
  visible_text: z
    .array(z.string())
    .optional()
    .default([])
    .describe("Any text visible in the image: labels, tags, watermarks, brand marks"),
  shot_type: z
    .string()
    .nullable()
    .optional()
    .describe("Framing as seen: full body, half body, flat lay, close-up detail, mannequin"),
  not_visible_or_uncertain: z
    .array(z.string())
    .optional()
    .default([])
    .describe("Things that CANNOT be seen or confirmed (e.g. 'fabric composition not visible', 'no tag visible')"),
});

export type VisualObservations = z.infer<typeof visualObservationsSchema>;

// Raw face details — internal use only, never shown to customers
const faceRawSchema = z
  .object({
    estimated_age_range: z.string().nullable().optional(),
    skin_tone: z.string().nullable().optional(),
    hair_color: z.string().nullable().optional(),
    hair_style: z.string().nullable().optional(),
    eye_color: z.string().nullable().optional(),
    facial_features: z.array(z.string()).optional().default([]),
  })
  .nullable()
  .optional();

// Raw body details — internal use only
const bodyRawSchema = z
  .object({
    body_type: z.string().nullable().optional(),
    estimated_height: z.string().nullable().optional(),
    pose: z.string().nullable().optional(),
    skin_tone: z.string().nullable().optional(),
  })
  .nullable()
  .optional();

// Overall model/shot characteristics — internal use only
const modelCharacteristicsSchema = z
  .object({
    gender_presentation: z.string().nullable().optional(),
    styling: z.string().nullable().optional(),
    overall_vibe: z.string().nullable().optional(),
    shot_type: z.string().nullable().optional(),
  })
  .nullable()
  .optional();

// Output schema for textile product extraction
export const textileProductSchema = z.object({
  // ── Garment / product catalog fields ─────────────────────────
  title: z.string(),
  description: z.string(),
  designer: z.string().nullable().optional(),
  model_name: z.string().nullable().optional(),
  cloth_type: z.string().nullable().optional(),
  pattern: z.string().nullable().optional(),
  fabric_weight: z.string().nullable().optional(),
  care_instructions: z.array(z.string()).optional().default([]),
  season: z.array(z.string()).optional().default([]),
  occasion: z.array(z.string()).optional().default([]),
  colors: z.array(z.string()).optional().default([]),
  category: z.string().nullable().optional(),
  suggested_price: z
    .object({
      amount: z.number(),
      currency: z.string().default("USD"),
    })
    .nullable()
    .optional(),
  seo_keywords: z.array(z.string()).optional().default([]),
  target_audience: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1).optional(),

  // ── Visual observations from the feedback-oriented first pass ─
  visual_observations: visualObservationsSchema.nullable().optional(),

  // ── Raw internal fields — NOT for customer display ────────────
  face_raw: faceRawSchema,
  body_raw: bodyRawSchema,
  model_characteristics: modelCharacteristicsSchema,
});

export type TextileProductExtractionInput = z.infer<typeof triggerSchema>;
export type TextileProductExtractionOutput = z.infer<typeof textileProductSchema>;

// Helper to infer MIME type from URL
const inferMime = (u: string): string => {
  try {
    const lower = u.toLowerCase();
    if (lower.startsWith("data:")) {
      const semi = lower.indexOf(";");
      return lower.slice(5, semi >= 0 ? semi : undefined);
    }
    if (lower.endsWith(".png")) return "image/png";
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
    if (lower.endsWith(".webp")) return "image/webp";
    if (lower.endsWith(".gif")) return "image/gif";
  } catch {}
  return "";
};

// Prepares an image URL/data-URI for the agent (download + sniff mime)
const prepareImageForAgent = async (image_url: string): Promise<{ image: string; mimeType: string }> => {
  let imageForAgent = image_url;
  let mimeType = inferMime(image_url);

  if (image_url.startsWith("http")) {
    try {
      const resp = await fetch(image_url);
      const buf = Buffer.from(await resp.arrayBuffer());

      const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
      const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
      const isGif = buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38;
      const isWebp =
        buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP";

      if (isPng) mimeType = "image/png";
      else if (isJpeg) mimeType = "image/jpeg";
      else if (isGif) mimeType = "image/gif";
      else if (isWebp) mimeType = "image/webp";
      else {
        const ct = resp.headers.get("content-type") || "";
        if (ct.startsWith("image/")) mimeType = ct.split(";")[0].trim();
      }

      const b64 = buf.toString("base64");
      imageForAgent = `data:${mimeType};base64,${b64}`;
    } catch (err) {
      logger.warn(`[TextileExtraction] Failed to fetch image, using URL directly: ${err}`);
    }
  }

  if (!mimeType) mimeType = "image/jpeg";
  return { image: imageForAgent, mimeType };
};

/**
 * Runs a schema-constrained vision call across the fallback model ladder
 * with retry/backoff on rate limits. Shared by every extraction pass.
 */
const runVisionExtraction = async <T>(
  label: string,
  messages: any[],
  outputSchema: any,
  context?: { threadId?: string; resourceId?: string }
): Promise<T> => {
  const availableModels = await getTextileFallbackModels();
  logger.info(`[${label}] Available vision models: ${availableModels.slice(0, 5).join(", ")}`);

  const stableResourceId =
    context?.resourceId && !String(context.resourceId).startsWith("textile-extraction:http")
      ? context.resourceId
      : `textile-extraction:${label}`;

  let lastError: any = null;
  let modelIndex = 0;

  while (modelIndex < availableModels.length) {
    const currentModel = availableModels[modelIndex];
    let retryCount = 0;

    while (retryCount < MAX_RETRIES) {
      try {
        const agent = await createTextileAgentWithModel(currentModel, false);
        logger.info(`[${label}] Attempting with model: ${currentModel} (attempt ${retryCount + 1})`);

        const response = await agent.generate(messages, {
          output: outputSchema,
        } as any);

        const parsed = readModelJsonOrThrow(response, `${label}(${currentModel})`) as T;
        logger.info(`[${label}] Successfully extracted with model: ${currentModel}`);
        return parsed;
      } catch (error: any) {
        lastError = error;
        const errorMsg = error?.message || String(error);
        logger.warn(`[${label}] Error with model ${currentModel} (attempt ${retryCount + 1}): ${errorMsg}`);

        if (isRateLimitError(error)) {
          retryCount++;
          if (retryCount < MAX_RETRIES) {
            const delay = Math.min(
              INITIAL_RETRY_DELAY_MS * Math.pow(2, retryCount - 1) + Math.random() * 2000,
              MAX_RETRY_DELAY_MS
            );
            logger.info(`[${label}] Rate limited. Waiting ${Math.round(delay / 1000)}s before retry...`);
            await sleep(delay);
          } else {
            logger.warn(`[${label}] Max retries for ${currentModel}. Trying next model...`);
            break;
          }
        } else {
          logger.warn(`[${label}] Non-rate-limit error. Trying next model...`);
          break;
        }
      }
    }

    modelIndex++;
    if (modelIndex < availableModels.length) {
      logger.info(`[${label}] Switching to fallback model: ${availableModels[modelIndex]}`);
    }
  }

  throw new Error(`[${label}] All vision models exhausted. Last error: ${lastError?.message || String(lastError)}`);
};

// ─────────────────────────────────────────────────────────────
// STEP 1 — Observation pass: what is VISIBLE.
// Deliberately does NOT ask for e-commerce fields so the model
// reports what it sees instead of forcing generic answers.
// ─────────────────────────────────────────────────────────────
const observeVisibleFeaturesStep = createStep({
  id: "observeVisibleFeatures",
  inputSchema: triggerSchema,
  outputSchema: visualObservationsSchema,
  execute: async ({ inputData }) => {
    const { image_url, hints } = inputData;

    logger.info(`[TextileObservation] Starting visible-features observation for image: ${image_url.substring(0, 50)}...`);

    const { image: imageForAgent, mimeType } = await prepareImageForAgent(image_url);

    const hintsText =
      hints && hints.length > 0
        ? `\n\nAreas the requester specifically wants observed (still only if visible):\n${hints
            .map((h) => `- ${h}`)
            .join("\n")}`
        : "";

    const prompt = `You are a textile and fashion visual analyst. Look at this image and report ONLY what you can actually SEE.

Do NOT infer e-commerce fields. Do NOT guess prices, target audience, seasons, SEO keywords, or product titles. Do NOT fabricate anything. If something is not visible, put it under "not_visible_or_uncertain" instead of guessing.

Report what is visible:

- **visible_colors**: Every color you can see, be specific ("navy blue", "off-white", "terracotta")
- **visible_pattern**: The surface pattern as seen ("solid", "stripes", "checks", "floral", "ikat", "block-print", "abstract"), or null if plain/uniform
- **pattern_description**: How the pattern looks — scale, repeat, placement, density. Or null.
- **design_elements**: Observable design details — motifs, embroidery, borders, piping, seams, buttons, zippers, tassels, mirror work, prints, trims
- **fabric**: What the fabric LOOKS like (visual idea only, not a lab analysis):
  - type_idea: best visual guess of fabric family ("cotton-like", "silk sheen", "linen-like", "denim", "velvet")
  - texture: matte / glossy / slubbed / ribbed / woven / knit / smooth
  - weave_or_knit: visible weave or knit structure if discernible, else null
  - perceived_weight: lightweight & drapey / medium / heavyweight & structured — based on how it hangs or folds
  - finish: sheen, washed look, raw edges, printed, dyed, embroidered surface
- **visible_item**: What the item physically appears to be, described from what you see ("long tunic with side slits", "folded yardage of printed cloth")
- **visible_text**: Any text visible — labels, tags, watermarks, brand marks. Empty array if none.
- **shot_type**: How the image is framed — full body, half body, flat lay, close-up detail, mannequin
- **not_visible_or_uncertain**: List anything that CANNOT be seen or confirmed ("fabric composition not visible", "no care label visible", "back of garment not visible")
${hintsText}

Return ONLY a valid JSON object. Do not include markdown, commentary, or any text outside the JSON.`;

    const messages = [
      {
        role: "user" as const,
        content: [
          {
            type: "image" as const,
            image: imageForAgent,
            mimeType,
          },
          {
            type: "text" as const,
            text: prompt,
          },
        ],
      },
    ];

    const observations = await runVisionExtraction<VisualObservations>(
      "TextileObservation",
      messages,
      visualObservationsSchema,
      { threadId: inputData.threadId, resourceId: inputData.resourceId }
    );

    return observations;
  },
});

// ─────────────────────────────────────────────────────────────
// STEP 2 — Feedback pass: derive product fields FROM the
// observations. The observation JSON is fed back into the prompt
// as ground truth so derived fields stay anchored to what was
// actually visible rather than generic guesses.
// ─────────────────────────────────────────────────────────────
const deriveProductFieldsStep = createStep({
  id: "deriveProductFields",
  inputSchema: z.object({
    image_url: triggerSchema.shape.image_url,
    hints: z.array(z.string()).optional().default([]),
    gender: z.enum(["female", "male", "unisex"]).optional().default("unisex"),
    threadId: z.string().optional(),
    resourceId: z.string().optional(),
    observations: visualObservationsSchema,
  }),
  outputSchema: textileProductSchema,
  execute: async ({ inputData }) => {
    const { image_url, hints, gender, threadId, resourceId, observations } = inputData;

    logger.info(`[TextileDerivation] Deriving product fields from observations for image: ${image_url.substring(0, 50)}...`);

    const { image: imageForAgent, mimeType } = await prepareImageForAgent(image_url);

    const genderContext =
      gender !== "unisex"
        ? `\nGender context: ${gender} — use this to interpret sizing, fit, and target audience correctly.`
        : "";

    const hintsText =
      hints && hints.length > 0 ? `\n\nAdditional hints:\n${hints.map((h) => `- ${h}`).join("\n")}` : "";

    const observationsText = JSON.stringify(observations, null, 2);

    const prompt = `You are a fashion and textile product expert. A previous observation pass examined this image and recorded ONLY what is visible. That observation record is provided below as GROUND TRUTH.

---
## OBSERVATION RECORD (ground truth — do NOT contradict it)
${observationsText}
---

Using these observations, return a single JSON object with ALL of the following fields. Ground every derived field in the observations. If the observations say something is "not visible or uncertain", leave the dependent field null/empty rather than guessing.

---
## PART 1 — Garment & Product Catalog Data
Extract accurate product information for e-commerce listing:

- **title**: Short, marketable product name (e.g. "Slim-fit Cotton Oxford Shirt") — anchored in what was observed
- **description**: Rich product description (2–3 sentences, mentions fabric feel, fit, styling) — reference observed colors, pattern and fabric
- **designer**: Brand or designer label ONLY if it appears in visible_text or is clearly visible, otherwise null
- **model_name**: Specific model/SKU name if visible, or null
- **cloth_type**: Primary garment type consistent with "visible_item" (e.g. "shirt", "dress", "jacket", "trousers", "fabric")
- **pattern**: Use "visible_pattern" as-is when present, or null
- **fabric_weight**: Use the observed "perceived_weight" ("lightweight", "medium-weight", "heavyweight"), or null if uncertain
- **care_instructions**: Array of care symbols/instructions visible or inferable from the observed fabric — empty if nothing supports them
- **season**: Array of seasons consistent with the observed fabric weight/texture
- **occasion**: Array of occasions consistent with the observed design and styling
- **colors**: Copy "visible_colors" (be specific: "navy blue", "off-white")
- **category**: Broad clothing category ("tops", "bottoms", "outerwear", "dresses", "accessories", "fabric")
- **suggested_price**: Object { amount: number, currency: "USD" } based on observed quality/design complexity, or null
- **seo_keywords**: Array of 5–10 keywords grounded in observed colors, pattern, fabric and design elements
- **target_audience**: Description of intended customer (e.g. "women aged 25–40, professional")
- **confidence**: Float 0–1 representing extraction confidence${genderContext}
- **visual_observations**: Echo the observation record unchanged

---
## PART 2 — Raw Internal Data (for internal analysis only, NOT shown to customers)
Extract observable characteristics of any person/model visible in the image:

- **face_raw**: If a person's face is visible, extract:
  - estimated_age_range (e.g. "22–28", "30–35"), or null
  - skin_tone (e.g. "fair", "medium-fair", "medium", "medium-dark", "dark"), or null
  - hair_color (e.g. "dark brown", "blonde", "black"), or null
  - hair_style (e.g. "straight long", "curly short", "bun"), or null
  - eye_color (e.g. "brown", "blue", "green"), or null
  - facial_features: array of notable observable features (e.g. ["defined cheekbones"])
  If no face is visible, set face_raw to null.

- **body_raw**: If a person's body is visible, extract:
  - body_type (e.g. "slim", "athletic", "petite", "curvy", "tall-lean"), or null
  - estimated_height (e.g. "tall", "medium", "short") based on proportions, or null
  - pose (e.g. "standing front", "standing side", "sitting", "walking"), or null
  - skin_tone (e.g. "fair", "medium", "dark"), or null
  If no body is visible, set body_raw to null.

- **model_characteristics**: Overall shot/styling context:
  - gender_presentation (e.g. "feminine", "masculine", "androgynous"), or null
  - styling (e.g. "editorial high-fashion", "casual street", "clean minimalist"), or null
  - overall_vibe (e.g. "luxury", "sporty", "bohemian", "classic"), or null
  - shot_type: use the observed "shot_type", or null
  If no model is in the image (e.g. flat lay), set non-applicable fields to null.${hintsText}

---
Return ONLY a valid JSON object. Do not include markdown, commentary, or any text outside the JSON.`;

    const messages = [
      {
        role: "user" as const,
        content: [
          {
            type: "image" as const,
            image: imageForAgent,
            mimeType,
          },
          {
            type: "text" as const,
            text: prompt,
          },
        ],
      },
    ];

    const product = await runVisionExtraction<TextileProductExtractionOutput>(
      "TextileDerivation",
      messages,
      textileProductSchema,
      { threadId, resourceId }
    );

    return product;
  },
});

// Step to validate and normalize extraction results
const validateExtractionStep = createStep({
  id: "validateTextileExtraction",
  inputSchema: textileProductSchema,
  outputSchema: textileProductSchema,
  execute: async ({ inputData }) => {
    logger.info(`[TextileExtraction] Validating extraction results...`);

    const normalized: TextileProductExtractionOutput = {
      // Garment fields
      title: inputData.title || "Untitled Product",
      description: inputData.description || "",
      designer: inputData.designer || null,
      model_name: inputData.model_name || null,
      cloth_type: inputData.cloth_type || null,
      pattern: inputData.pattern || null,
      fabric_weight: inputData.fabric_weight || null,
      care_instructions: Array.isArray(inputData.care_instructions) ? inputData.care_instructions : [],
      season: Array.isArray(inputData.season) ? inputData.season : [],
      occasion: Array.isArray(inputData.occasion) ? inputData.occasion : [],
      colors: Array.isArray(inputData.colors) ? inputData.colors : [],
      category: inputData.category || null,
      suggested_price: inputData.suggested_price
        ? {
            amount: Number(inputData.suggested_price.amount) || 0,
            currency: inputData.suggested_price.currency || "USD",
          }
        : null,
      seo_keywords: Array.isArray(inputData.seo_keywords) ? inputData.seo_keywords : [],
      target_audience: inputData.target_audience || null,
      confidence:
        typeof inputData.confidence === "number"
          ? Math.max(0, Math.min(1, inputData.confidence))
          : undefined,

      // Visual observations — normalize but keep as-is (feedback trail)
      visual_observations: inputData.visual_observations
        ? {
            visible_colors: Array.isArray(inputData.visual_observations.visible_colors)
              ? inputData.visual_observations.visible_colors
              : [],
            visible_pattern: inputData.visual_observations.visible_pattern || null,
            pattern_description: inputData.visual_observations.pattern_description || null,
            design_elements: Array.isArray(inputData.visual_observations.design_elements)
              ? inputData.visual_observations.design_elements
              : [],
            fabric: inputData.visual_observations.fabric
              ? {
                  type_idea: inputData.visual_observations.fabric.type_idea || null,
                  texture: inputData.visual_observations.fabric.texture || null,
                  weave_or_knit: inputData.visual_observations.fabric.weave_or_knit || null,
                  perceived_weight: inputData.visual_observations.fabric.perceived_weight || null,
                  finish: inputData.visual_observations.fabric.finish || null,
                }
              : undefined,
            visible_item: inputData.visual_observations.visible_item || null,
            visible_text: Array.isArray(inputData.visual_observations.visible_text)
              ? inputData.visual_observations.visible_text
              : [],
            shot_type: inputData.visual_observations.shot_type || null,
            not_visible_or_uncertain: Array.isArray(inputData.visual_observations.not_visible_or_uncertain)
              ? inputData.visual_observations.not_visible_or_uncertain
              : [],
          }
        : null,

      // Raw internal fields — normalize but keep as-is
      face_raw: inputData.face_raw
        ? {
            estimated_age_range: inputData.face_raw.estimated_age_range || null,
            skin_tone: inputData.face_raw.skin_tone || null,
            hair_color: inputData.face_raw.hair_color || null,
            hair_style: inputData.face_raw.hair_style || null,
            eye_color: inputData.face_raw.eye_color || null,
            facial_features: Array.isArray(inputData.face_raw.facial_features) ? inputData.face_raw.facial_features : [],
          }
        : null,
      body_raw: inputData.body_raw
        ? {
            body_type: inputData.body_raw.body_type || null,
            estimated_height: inputData.body_raw.estimated_height || null,
            pose: inputData.body_raw.pose || null,
            skin_tone: inputData.body_raw.skin_tone || null,
          }
        : null,
      model_characteristics: inputData.model_characteristics
        ? {
            gender_presentation: inputData.model_characteristics.gender_presentation || null,
            styling: inputData.model_characteristics.styling || null,
            overall_vibe: inputData.model_characteristics.overall_vibe || null,
            shot_type: inputData.model_characteristics.shot_type || null,
          }
        : null,
    };

    if (!normalized.title || normalized.title === "Untitled Product") {
      logger.warn("[TextileExtraction] Missing product title");
    }
    if (!normalized.description) {
      logger.warn("[TextileExtraction] Missing product description");
    }
    if (normalized.colors.length === 0) {
      logger.warn("[TextileExtraction] No colors identified");
    }

    logger.info(`[TextileExtraction] Validation complete. Confidence: ${normalized.confidence || "N/A"}`);
    return normalized;
  },
});

// Create and export the workflow
// Observation pass first (what is visible), then the observations are
// fed back into the product-field derivation pass (feedback-oriented).
export const textileProductExtractionWorkflow = createWorkflow({
  id: "textile-product-extraction",
  inputSchema: triggerSchema,
  outputSchema: textileProductSchema,
})
  .then(observeVisibleFeaturesStep)
  .map(async ({ inputData, getInitData }) => {
    // inputData = observations from the visible-features pass.
    // getInitData() = the original trigger input (image URL, hints, gender).
    const init = getInitData() as TextileProductExtractionInput;
    return {
      image_url: init.image_url,
      hints: init.hints || [],
      gender: init.gender || "unisex",
      threadId: init.threadId,
      resourceId: init.resourceId,
      observations: inputData,
    };
  })
  .then(deriveProductFieldsStep)
  .then(validateExtractionStep)
  .commit();

export default textileProductExtractionWorkflow;

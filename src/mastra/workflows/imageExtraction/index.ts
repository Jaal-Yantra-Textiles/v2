// @ts-nocheck - Ignore all TypeScript errors in this file
import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod/v4";
import { createImageExtractionAgent } from "../../agents";

// Trigger: image to analyze and optional entity type
export const triggerSchema = z.object({
  image_url: z
    .string()
    .refine((s) => {
      if (!s) return false
      if (s.startsWith("data:")) {
        const allowed = ["image/png", "image/jpeg", "image/webp", "image/gif"]
        const mime = s.slice(5, s.indexOf(";")) || ""
        return allowed.includes(mime)
      }
      try { new URL(s); return true } catch { return false }
    }, { message: "image_url must be a valid URL or a data URI of type png/jpeg/webp/gif" }),
  entity_type: z.enum(["raw_material", "inventory_item"]).default("raw_material"),
  notes: z.string().optional(),
  // Optional memory context
  threadId: z.string().optional(),
  resourceId: z.string().optional(),
});

// Item structure extracted from the image
export const itemSchema = z.object({
  name: z.string(),
  quantity: z.number().nonnegative(),
  unit: z.string().optional(),
  sku: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  metadata: z.record(z.any()).optional(),
});

export const extractionResultSchema = z.object({
  entity_type: z.string(),
  items: z.array(itemSchema).default([]),
  summary: z.string().optional(),
});

// Step: Ask the vision-capable agent to extract structured data
const extractItems = createStep({
  id: "extractItems",
  inputSchema: triggerSchema,
  outputSchema: extractionResultSchema,
  execute: async ({ inputData }) => {
    const system =
      "Extract a structured list of items from the provided image. " +
      "Return JSON that matches the output schema. " +
      "If uncertain about an item, estimate conservatively and include a confidence field.";

    // Use structured multimodal content (image + text)
    const imageRef = inputData.image_url
    const inferMime = (u: string): string => {
      try {
        const lower = u.toLowerCase()
        if (lower.startsWith("data:")) {
          const semi = lower.indexOf(";")
          return lower.slice(5, semi >= 0 ? semi : undefined)
        }
        if (lower.endsWith(".png")) return "image/png"
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg"
        if (lower.endsWith(".webp")) return "image/webp"
        if (lower.endsWith(".gif")) return "image/gif"
      } catch {}
      return ""
    }
    let mimeType = inferMime(imageRef)
    if (!mimeType && imageRef.startsWith("http")) {
      try {
        const head = await fetch(imageRef, { method: "HEAD" })
        const ct = head.headers.get("content-type") || head.headers.get("Content-Type") || ""
        if (ct && ct.startsWith("image/")) {
          mimeType = ct.split(";")[0].trim()
        }
      } catch {}
    }
    if (!mimeType) mimeType = "image/jpeg"

    // Ensure provider receives an embeddable image
    let imageForAgent = imageRef
    if (imageRef.startsWith("http")) {
      try {
        const resp = await fetch(imageRef)
        let ct = resp.headers.get("content-type") || resp.headers.get("Content-Type") || ""
        const buf = Buffer.from(await resp.arrayBuffer())
        // Detect from magic bytes
        const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47
        const isJpeg = buf[0] === 0xFF && buf[1] === 0xD8 && buf[buf.length - 2] === 0xFF && buf[buf.length - 1] === 0xD9
        const isGif = buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38
        const isWebp = buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP"
        if (isPng) mimeType = "image/png"
        else if (isJpeg) mimeType = "image/jpeg"
        else if (isGif) mimeType = "image/gif"
        else if (isWebp) mimeType = "image/webp"
        else if (ct && ct.startsWith("image/")) mimeType = (ct.split(";")[0].trim())
        const b64 = buf.toString("base64")
        imageForAgent = `data:${mimeType};base64,${b64}`
      } catch {}
    }
    console.log(mimeType)
    // Coerce resourceId to a stable constant to avoid URL-derived IDs
    const stableResourceId = inputData.resourceId && !String(inputData.resourceId).startsWith('image-extraction:http')
      ? inputData.resourceId
      : 'image-extraction:inventory-extraction'
      console.log(stableResourceId)

    // Create agent with dynamically selected best free vision model
    const agent = await createImageExtractionAgent();

    const response = await agent.generate(
      [
        {
          role: "user",
          content: [
            { type: "image", image: imageForAgent, mimeType },
            {
              type: "text",
              text:
                `You are given an inventory image.\n` +
                `Entity Type: ${inputData.entity_type}\n` +
                `Notes: ${inputData.notes || ""}\n\n` +
                `Extract a structured list of items from the image. Return JSON that matches the schema: ` +
                `{ entity_type: string, items: Array<{ name: string, quantity: number, unit?: string, sku?: string, confidence?: number, metadata?: object }>, summary?: string }.`,
            },
          ],
        },
      ],
      {
        output: extractionResultSchema,
        // Pass through optional memory context
        threadId: inputData.threadId,
        resourceId: stableResourceId,
      } as any
    )

    // Widen and normalize possible shapes
    const raw: any = response.object || {}
    const candidateLists = [
      raw.items,
      raw.list,
      raw.list_of_items,
      raw.item_list,
      raw.products,
      raw.entries,
      raw.inventory,
    ].find((v) => Array.isArray(v) && v.length)

    const normalizeItem = (it: any) => {
      if (!it || typeof it !== "object") return null
      const name = it.name || it.title || it.item || it.product || it.material || ""
      const qty = it.quantity ?? it.qty ?? it.count ?? it.amount ?? it.quantity_value
      const unit = it.unit || it.units || it.uom || it.measure || undefined
      const sku = it.sku || it.code || undefined
      const confidence = it.confidence
      const metadata = it.metadata || it.meta || undefined
      if (!name && qty == null) return null
      return {
        name,
        quantity: typeof qty === "number" ? qty : Number(qty) || 0,
        unit,
        sku,
        confidence,
        metadata,
      }
    }

    const items = (candidateLists || []).map(normalizeItem).filter(Boolean)

    const object = {
      entity_type: inputData.entity_type,
      items: items.length ? items : (raw.items || []),
      summary: raw.summary,
    }

    console.log("[mastra:imageExtraction] extractItems output:", JSON.stringify(object, null, 2))
    return object
  },
});

// Step: Extra validations/normalizations
const validateExtraction = createStep({
  id: "validateExtraction",
  inputSchema: extractionResultSchema,
  outputSchema: extractionResultSchema,
  execute: async ({ inputData }) => {
    const normalized = {
      ...inputData,
      items: (inputData.items || []).map((i) => ({
        ...i,
        quantity: typeof i.quantity === "number" ? i.quantity : Number(i.quantity) || 0,
        unit: i.unit || undefined,
      })),
    };
    console.log("[mastra:imageExtraction] validateExtraction normalized:", JSON.stringify(normalized, null, 2));
    return normalized;
  },
});

// Compose workflow
export const imageExtractionWorkflow = createWorkflow({
  id: "image-extraction",
  inputSchema: triggerSchema,
  outputSchema: extractionResultSchema,
})
  .then(extractItems)
  .then(validateExtraction)
  .commit();

/**
 * Design catalog tools for the shop's chat-based design editor.
 *
 * Companions to the concierge tools that let the designer-guide walk a maker
 * through the design flow:
 *   - list_raw_materials   — "what fabrics do we have?" (design-selectable inventory)
 *   - list_partners        — "who can make this?" (verified production partners)
 *   - analyze_product_image— "what do you see in this garment?" (vision analysis →
 *                            design suggestions, analysis-first flow)
 *
 * Same container-bound factory pattern as storefront-catalog-tools: in-process
 * via the MedusaContainer (no HTTP hop), store shapes the chat UI renders.
 */
import type { MedusaContainer } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { tool } from "ai"
import { z } from "zod"
import { describeProductImageWorkflow } from "../../../workflows/ai/describe-product-image"
import RawMaterialInventoryLink from "../../../links/raw-material-data-inventory"

// ── list_raw_materials ─────────────────────────────────────────────────

export type AgentRawMaterialHit = {
  id: string
  name: string | null
  color: string | null
  composition: string | null
  thumbnail: string | null
  category: string | null
  inventory_item_id: string | null
  sku: string | null
}

export const runListRawMaterials = async (
  container: MedusaContainer,
  q?: string,
  limit = 20
): Promise<{ materials: AgentRawMaterialHit[]; count: number }> => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  // Reuse the store API's inventory-with-raw-material join (same entry point
  // as getAllInventoryWithRawMaterial — materials are design-selectable
  // through their inventory item). Medusa v2 graph cannot filter on linked
  // entity properties, so `q` post-filters app-side (same as the helper).
  const { data } = await query.graph({
    entity: RawMaterialInventoryLink.entryPoint,
    fields: ["*", "raw_materials.*", "inventory_item.*"],
  } as any)

  const rows = data || []
  const needle = typeof q === "string" ? q.toLowerCase().trim() : ""
  const searched = needle
    ? rows.filter((row: any) => {
        const raw = row.raw_materials
        const inv = row.inventory_item
        return [raw?.name, raw?.color, raw?.composition, raw?.material_type?.name, raw?.material_type?.category, inv?.title, inv?.sku]
          .some((v: any) => typeof v === "string" && v.toLowerCase().includes(needle))
      })
    : rows

  const materials: AgentRawMaterialHit[] = searched
    .filter((item: any) => item.raw_materials)
    .map((item: any) => {
      const raw = item.raw_materials
      let mediaArray: any[] = []
      const rawMedia = raw?.media
      if (rawMedia?.files && Array.isArray(rawMedia.files)) {
        mediaArray = rawMedia.files
      } else if (Array.isArray(rawMedia)) {
        mediaArray = rawMedia
      }
      const thumbnail =
        mediaArray.find((m: any) => m?.isThumbnail)?.url ||
        mediaArray[0]?.url ||
        (typeof mediaArray[0] === "string" ? mediaArray[0] : null) ||
        null

      return {
        id: raw.id,
        name: raw.name ?? null,
        color: raw.color ?? null,
        composition: raw.composition ?? null,
        thumbnail,
        category: raw.material_type?.category ?? raw.material_type?.name ?? null,
        inventory_item_id: item.inventory_item?.id ?? null,
        sku: item.inventory_item?.sku ?? null,
      }
    })

  return { materials: materials.slice(0, limit), count: searched.filter((item: any) => item.raw_materials).length }
}

const ListMaterialsSchema = z.object({
  q: z
    .string()
    .max(120)
    .optional()
    .describe("Search filter — fabric name, composition ('cotton'), or color ('indigo'). Omit to browse (a short list is returned)."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(6)
    .describe("How many to return. Keep it small (6 is good) unless the maker asks to see more."),
})

export const createListRawMaterialsTool = (container: MedusaContainer) =>
  tool({
    description:
      "List a handful of fabrics / raw materials from inventory, with composition, color and a swatch. Call when the maker is choosing material — render fabric chips. Use q to filter; keep the list SHORT (default 6) and only return more when the maker explicitly asks to see all fabrics.",
    inputSchema: ListMaterialsSchema,
    execute: async (args) => runListRawMaterials(container, args.q, args.limit),
  })

// ── list_partners ──────────────────────────────────────────────────────

export type AgentPartnerHit = {
  id: string
  name: string | null
  company_name: string | null
  logo: string | null
  description: string | null
  /** Friendly role along the production path. */
  path: string | null
  /** Raw workspace_type (seller | manufacturer | designer | individual). */
  workspace_type: string | null
}

/**
 * The production "path" each partner sits on. Fabric Sellers source the
 * material; Manufacturers cut & sew it; Designers author; individuals are
 * independent makers. The designer-guide walks these in order.
 */
const PARTNER_PATH_LABELS: Record<string, string> = {
  seller: "Fabric Seller",
  manufacturer: "Manufacturer",
  designer: "Designer",
  individual: "Independent maker",
}

export const runListPartners = async (
  container: MedusaContainer,
  q?: string,
  limit = 20
): Promise<{ partners: AgentPartnerHit[]; count: number }> => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "partner",
    filters: { status: "active", is_verified: true },
    fields: [
      "id",
      "name",
      "company_name",
      "logo_url",
      "description",
      "workspace_type",
    ],
  } as any)

  const rows = (data || []).map((p: any) => ({
    ...p,
    path: PARTNER_PATH_LABELS[p.workspace_type] ?? p.workspace_type ?? null,
  }))

  let out = rows
  const needle = typeof q === "string" ? q.toLowerCase().trim() : ""
  if (needle) {
    out = rows.filter(
      (p: any) =>
        p.name?.toLowerCase().includes(needle) ||
        p.company_name?.toLowerCase().includes(needle) ||
        p.description?.toLowerCase().includes(needle) ||
        (p.path && String(p.path).toLowerCase().includes(needle)) ||
        (p.workspace_type && String(p.workspace_type).toLowerCase().includes(needle))
    )
  }

  return {
    partners: out.slice(0, limit).map((p: any) => ({
      id: p.id,
      name: p.name ?? null,
      company_name: p.company_name ?? null,
      logo: p.logo_url ?? null,
      description: p.description ?? null,
      path: p.path ?? null,
      workspace_type: p.workspace_type ?? null,
    })),
    count: out.length,
  }
}

const ListPartnersSchema = z.object({
  q: z
    .string()
    .max(120)
    .optional()
    .describe(
      "Optional filter — partner name, role along the path ('fabric seller', 'manufacturer', 'designer'), or material focus ('embroidery', 'handloom'). Omit to browse (a short list is returned)."
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(6)
    .describe("How many to return. Keep it small (6 is good) unless the maker asks to see all partners."),
})

export const createListPartnersTool = (container: MedusaContainer) =>
  tool({
    description:
      "List a handful of VERIFIED production partners across the path — Fabric Sellers (source material), Manufacturers (cut & sew), Designers, and independent makers. Each result carries its `path` role. Use q to filter by role or focus; keep the list SHORT (default 6) and only return more when the maker explicitly asks to see all partners.",
    inputSchema: ListPartnersSchema,
    execute: async (args) => runListPartners(container, args.q, args.limit),
  })

// ── analyze_product_image ──────────────────────────────────────────────

export type ImageAnalysis = {
  title: string
  description: string
  suggestions: string[]
}

const SUGGESTION_PROMPT = [
  "You analyse a garment photo for a slow-fashion design assistant.",
  "Given the image (and optional maker request), respond with JSON only, no prose:",
  '{ "title": "short garment title, 4-8 words", "description": "2-3 sentences: what the garment is, its construction, palette and mood",',
  '  "suggestions": ["3-5 concrete design directions the maker could explore with this garment as the base, one short sentence each, e.g. re-dye the palette, layer new motifs, vary the silhouette"] }',
  "Ground every observation in what you can see. Never invent measurements or materials.",
].join(" ")

export const runAnalyzeProductImage = async (
  container: MedusaContainer,
  imageUrl: string,
  makerRequest?: string
): Promise<ImageAnalysis> => {
  const { result, errors } = await describeProductImageWorkflow(container as any).run({
    input: {
      imageUrl,
      hint: makerRequest,
      // Design-analysis JSON contract instead of product copy — same vision
      // provider resolution (ai_product_description role).
      system_prompt: SUGGESTION_PROMPT,
    },
  })

  if (errors?.length) {
    throw errors[0]
  }

  return {
    title: (result as any)?.title,
    description: (result as any)?.description,
    suggestions: (result as any)?.suggestions ?? [],
  }
}

const AnalyzeImageSchema = z.object({
  image_url: z.string().url().max(2000).describe("The garment image to analyse."),
  maker_request: z
    .string()
    .max(500)
    .optional()
    .describe("What the maker said they want, so the suggestions are aimed at their ask."),
})

export const createAnalyzeProductImageTool = (container: MedusaContainer) =>
  tool({
    description:
      "Analyse a garment image and suggest concrete design directions. Call this FIRST when the flow starts from an existing product's image — ground your follow-up in the analysis (construction, palette, mood) and present the suggestions so the maker can react.",
    inputSchema: AnalyzeImageSchema,
    execute: async (args) =>
      runAnalyzeProductImage(container, args.image_url, args.maker_request),
  })

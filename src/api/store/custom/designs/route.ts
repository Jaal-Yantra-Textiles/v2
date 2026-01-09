import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import createDesignWorkflow from "../../../../workflows/designs/create-design";
import { linkDesignInventoryWorkflow } from "../../../../workflows/designs/inventory/link-inventory";
import { linkDesignPartnerWorkflow } from "../../../../workflows/designs/partner/link-design-to-partner";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import designCustomerLink from "../../../../links/design-customer-link";

/**
 * Store Design Request Body
 * Allows customers to save their custom designs with optional inventory and partner linking
 */
interface StoreCreateDesignBody {
  // Required design fields
  name: string;
  description?: string;
  
  // Design metadata - stores canvas layers, colors, etc.
  metadata?: {
    layers?: Array<{
      id: string;
      type: "image" | "text";
      x: number;
      y: number;
      width?: number;
      height?: number;
      rotation: number;
      scaleX: number;
      scaleY: number;
      src?: string;
      text?: string;
      fontSize?: number;
      fontFamily?: string;
      fontStyle?: string;
      fill?: string;
      opacity: number;
    }>;
    base_product_id?: string;
    base_product_thumbnail?: string;
    [key: string]: any;
  };
  
  // Optional: thumbnail URL of the final design
  thumbnail_url?: string;
  
  // Optional: inventory items to link (from selected materials)
  inventory_ids?: string[];
  inventory_items?: Array<{
    inventoryId: string;
    plannedQuantity?: number;
    locationId?: string;
    metadata?: Record<string, any>;
  }>;
  
  // Optional: partner to assign for production
  partner_id?: string;
  
  // Design attributes
  color_palette?: Array<{ name: string; code: string }>;
  custom_sizes?: Record<string, Record<string, number>>;
  tags?: string[];
}

/**
 * POST /store/custom/designs
 * 
 * Creates a customer design and optionally links inventory items and partner.
 * This is a combined endpoint that:
 * 1. Creates the design
 * 2. Links inventory items (if provided)
 * 3. Links partner (if provided)
 */
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> {
  try {
    const body = req.body as StoreCreateDesignBody;
    const customerId = req.auth_context?.actor_id;

    if (!customerId) {
      res.status(401).json({ message: "Customer authentication required" });
      return;
    }
    
    // Validate required fields
    if (!body.name) {
      res.status(400).json({ message: "Design name is required" });
      return;
    }

    // Step 1: Create the design
    const designData = {
      name: body.name,
      description: body.description || `Custom design: ${body.name}`,
      design_type: "Custom" as const,
      status: "Conceptual" as const,
      priority: "Medium" as const,
      thumbnail_url: body.thumbnail_url,
      color_palette: body.color_palette,
      custom_sizes: body.custom_sizes,
      tags: body.tags || ["custom", "customer-design"],
      metadata: body.metadata || {},
      origin_source: "manual" as const,
      customer_id_for_link: customerId,
    };

    const { result: designResult, errors: designErrors } = await createDesignWorkflow(req.scope).run({
      input: designData,
    });

    if (designErrors?.length > 0) {
      console.error("[Store] Error creating design:", designErrors);
      res.status(500).json({ 
        message: "Failed to create design",
        errors: designErrors 
      });
      return;
    }

    const designId = designResult.id;
    let linkedInventory: any = null;
    let linkedPartner: any = null;

    // Step 2: Link inventory items (if provided)
    if ((body.inventory_ids && body.inventory_ids.length > 0) || (body.inventory_items && body.inventory_items.length > 0)) {
      try {
        const { result: inventoryResult, errors: inventoryErrors } = await linkDesignInventoryWorkflow(req.scope).run({
          input: {
            design_id: designId,
            inventory_ids: body.inventory_ids,
            inventory_items: body.inventory_items?.map((item) => ({
              inventory_id: item.inventoryId,
              planned_quantity: item.plannedQuantity,
              location_id: item.locationId,
              metadata: item.metadata,
            }))
          },
        });

        if (inventoryErrors?.length > 0) {
          console.warn("[Store] Warning: Failed to link inventory:", inventoryErrors);
        } else {
          linkedInventory = inventoryResult;
        }
      } catch (error) {
        console.warn("[Store] Warning: Failed to link inventory:", error);
      }
    }

    // Step 3: Link partner (if provided)
    if (body.partner_id) {
      try {
        const { result: partnerResult, errors: partnerErrors } = await linkDesignPartnerWorkflow(req.scope).run({
          input: {
            design_id: designId,
            partner_ids: [body.partner_id],
          },
        });

        if (partnerErrors?.length > 0) {
          console.warn("[Store] Warning: Failed to link partner:", partnerErrors);
        } else {
          linkedPartner = partnerResult;
        }
      } catch (error) {
        console.warn("[Store] Warning: Failed to link partner:", error);
      }
    }

    // Fetch the complete design with relations
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
    const { data: designs } = await query.graph({
      entity: "design",
      filters: { id: designId },
      fields: [
        "*",
        "inventory_items.*",
        "partners.*",
      ],
    });

    const design = designs?.[0] || designResult;

    res.status(201).json({
      design,
      linked_inventory: linkedInventory,
      linked_partner: linkedPartner,
    });
  } catch (error) {
    console.error("[Store] Error in design creation:", error);
    res.status(500).json({
      message: "Failed to create design",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

/**
 * GET /store/custom/designs
 *
 * Lists customer designs (filtered by customer if authenticated)
 *
 * Query parameters:
 * - limit: number of designs to return (default: 20)
 * - offset: pagination offset (default: 0)
 * - origin_source: filter by origin source (e.g., "ai-mistral" for AI-generated designs)
 * - include_ai: if "true", only include AI-generated designs (shorthand for origin_source=ai-mistral)
 */
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> {
  try {
    const customerId = req.auth_context?.actor_id;

    if (!customerId) {
      res.status(401).json({ message: "Customer authentication required" });
      return;
    }

    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
    const limit = Number(req.query.limit ?? 20);
    const offset = Number(req.query.offset ?? 0);
    const originSource = req.query.origin_source as string | undefined;
    const includeAi = req.query.include_ai === "true";

    const { data: linkedDesigns } = await query.graph({
      entity: designCustomerLink.entryPoint,
      filters: {
        customer_id: customerId,
      },
      fields: [
        "design.id",
        "design.name",
        "design.description",
        "design.status",
        "design.thumbnail_url",
        "design.metadata",
        "design.media_files",
        "design.origin_source",
        "design.created_at",
        "design.inventory_items.id",
        "design.inventory_items.title",
        "design.partners.id",
        "design.partners.name",
      ],
      pagination: {
        skip: 0,
        take: 1000, // Get all to filter, then paginate
      },
    });

    let allDesigns = (linkedDesigns || []).map((link: any) => link.design).filter(Boolean);

    // Filter by origin_source if provided
    if (originSource) {
      allDesigns = allDesigns.filter((d: any) => d.origin_source === originSource);
    } else if (includeAi) {
      // Shorthand: include_ai=true means origin_source=ai-mistral
      allDesigns = allDesigns.filter((d: any) => d.origin_source === "ai-mistral");
    }

    // Sort by created_at descending (newest first)
    allDesigns.sort((a: any, b: any) => {
      const dateA = new Date(a.created_at || 0).getTime();
      const dateB = new Date(b.created_at || 0).getTime();
      return dateB - dateA;
    });

    const paginated = allDesigns.slice(offset, offset + limit);

    res.status(200).json({
      designs: paginated,
      count: allDesigns.length,
      offset,
      limit,
    });
  } catch (error) {
    console.error("[Store] Error fetching designs:", error);
    res.status(500).json({
      message: "Failed to fetch designs",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

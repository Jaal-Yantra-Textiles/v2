/**
 * @file Store API routes for managing custom designs
 * @description Provides endpoints for creating and listing customer designs in the JYT Commerce platform
 * @module API/Store/Designs
 */

/**
 * @typedef {Object} DesignLayer
 * @property {string} id - Unique identifier for the layer
 * @property {"image" | "text"} type - Type of layer (image or text)
 * @property {number} x - X coordinate position
 * @property {number} y - Y coordinate position
 * @property {number} [width] - Width of the layer
 * @property {number} [height] - Height of the layer
 * @property {number} rotation - Rotation angle in degrees
 * @property {number} scaleX - Horizontal scale factor
 * @property {number} scaleY - Vertical scale factor
 * @property {string} [src] - Source URL for image layers
 * @property {string} [text] - Text content for text layers
 * @property {number} [fontSize] - Font size for text layers
 * @property {string} [fontFamily] - Font family for text layers
 * @property {string} [fontStyle] - Font style for text layers
 * @property {string} [fill] - Fill color for text layers
 * @property {number} opacity - Opacity level (0-1)
 */

/**
 * @typedef {Object} ColorPaletteItem
 * @property {string} name - Name of the color
 * @property {string} code - Hexadecimal color code
 */

/**
 * @typedef {Object} InventoryItemInput
 * @property {string} inventoryId - ID of the inventory item to link
 * @property {number} [plannedQuantity] - Planned quantity for production
 * @property {string} [locationId] - Location ID for inventory
 * @property {Record<string, any>} [metadata] - Additional metadata
 */

/**
 * @typedef {Object} StoreCreateDesignBody
 * @property {string} name.required - Name of the design
 * @property {string} [description] - Description of the design
 * @property {Object} [metadata] - Design metadata
 * @property {DesignLayer[]} [metadata.layers] - Canvas layers for the design
 * @property {string} [metadata.base_product_id] - Base product ID
 * @property {string} [metadata.base_product_thumbnail] - Base product thumbnail URL
 * @property {string} [thumbnail_url] - Thumbnail URL of the final design
 * @property {string[]} [inventory_ids] - Array of inventory IDs to link
 * @property {InventoryItemInput[]} [inventory_items] - Inventory items with details
 * @property {string} [partner_id] - Partner ID to assign for production
 * @property {ColorPaletteItem[]} [color_palette] - Color palette used in design
 * @property {Record<string, Record<string, number>>} [custom_sizes] - Custom size dimensions
 * @property {string[]} [tags] - Tags for categorization
 */

/**
 * @typedef {Object} DesignResponse
 * @property {string} id - Unique identifier for the design
 * @property {string} name - Name of the design
 * @property {string} description - Description of the design
 * @property {string} status - Current status of the design
 * @property {string} thumbnail_url - Thumbnail URL of the design
 * @property {Object} metadata - Design metadata
 * @property {string} origin_source - Source of the design (e.g., "manual", "ai-mistral")
 * @property {Date} created_at - When the design was created
 * @property {Object[]} inventory_items - Linked inventory items
 * @property {string} inventory_items.id - Inventory item ID
 * @property {string} inventory_items.title - Inventory item title
 * @property {Object[]} partners - Linked partners
 * @property {string} partners.id - Partner ID
 * @property {string} partners.name - Partner name
 * @property {Object[]} media_files - Media files associated with the design
 */

/**
 * @typedef {Object} DesignListResponse
 * @property {DesignResponse[]} designs - Array of design objects
 * @property {number} count - Total count of designs
 * @property {number} offset - Pagination offset
 * @property {number} limit - Pagination limit
 */

/**
 * Create a customer design
 * @route POST /store/custom/designs
 * @group Design - Operations related to customer designs
 * @param {StoreCreateDesignBody} request.body.required - Design data to create
 * @returns {Object} 201 - Created design object with linked resources
 * @returns {DesignResponse} 201.design - The created design
 * @returns {Object} 201.linked_inventory - Linked inventory result
 * @returns {Object} 201.linked_partner - Linked partner result
 * @throws {MedusaError} 400 - Missing required fields
 * @throws {MedusaError} 401 - Customer authentication required
 * @throws {MedusaError} 500 - Failed to create design
 *
 * @example request
 * POST /store/custom/designs
 * {
 *   "name": "Summer Collection T-Shirt",
 *   "description": "Custom t-shirt design for summer",
 *   "thumbnail_url": "https://example.com/designs/thumb123.jpg",
 *   "metadata": {
 *     "layers": [
 *       {
 *         "id": "layer1",
 *         "type": "image",
 *         "x": 100,
 *         "y": 150,
 *         "width": 200,
 *         "height": 200,
 *         "rotation": 0,
 *         "scaleX": 1,
 *         "scaleY": 1,
 *         "src": "https://example.com/images/base.png",
 *         "opacity": 1
 *       },
 *       {
 *         "id": "layer2",
 *         "type": "text",
 *         "x": 150,
 *         "y": 200,
 *         "rotation": 0,
 *         "scaleX": 1,
 *         "scaleY": 1,
 *         "text": "Summer 2023",
 *         "fontSize": 24,
 *         "fontFamily": "Arial",
 *         "fill": "#FFFFFF",
 *         "opacity": 1
 *       }
 *     ],
 *     "base_product_id": "prod_123456",
 *     "base_product_thumbnail": "https://example.com/products/base123.jpg"
 *   },
 *   "inventory_ids": ["inv_123", "inv_456"],
 *   "inventory_items": [
 *     {
 *       "inventoryId": "inv_123",
 *       "plannedQuantity": 50,
 *       "locationId": "loc_789",
 *       "metadata": {
 *         "material": "cotton",
 *         "color": "white"
 *       }
 *     }
 *   ],
 *   "partner_id": "partner_789",
 *   "color_palette": [
 *     {
 *       "name": "Primary",
 *       "code": "#FF5733"
 *     },
 *     {
 *       "name": "Secondary",
 *       "code": "#33FF57"
 *     }
 *   ],
 *   "custom_sizes": {
 *     "small": {
 *       "width": 18,
 *       "height": 28
 *     }
 *   },
 *   "tags": ["summer", "t-shirt", "limited-edition"]
 * }
 *
 * @example response 201
 * {
 *   "design": {
 *     "id": "design_123456789",
 *     "name": "Summer Collection T-Shirt",
 *     "description": "Custom t-shirt design for summer",
 *     "status": "Conceptual",
 *     "thumbnail_url": "https://example.com/designs/thumb123.jpg",
 *     "metadata": {
 *       "layers": [...],
 *       "base_product_id": "prod_123456",
 *       "base_product_thumbnail": "https://example.com/products/base123.jpg"
 *     },
 *     "origin_source": "manual",
 *     "created_at": "2023-06-15T10:30:00Z",
 *     "inventory_items": [
 *       {
 *         "id": "inv_123",
 *         "title": "White Cotton T-Shirt"
 *       }
 *     ],
 *     "partners": [
 *       {
 *         "id": "partner_789",
 *         "name": "Summer Apparel Co."
 *       }
 *     ],
 *     "media_files": []
 *   },
 *   "linked_inventory": {
 *     "success": true,
 *     "linked_items": 2
 *   },
 *   "linked_partner": {
 *     "success": true,
 *     "partner_id": "partner_789"
 *   }
 * }
 */

/**
 * List customer designs
 * @route GET /store/custom/designs
 * @group Design - Operations related to customer designs
 * @param {number} [limit=20] - Number of designs to return
 * @param {number} [offset=0] - Pagination offset
 * @param {string} [origin_source] - Filter by origin source
 * @param {boolean} [include_ai] - Only include AI-generated designs
 * @returns {DesignListResponse} 200 - Paginated list of designs
 * @throws {MedusaError} 401 - Customer authentication required
 * @throws {MedusaError} 500 - Failed to fetch designs
 *
 * @example request
 * GET /store/custom/designs?limit=10&offset=0&include_ai=true
 *
 * @example response 200
 * {
 *   "designs": [
 *     {
 *       "id": "design_987654321",
 *       "name": "AI-Generated Summer Dress",
 *       "description": "Dress design generated by AI",
 *       "status": "Conceptual",
 *       "thumbnail_url": "https://example.com/designs/ai-dress.jpg",
 *       "metadata": {
 *         "layers": [...],
 *         "base_product_id": "prod_654321"
 *       },
 *       "origin_source": "ai-mistral",
 *       "created_at": "2023-06-10T14:20:00Z",
 *       "inventory_items": [
 *         {
 *           "id": "inv_789",
 *           "title": "Silk Fabric"
 *         }
 *       ],
 *       "partners": [],
 *       "media_files": []
 *     },
 *     {
 *       "id": "design_123456789",
 *       "name": "Summer Collection T-Shirt",
 *       "description": "Custom t-shirt design for summer",
 *       "status": "Conceptual",
 *       "thumbnail_url": "https://example.com/designs/thumb123.jpg",
 *       "metadata": {
 *         "layers": [...],
 *         "base_product_id": "prod_123456"
 *       },
 *       "origin_source": "manual",
 *       "created_at": "2023-06-15T10:30:00Z",
 *       "inventory_items": [
 *         {
 *           "id": "inv_123",
 *           "title": "White Cotton T-Shirt"
 *         }
 *       ],
 *       "partners": [
 *         {
 *           "id": "partner_789",
 *           "name": "Summer Apparel Co."
 *         }
 *       ],
 *       "media_files": []
 *     }
 *   ],
 *   "count": 2,
 *   "offset": 0,
 *   "limit": 10
 * }
 */
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

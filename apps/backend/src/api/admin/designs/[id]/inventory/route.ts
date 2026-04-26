/**
 * @file Admin API routes for managing design inventory links
 * @description Provides endpoints for linking, listing, and updating inventory items for designs in the JYT Commerce platform
 * @module API/Admin/Designs/Inventory
 */

/**
 * @typedef {Object} AdminPostDesignInventoryReq
 * @property {string[]} inventoryIds - Array of inventory IDs to link to the design
 * @property {Object[]} [inventoryItems] - Array of inventory items with additional details
 * @property {string} inventoryItems.inventoryId - The ID of the inventory item
 * @property {number} inventoryItems.plannedQuantity - The planned quantity for this inventory item
 * @property {string} inventoryItems.locationId - The location ID where the inventory is stored
 * @property {Object} [inventoryItems.metadata] - Additional metadata for the inventory item
 */

/**
 * @typedef {Object} AdminPatchDesignInventoryLinkReq
 * @property {number} plannedQuantity - The updated planned quantity
 * @property {string} locationId - The updated location ID
 * @property {Object} [metadata] - Updated metadata for the inventory link
 */

/**
 * @typedef {Object} DesignInventoryResponse
 * @property {string} id - The unique identifier of the design
 * @property {Object[]} inventory - Array of linked inventory items
 * @property {string} inventory.id - The inventory item ID
 * @property {number} inventory.planned_quantity - The planned quantity
 * @property {string} inventory.location_id - The location ID
 * @property {Object} inventory.metadata - Additional metadata
 * @property {Date} created_at - When the design was created
 * @property {Date} updated_at - When the design was last updated
 */

/**
 * Link inventory items to a design
 * @route POST /admin/designs/:id/inventory
 * @group Design Inventory - Operations related to design inventory management
 * @param {string} id.path.required - The design ID to link inventory to
 * @param {AdminPostDesignInventoryReq} request.body.required - Inventory linking data
 * @param {string[]} request.body.inventoryIds - Array of inventory IDs to link
 * @param {Object[]} [request.body.inventoryItems] - Detailed inventory items
 * @returns {DesignInventoryResponse} 201 - Design object with updated inventory links
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Design not found
 *
 * @example request
 * POST /admin/designs/design_123/inventory
 * {
 *   "inventoryIds": ["inv_456", "inv_789"],
 *   "inventoryItems": [
 *     {
 *       "inventoryId": "inv_456",
 *       "plannedQuantity": 100,
 *       "locationId": "loc_123",
 *       "metadata": {"color": "blue"}
 *     }
 *   ]
 * }
 *
 * @example response 201
 * {
 *   "id": "design_123",
 *   "inventory": [
 *     {
 *       "id": "inv_456",
 *       "planned_quantity": 100,
 *       "location_id": "loc_123",
 *       "metadata": {"color": "blue"}
 *     },
 *     {
 *       "id": "inv_789",
 *       "planned_quantity": 0,
 *       "location_id": null,
 *       "metadata": {}
 *     }
 *   ],
 *   "created_at": "2023-01-01T00:00:00Z",
 *   "updated_at": "2023-01-02T12:00:00Z"
 * }
 */

/**
 * List inventory items linked to a design
 * @route GET /admin/designs/:id/inventory
 * @group Design Inventory - Operations related to design inventory management
 * @param {string} id.path.required - The design ID to fetch inventory for
 * @returns {Object} 200 - List of inventory items linked to the design
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Design not found
 *
 * @example request
 * GET /admin/designs/design_123/inventory
 *
 * @example response 200
 * {
 *   "inventory": [
 *     {
 *       "id": "inv_456",
 *       "planned_quantity": 100,
 *       "location_id": "loc_123",
 *       "metadata": {"color": "blue"}
 *     },
 *     {
 *       "id": "inv_789",
 *       "planned_quantity": 50,
 *       "location_id": "loc_456",
 *       "metadata": {"size": "large"}
 *     }
 *   ],
 *   "count": 2
 * }
 */

/**
 * Update an inventory link for a design
 * @route PATCH /admin/designs/:id/inventory/:inventoryLinkId
 * @group Design Inventory - Operations related to design inventory management
 * @param {string} id.path.required - The design ID
 * @param {string} inventoryLinkId.path.required - The inventory link ID to update
 * @param {AdminPatchDesignInventoryLinkReq} request.body.required - Updated inventory link data
 * @param {number} request.body.plannedQuantity - New planned quantity
 * @param {string} request.body.locationId - New location ID
 * @param {Object} [request.body.metadata] - Updated metadata
 * @returns {DesignInventoryResponse} 200 - Design object with updated inventory link
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Design or inventory link not found
 *
 * @example request
 * PATCH /admin/designs/design_123/inventory/inv_456
 * {
 *   "plannedQuantity": 150,
 *   "locationId": "loc_789",
 *   "metadata": {"color": "red", "priority": "high"}
 * }
 *
 * @example response 200
 * {
 *   "id": "design_123",
 *   "inventory": [
 *     {
 *       "id": "inv_456",
 *       "planned_quantity": 150,
 *       "location_id": "loc_789",
 *       "metadata": {"color": "red", "priority": "high"}
 *     },
 *     {
 *       "id": "inv_789",
 *       "planned_quantity": 50,
 *       "location_id": "loc_456",
 *       "metadata": {"size": "large"}
 *     }
 *   ],
 *   "created_at": "2023-01-01T00:00:00Z",
 *   "updated_at": "2023-01-03T14:30:00Z"
 * }
 */
import {
    MedusaRequest,
    MedusaResponse,
  } from "@medusajs/framework/http";

import { AdminPatchDesignInventoryLinkReq, AdminPostDesignInventoryReq } from "../inventory/validators";
import { linkDesignInventoryWorkflow, updateDesignInventoryLinkWorkflow } from "../../../../../workflows/designs/inventory/link-inventory";
import { DesignInventoryAllowedFields, refetchDesign } from "../inventory/helpers";
import { listDesignInventoryWorkflow } from "../../../../../workflows/designs/inventory/list-design-inventory";
  
  export const POST = async (
    req: MedusaRequest<AdminPostDesignInventoryReq>,
    res: MedusaResponse,
  ) => {

    const designId = req.params.id
    
    const { result, errors } = await linkDesignInventoryWorkflow(req.scope).run({
      input: {
        design_id: designId,
        inventory_ids: req.validatedBody.inventoryIds,
        inventory_items: req.validatedBody.inventoryItems?.map((item) => ({
          inventory_id: item.inventoryId,
          planned_quantity: item.plannedQuantity,
          location_id: item.locationId,
          metadata: item.metadata,
        })),
      },
    })
  
    if (errors.length > 0) {
      console.warn("Error reported at", errors);
      throw errors;
    }
  
    const design = await refetchDesign(
      req.params.id,
      req.scope,
      (req.queryConfig?.fields as DesignInventoryAllowedFields[]) || ["*"],
    );
  
    res.status(201).json( design );
  };


  export const GET = async (
    req: MedusaRequest,
    res: MedusaResponse,
  ) => {
    const designId = req.params.id
    
    const { result, errors } = await listDesignInventoryWorkflow(req.scope).run({
      input: {
        design_id: designId,
      },
    })  

    if (errors.length > 0) { 
      console.warn("Error reported at", errors);
      throw errors;
    }

    res.status(200).json(result);
  };

  export const PATCH = async (
    req: MedusaRequest<AdminPatchDesignInventoryLinkReq>,
    res: MedusaResponse,
  ) => {
    const designId = req.params.id;
    const { inventoryLinkId } = req.params as { inventoryLinkId: string };

    const { errors } = await updateDesignInventoryLinkWorkflow(req.scope).run({
      input: {
        design_id: designId,
        inventory_id: inventoryLinkId,
        planned_quantity: req.validatedBody.plannedQuantity,
        location_id: req.validatedBody.locationId,
        metadata: req.validatedBody.metadata ?? undefined,
      },
    });

    if (errors.length > 0) {
      console.warn("Error reported at", errors);
      throw errors;
    }

    const design = await refetchDesign(
      designId,
      req.scope,
      (req.queryConfig?.fields as DesignInventoryAllowedFields[]) || ["*"],
    );

    res.status(200).json(design);
  };
/**
 * @file Admin API routes for managing designs
 * @description Provides endpoints for retrieving, updating, and deleting designs in the JYT Commerce platform
 * @module API/Admin/Designs
 */

/**
 * @typedef {Object} DesignFields
 * @property {string[]} fields - Array of fields to include in the response
 */

/**
 * @typedef {Object} DesignResponse
 * @property {string} id - The unique identifier of the design
 * @property {string} name - The name of the design
 * @property {string} status - The status of the design (active/inactive)
 * @property {Date} created_at - When the design was created
 * @property {Date} updated_at - When the design was last updated
 * @property {Object} metadata - Additional metadata associated with the design
 */

/**
 * @typedef {Object} UpdateDesignInput
 * @property {string} [name] - The name of the design
 * @property {string} [status] - The status of the design (active/inactive)
 * @property {Object} [metadata] - Additional metadata to associate with the design
 */

/**
 * Get a single design by ID
 * @route GET /admin/designs/:id
 * @group Design - Operations related to designs
 * @param {string} id.path.required - The ID of the design to retrieve
 * @param {string} [fields] - Comma-separated list of fields to include in the response
 * @returns {Object} 200 - The requested design object
 * @throws {MedusaError} 400 - Invalid fields parameter
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Design not found
 *
 * @example request
 * GET /admin/designs/design_123456789?fields=id,name,status
 *
 * @example response 200
 * {
 *   "design": {
 *     "id": "design_123456789",
 *     "name": "Summer Collection",
 *     "status": "active",
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-01-02T00:00:00Z",
 *     "metadata": {}
 *   }
 * }
 */

/**
 * Update a design
 * @route PUT /admin/designs/:id
 * @group Design - Operations related to designs
 * @param {string} id.path.required - The ID of the design to update
 * @param {UpdateDesignInput} request.body.required - Design data to update
 * @returns {Object} 200 - The updated design object
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Design not found
 *
 * @example request
 * PUT /admin/designs/design_123456789
 * {
 *   "name": "Updated Summer Collection",
 *   "status": "inactive",
 *   "metadata": {
 *     "season": "summer",
 *     "year": "2023"
 *   }
 * }
 *
 * @example response 200
 * {
 *   "design": {
 *     "id": "design_123456789",
 *     "name": "Updated Summer Collection",
 *     "status": "inactive",
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-01-03T00:00:00Z",
 *     "metadata": {
 *       "season": "summer",
 *       "year": "2023"
 *     }
 *   }
 * }
 */

/**
 * Delete a design
 * @route DELETE /admin/designs/:id
 * @group Design - Operations related to designs
 * @param {string} id.path.required - The ID of the design to delete
 * @returns {Object} 201 - Confirmation of deletion
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Design not found
 *
 * @example request
 * DELETE /admin/designs/design_123456789
 *
 * @example response 201
 * {
 *   "id": "design_123456789",
 *   "object": "design",
 *   "deleted": true
 * }
 */
import {
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";
import { UpdateDesign } from "../validators";
import updateDesignWorkflow from "../../../../workflows/designs/update-design";
import deleteDesignWorkflow from "../../../../workflows/designs/delete-design";
import { DesignAllowedFields, refetchDesign } from "../helpers";


export const GET = async (
  req: MedusaRequest & {
    params: { id: string };
    // validatedQuery is populated by middleware; `fields` arrives as a comma-separated string
    validatedQuery?: { fields?: string };
  },
  res: MedusaResponse
) => {
  // Extract fields from validated query and convert to array
  const fieldsStr = req.validatedQuery?.fields;
  const fields = (fieldsStr
    ? fieldsStr.split(",").map((f) => f.trim()).filter(Boolean)
    : ["*"]) as DesignAllowedFields[];

  // refetchDesign (same shaper PUT uses) derives the legacy
  // color_palette/custom_sizes from the structured colors/size_sets
  // relations — keeps GET and PUT responses consistent.
  const design = await refetchDesign(req.params.id, req.scope, fields);
  if (!design) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Design with id: ${req.params.id} was not found`
    );
  }

  res.status(200).json({ design });
};

// Update design
export const PUT = async (
  req: MedusaRequest<UpdateDesign> & {
    params: { id: string };
    queryConfig?: {
      fields?: DesignAllowedFields[];
    };
  },
  res: MedusaResponse,
) => {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  // Scoped run — an unscoped workflow.run() uses a bare container that
  // can't resolve request-scoped registrations like "query".
  const { result, errors } = await updateDesignWorkflow(req.scope).run({
    input: {
      id: req.params.id,
      ...req.validatedBody,
    } as any,
  });

  if (errors.length > 0) {
    logger.warn(`Error reported at ${JSON.stringify(errors)}`);
    throw errors;
  }

  const design = await refetchDesign(
    req.params.id,
    req.scope,
    req.queryConfig?.fields || ["*"],
  );

  res.status(200).json({ design });
};

// Delete design
export const DELETE = async (
  req: MedusaRequest & {
    params: { id: string };
  },
  res: MedusaResponse,
) => {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  // 404 on unknown ids (soft-deleting a missing design 500s deep in the
  // workflow otherwise).
  const existing = await refetchDesign(req.params.id, req.scope, ["id"] as any);
  if (!existing) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Design with id: ${req.params.id} was not found`
    );
  }

  const { errors } = await deleteDesignWorkflow(req.scope).run({
    input: {
      id: req.params.id,
    },
  });

  if (errors.length > 0) {
    logger.warn(`Error reported at ${JSON.stringify(errors)}`);
    throw errors;
  }

  res.status(201).send({
    id: req.params.id,
    object: "design",
    deleted: true,
  });
};

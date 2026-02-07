/**
 * @file Admin API routes for managing production run policies
 * @description Provides endpoints for retrieving and updating production run policies in the JYT Commerce platform
 * @module API/Admin/ProductionRunPolicy
 */

/**
 * @typedef {Object} ProductionRunPolicyConfig
 * @property {number} min_quantity - Minimum quantity required for production run
 * @property {number} max_quantity - Maximum quantity allowed for production run
 * @property {string} approval_required - Whether approval is required for production runs
 * @property {string[]} allowed_user_roles - User roles allowed to create production runs
 */

/**
 * @typedef {Object} ProductionRunPolicy
 * @property {string} id - The unique identifier for the policy
 * @property {ProductionRunPolicyConfig} config - Configuration settings for the production run policy
 * @property {Date} created_at - When the policy was created
 * @property {Date} updated_at - When the policy was last updated
 */

/**
 * @typedef {Object} AdminUpdateProductionRunPolicyReq
 * @property {ProductionRunPolicyConfig} config - Updated configuration for the production run policy
 */

/**
 * Retrieve the current production run policy
 * @route GET /admin/production-run-policy
 * @group ProductionRunPolicy - Operations related to production run policies
 * @returns {Object} 200 - The current production run policy
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * GET /admin/production-run-policy
 *
 * @example response 200
 * {
 *   "policy": {
 *     "id": "policy_123456789",
 *     "config": {
 *       "min_quantity": 10,
 *       "max_quantity": 1000,
 *       "approval_required": "yes",
 *       "allowed_user_roles": ["admin", "production_manager"]
 *     },
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-01-15T10:30:00Z"
 *   }
 * }
 */

/**
 * Update the production run policy
 * @route PUT /admin/production-run-policy
 * @group ProductionRunPolicy - Operations related to production run policies
 * @param {AdminUpdateProductionRunPolicyReq} request.body.required - Updated policy configuration
 * @returns {Object} 200 - The updated production run policy
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * PUT /admin/production-run-policy
 * {
 *   "config": {
 *     "min_quantity": 20,
 *     "max_quantity": 2000,
 *     "approval_required": "no",
 *     "allowed_user_roles": ["admin", "production_manager", "supervisor"]
 *   }
 * }
 *
 * @example response 200
 * {
 *   "policy": {
 *     "id": "policy_123456789",
 *     "config": {
 *       "min_quantity": 20,
 *       "max_quantity": 2000,
 *       "approval_required": "no",
 *       "allowed_user_roles": ["admin", "production_manager", "supervisor"]
 *     },
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-02-20T14:45:00Z"
 *   }
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { PRODUCTION_POLICY_MODULE } from "../../../modules/production_policy"
import type ProductionPolicyService from "../../../modules/production_policy/service"

import type { AdminUpdateProductionRunPolicyReq } from "./validators"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const productionPolicyService: ProductionPolicyService = req.scope.resolve(
    PRODUCTION_POLICY_MODULE
  )

  const policy = await productionPolicyService.getOrCreatePolicy()

  return res.status(200).json({ policy })
}

export const PUT = async (
  req: MedusaRequest<AdminUpdateProductionRunPolicyReq>,
  res: MedusaResponse
) => {
  const productionPolicyService: ProductionPolicyService = req.scope.resolve(
    PRODUCTION_POLICY_MODULE
  )

  const body = (req as any).validatedBody || req.body

  const policy = await productionPolicyService.updatePolicy({
    config: body?.config ?? null,
  })

  return res.status(200).json({ policy })
}

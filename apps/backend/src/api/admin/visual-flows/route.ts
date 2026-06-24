/**
 * Visual Flows API
 *
 * This API provides endpoints for managing visual flows in the JYT Commerce platform.
 * Visual flows are automated workflows that can be triggered by events, schedules, webhooks, or manually.
 *
 * @module VisualFlowsAPI
 */

/**
 * Example: List all visual flows
 *
 * GET /admin/visual-flows
 *
 * Query Parameters:
 * - status: Filter by flow status (active, inactive, draft)
 * - trigger_type: Filter by trigger type (event, schedule, webhook, manual, another_flow)
 * - limit: Number of flows to return (default: 50)
 * - offset: Pagination offset (default: 0)
 *
 * Example Request:
 * GET /admin/visual-flows?status=active&trigger_type=event&limit=10&offset=0
 *
 * Example Response:
 * {
 *   "flows": [
 *     {
 *       "id": "flow_123",
 *       "name": "Order Processing Flow",
 *       "status": "active",
 *       "trigger_type": "event",
 *       "created_at": "2023-01-01T00:00:00Z",
 *       "operations": [...]
 *     }
 *   ],
 *   "count": 1,
 *   "limit": 10,
 *   "offset": 0
 * }
 */

/**
 * Example: Create a new visual flow
 *
 * POST /admin/visual-flows
 *
 * Request Body:
 * {
 *   "name": "New Order Flow",
 *   "description": "Handles new order processing",
 *   "status": "active",
 *   "trigger_type": "event",
 *   "trigger_config": { "event_name": "order.placed" },
 *   "operations": [
 *     {
 *       "operation_key": "validate_order",
 *       "operation_type": "validator",
 *       "name": "Validate Order",
 *       "options": { "rules": ["check_inventory"] },
 *       "position_x": 100,
 *       "position_y": 200,
 *       "sort_order": 1
 *     }
 *   ],
 *   "connections": [
 *     {
 *       "source_id": "validate_order",
 *       "target_id": "process_payment",
 *       "connection_type": "success"
 *     }
 *   ]
 * }
 *
 * Example Response:
 * {
 *   "flow": {
 *     "id": "flow_456",
 *     "name": "New Order Flow",
 *     "status": "active",
 *     "trigger_type": "event",
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "operations": [...],
 *     "connections": [...]
 *   }
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { VISUAL_FLOWS_MODULE } from "../../../modules/visual_flows"
import VisualFlowService from "../../../modules/visual_flows/service"
import { z } from "@medusajs/framework/zod"
import { createVisualFlowWorkflow } from "../../../workflows/visual-flows"

// Validation schemas
const createFlowSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  status: z.enum(["active", "inactive", "draft"]).optional(),
  icon: z.string().optional(),
  color: z.string().optional(),
  trigger_type: z.enum(["event", "schedule", "webhook", "manual", "another_flow"]),
  trigger_config: z.record(z.string(), z.any()).optional(),
  canvas_state: z.record(z.string(), z.any()).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  operations: z.array(z.object({
    operation_key: z.string(),
    operation_type: z.string(),
    name: z.string().optional(),
    options: z.record(z.string(), z.any()).optional(),
    position_x: z.number().optional(),
    position_y: z.number().optional(),
    sort_order: z.number().optional(),
  })).optional(),
  connections: z.array(z.object({
    source_id: z.string(),
    source_handle: z.string().optional(),
    target_id: z.string(),
    target_handle: z.string().optional(),
    connection_type: z.enum(["success", "failure", "default"]).optional(),
    condition: z.record(z.string(), z.any()).optional(),
  })).optional(),
})

// The admin DataTable `select` filter stores its value as an array
// (e.g. ["active"]), and `qs` serializes that to repeated query params.
// Accept either form and normalize below.
const STATUS_VALUES = ["active", "inactive", "draft"] as const
const TRIGGER_VALUES = ["event", "schedule", "webhook", "manual", "another_flow"] as const

const statusFilterSchema = z
  .union([z.enum(STATUS_VALUES), z.array(z.enum(STATUS_VALUES))])
  .optional()

const triggerFilterSchema = z
  .union([z.enum(TRIGGER_VALUES), z.array(z.enum(TRIGGER_VALUES))])
  .optional()

const listQuerySchema = z.object({
  status: statusFilterSchema,
  trigger_type: triggerFilterSchema,
  limit: z.coerce.number().optional().default(50),
  offset: z.coerce.number().optional().default(0),
  q: z.string().optional(),
})

const toArray = <T>(v: T | T[] | undefined): T[] | undefined =>
  v === undefined ? undefined : Array.isArray(v) ? v : [v]

/**
 * GET /admin/visual-flows
 * List all visual flows
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: VisualFlowService = req.scope.resolve(VISUAL_FLOWS_MODULE)

  const parsed = listQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Invalid query: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`
    )
  }
  const query = parsed.data

  const statuses = toArray(query.status)
  const triggers = toArray(query.trigger_type)

  const filters: Record<string, any> = {}
  if (statuses?.length) {
    filters.status = statuses.length === 1 ? statuses[0] : { $in: statuses }
  }
  if (triggers?.length) {
    filters.trigger_type = triggers.length === 1 ? triggers[0] : { $in: triggers }
  }
  if (query.q) {
    filters.name = { $ilike: `%${query.q}%` }
  }

  const [flows, count] = await service.listAndCountVisualFlows(filters, {
    take: query.limit,
    skip: query.offset,
    order: { created_at: "DESC" },
    relations: ["operations"],
  })

  res.json({
    flows,
    count,
    limit: query.limit,
    offset: query.offset,
  })
}

/**
 * POST /admin/visual-flows
 * Create a new visual flow using workflow
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const parsed = createFlowSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Invalid body: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`
    )
  }
  const data = parsed.data

  // Use workflow for transactional creation with rollback support
  const { result: flow, errors } = await createVisualFlowWorkflow(req.scope).run({
    input: {
      name: data.name,
      description: data.description,
      status: data.status,
      trigger_type: data.trigger_type,
      trigger_config: data.trigger_config,
      canvas_state: data.canvas_state,
      metadata: data.metadata,
      operations: data.operations?.map((op, index) => ({
        ...op,
        position_x: op.position_x || 0,
        position_y: op.position_y || 0,
        sort_order: op.sort_order || index,
      })),
      connections: data.connections,
    },
  })

  if (errors?.length) {
    const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
    logger.error(`[visual-flows] Create workflow errors: ${JSON.stringify(errors)}`)
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `Failed to create flow: ${errors.map((e: any) => e?.error?.message ?? String(e)).join("; ")}`
    )
  }

  res.status(201).json({ flow })
}

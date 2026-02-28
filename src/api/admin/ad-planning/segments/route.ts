/**
 * Admin Customer Segments API
 * List and create customer segments
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { z } from "@medusajs/framework/zod";
import { AD_PLANNING_MODULE } from "../../../../modules/ad-planning";
import { buildSegmentWorkflow } from "../../../../workflows/ad-planning/segments/build-segment";

const ListSegmentsSchema = z.object({
  segment_type: z.enum(["behavioral", "demographic", "rfm", "custom"]).optional(),
  is_active: z.coerce.boolean().optional(),
  limit: z.coerce.number().default(50),
  offset: z.coerce.number().default(0),
});

/**
 * List customer segments
 * @route GET /admin/ad-planning/segments
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const params = ListSegmentsSchema.parse(req.query);
  const adPlanningService = req.scope.resolve(AD_PLANNING_MODULE);

  const filters: Record<string, any> = {};

  if (params.segment_type) filters.segment_type = params.segment_type;
  if (params.is_active !== undefined) filters.is_active = params.is_active;

  const [segments, count] = await adPlanningService.listAndCountCustomerSegments(
    filters,
    {
      take: params.limit,
      skip: params.offset,
      order: { customer_count: "DESC" },
    }
  );

  res.json({
    segments,
    count,
    limit: params.limit,
    offset: params.offset,
  });
};

const CreateSegmentSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  segment_type: z.enum(["behavioral", "demographic", "rfm", "custom"]).default("custom"),
  criteria: z.object({
    rules: z.array(z.object({
      field: z.string(),
      operator: z.enum([">=", "<=", ">", "<", "==", "!=", "contains", "not_contains"]),
      value: z.any(),
    })),
    logic: z.enum(["AND", "OR"]).default("AND"),
  }),
  is_active: z.boolean().default(true),
  auto_update: z.boolean().default(true),
  color: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

/**
 * Create a customer segment
 * @route POST /admin/ad-planning/segments
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const data = CreateSegmentSchema.parse(req.body);
  const adPlanningService = req.scope.resolve(AD_PLANNING_MODULE);

  const [segment] = await adPlanningService.createCustomerSegments([{
    ...data,
    customer_count: 0,
  }]);

  // Build segment immediately if auto_update is enabled
  if (data.auto_update) {
    try {
      const result = await buildSegmentWorkflow(req.scope).run({
        input: { segment_id: segment.id },
      });

      // Refresh segment with updated count
      const [updated] = await adPlanningService.listCustomerSegments({ id: segment.id });

      res.status(201).json({
        segment: updated,
        build_result: result.result,
      });
      return;
    } catch (error) {
      console.error("[Segments] Failed to build segment:", error);
    }
  }

  res.status(201).json({ segment });
};

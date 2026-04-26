/**
 * Admin Customer Segment Detail API
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { z } from "@medusajs/framework/zod";
import { MedusaError } from "@medusajs/framework/utils";
import { AD_PLANNING_MODULE } from "../../../../../modules/ad-planning";
import { buildSegmentWorkflow } from "../../../../../workflows/ad-planning/segments/build-segment";

/**
 * Get segment by ID
 * @route GET /admin/ad-planning/segments/:id
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params;
  const adPlanningService = req.scope.resolve(AD_PLANNING_MODULE);

  const [segment] = await adPlanningService.listCustomerSegments({ id });

  if (!segment) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Segment with id ${id} not found`
    );
  }

  // Use the stored customer_count maintained by buildSegmentWorkflow instead
  // of loading every member row into memory just to count them. Falls back
  // to an efficient count query if customer_count isn't populated yet.
  let memberCount = Number(segment.customer_count) || 0;
  if (memberCount === 0) {
    try {
      const [, count] = await adPlanningService.listAndCountSegmentMembers(
        { segment: { id } },
        { take: 1 }
      );
      memberCount = count || 0;
    } catch {
      // Non-fatal
    }
  }

  res.json({
    segment: {
      ...segment,
      member_count: memberCount,
    },
  });
};

const SegmentRuleSchema = z.object({
  field: z.string(),
  operator: z.enum([
    ">=", "<=", ">", "<", "==", "!=",
    "contains", "not_contains",
    "in", "not_in",
    "between",
    "within_last_days", "older_than_days",
  ]),
  value: z.any(),
});

// z.ZodType<any> used because z.lazy + z.default causes input/output type divergence
const SegmentGroupSchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    logic: z.enum(["AND", "OR", "NOT"]).default("AND"),
    rules: z.array(SegmentRuleSchema).optional().default([]),
    groups: z.array(SegmentGroupSchema).optional(),
  })
);

const UpdateSegmentSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional().nullable(),
  segment_type: z.enum(["behavioral", "demographic", "rfm", "custom"]).optional(),
  criteria: SegmentGroupSchema.optional(),
  is_active: z.boolean().optional(),
  auto_update: z.boolean().optional(),
  color: z.string().optional().nullable(),
  metadata: z.record(z.any()).optional().nullable(),
  rebuild: z.boolean().optional(),
});

/**
 * Update segment
 * @route PUT /admin/ad-planning/segments/:id
 */
export const PUT = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params;
  const data = UpdateSegmentSchema.parse(req.body);
  const adPlanningService = req.scope.resolve(AD_PLANNING_MODULE);

  const [existing] = await adPlanningService.listCustomerSegments({ id });
  if (!existing) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Segment with id ${id} not found`
    );
  }

  const { rebuild, ...updateData } = data;

  // If only rebuilding, skip the update call
  if (Object.keys(updateData).length > 0) {
    await adPlanningService.updateCustomerSegments({
      id,
      ...updateData,
    });
  }

  // Trigger rebuild if requested
  if (rebuild) {
    const result = await buildSegmentWorkflow(req.scope).run({
      input: { segment_id: id },
    });

    const [refreshed] = await adPlanningService.listCustomerSegments({ id });
    const members = await adPlanningService.listSegmentMembers({ segment: { id } });

    res.json({
      segment: { ...refreshed, member_count: members.length },
      build_result: result.result,
      message: `Segment rebuilt: ${result.result.members_added} added, ${result.result.members_removed} removed`,
    });
    return;
  }

  const [segment] = await adPlanningService.listCustomerSegments({ id });

  res.json({ segment });
};

/**
 * Delete segment
 * @route DELETE /admin/ad-planning/segments/:id
 */
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params;
  const adPlanningService = req.scope.resolve(AD_PLANNING_MODULE);

  const [existing] = await adPlanningService.listCustomerSegments({ id });
  if (!existing) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Segment with id ${id} not found`
    );
  }

  // Delete segment members first
  const members = await adPlanningService.listSegmentMembers({
    segment: { id },
  });
  if (members.length > 0) {
    await adPlanningService.deleteSegmentMembers(members.map(m => m.id));
  }

  // Delete segment
  await adPlanningService.deleteCustomerSegments([id]);

  res.status(200).json({
    id,
    deleted: true,
  });
};

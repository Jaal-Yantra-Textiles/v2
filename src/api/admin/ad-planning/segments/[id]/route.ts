/**
 * Admin Customer Segment Detail API
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { z } from "@medusajs/framework/zod";
import { MedusaError } from "@medusajs/framework/utils";
import { AD_PLANNING_MODULE } from "../../../../../modules/ad-planning";

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

  // Get member count
  const members = await adPlanningService.listSegmentMembers({
    segment: { id },
  });

  res.json({
    segment: {
      ...segment,
      member_count: members.length,
    },
  });
};

const UpdateSegmentSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional().nullable(),
  segment_type: z.enum(["behavioral", "demographic", "rfm", "custom"]).optional(),
  criteria: z.object({
    rules: z.array(z.object({
      field: z.string(),
      operator: z.enum([">=", "<=", ">", "<", "==", "!=", "contains", "not_contains"]),
      value: z.any(),
    })),
    logic: z.enum(["AND", "OR"]).default("AND"),
  }).optional(),
  is_active: z.boolean().optional(),
  auto_update: z.boolean().optional(),
  color: z.string().optional().nullable(),
  metadata: z.record(z.any()).optional().nullable(),
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

  const segment = await adPlanningService.updateCustomerSegments({
    id,
    ...data,
  });

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

/**
 * Admin Conversion Detail API
 * Get, update, delete single conversion
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { z } from "@medusajs/framework/zod";
import { MedusaError } from "@medusajs/framework/utils";
import { AD_PLANNING_MODULE } from "../../../../../modules/ad-planning";

/**
 * Get conversion by ID
 * @route GET /admin/ad-planning/conversions/:id
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params;
  const adPlanningService = req.scope.resolve(AD_PLANNING_MODULE);

  const [conversion] = await adPlanningService.listConversions({ id });

  if (!conversion) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Conversion with id ${id} not found`
    );
  }

  res.json({ conversion });
};

// Update conversion schema
const UpdateConversionSchema = z.object({
  conversion_name: z.string().optional(),
  ad_campaign_id: z.string().optional().nullable(),
  ad_set_id: z.string().optional().nullable(),
  ad_id: z.string().optional().nullable(),
  platform: z.enum(["meta", "google", "generic", "direct"]).optional(),
  conversion_value: z.number().optional().nullable(),
  person_id: z.string().optional().nullable(),
  attribution_model: z.enum(["last_click", "first_click", "linear", "time_decay"]).optional(),
  metadata: z.record(z.any()).optional().nullable(),
});

/**
 * Update conversion
 * @route PUT /admin/ad-planning/conversions/:id
 */
export const PUT = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params;
  const data = UpdateConversionSchema.parse(req.body);
  const adPlanningService = req.scope.resolve(AD_PLANNING_MODULE);

  const [existing] = await adPlanningService.listConversions({ id });
  if (!existing) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Conversion with id ${id} not found`
    );
  }

  const [conversion] = await adPlanningService.updateConversions([
    {
      selector: { id },
      data,
    },
  ]);

  res.json({ conversion });
};

/**
 * Delete conversion
 * @route DELETE /admin/ad-planning/conversions/:id
 */
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params;
  const adPlanningService = req.scope.resolve(AD_PLANNING_MODULE);

  const [existing] = await adPlanningService.listConversions({ id });
  if (!existing) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Conversion with id ${id} not found`
    );
  }

  await adPlanningService.deleteConversions([id]);

  res.status(200).json({
    id,
    deleted: true,
  });
};

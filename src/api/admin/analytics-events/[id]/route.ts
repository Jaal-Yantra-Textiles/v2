import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { AnalyticsEventUpdate } from "../validators";
import { listAnalyticsEventWorkflow } from "../../../../workflows/analytics/list-analytics-event";
import { updateAnalyticsEventWorkflow } from "../../../../workflows/analytics/update-analytics-event";
import { deleteAnalyticsEventWorkflow } from "../../../../workflows/analytics/delete-analytics-event";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { result } = await listAnalyticsEventWorkflow(req.scope).run({
    input: { filters: { id: [req.params.id] } },
  });
  res.status(200).json({ analyticsEvent: result[0][0] });
};

export const POST = async (req: MedusaRequest<AnalyticsEventUpdate>, res: MedusaResponse) => {
  const { result } = await updateAnalyticsEventWorkflow(req.scope).run({
    input: {
      id: req.params.id,
      ...req.validatedBody,
    },
  });
  res.status(200).json({ analyticsEvent: result });
};

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  await deleteAnalyticsEventWorkflow(req.scope).run({
    input: { id: req.params.id },
  });
  res.status(200).json({
    id: req.params.id,
    object: "analyticsEvent",
    deleted: true,
  });
};

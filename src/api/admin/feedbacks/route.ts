import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { Feedback } from "./validators";
import { createFeedbackWorkflow } from "../../../workflows/feedback/create-feedback";
import { listFeedbackWorkflow } from "../../../workflows/feedback/list-feedback";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  // TODO: Add query param parsing for filters, pagination, etc.
  const { result } = await listFeedbackWorkflow(req.scope).run({
    input: {},
  });
  res.status(200).json({ feedbacks: result[0], count: result[1] });
};

export const POST = async (req: MedusaRequest<Feedback>, res: MedusaResponse) => {
  const { result } = await createFeedbackWorkflow(req.scope).run({
    input: req.validatedBody,
  });
  res.status(201).json({ feedback: result });
};

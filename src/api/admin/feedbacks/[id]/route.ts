import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { UpdateFeedback } from "../validators";
import { listFeedbackWorkflow } from "../../../../workflows/feedback/list-feedback";
import { updateFeedbackWorkflow } from "../../../../workflows/feedback/update-feedback";
import { deleteFeedbackWorkflow } from "../../../../workflows/feedback/delete-feedback";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { result } = await listFeedbackWorkflow(req.scope).run({
    input: { filters: { id: [req.params.id] } },
  });
  res.status(200).json({ feedback: result[0][0] });
};

export const POST = async (req: MedusaRequest<UpdateFeedback>, res: MedusaResponse) => {
  const { result } = await updateFeedbackWorkflow(req.scope).run({
    input: {
      id: req.params.id,
      ...req.validatedBody,
    },
  });
  res.status(200).json({ feedback: result });
};

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  await deleteFeedbackWorkflow(req.scope).run({
    input: { id: req.params.id },
  });
  res.status(200).json({
    id: req.params.id,
    object: "feedback",
    deleted: true,
  });
};

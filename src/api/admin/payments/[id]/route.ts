import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { UpdatePayment } from "../validators";
import { listPaymentWorkflow } from "../../../../workflows/internal_payments/list-payment";
import { updatePaymentWorkflow } from "../../../../workflows/internal_payments/update-payment";
import { deletePaymentWorkflow } from "../../../../workflows/internal_payments/delete-payment";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { result } = await listPaymentWorkflow(req.scope).run({
    input: { filters: { id: [req.params.id] } },
  });
  res.status(200).json({ payment: result[0][0] });
};

export const POST = async (req: MedusaRequest<UpdatePayment>, res: MedusaResponse) => {
  const { result } = await updatePaymentWorkflow(req.scope).run({
    input: {
      id: req.params.id,
      ...req.validatedBody,
    },
  });
  res.status(200).json({ payment: result });
};

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  await deletePaymentWorkflow(req.scope).run({
    input: { id: req.params.id },
  });
  res.status(200).json({
    id: req.params.id,
    object: "payment",
    deleted: true,
  });
};

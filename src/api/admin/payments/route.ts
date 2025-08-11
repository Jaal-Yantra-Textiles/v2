import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { Payment, ListPaymentsQuery } from "./validators";
import { createPaymentWorkflow } from "../../../workflows/internal_payments/create-payment";
import { listPaymentWorkflow } from "../../../workflows/internal_payments/list-payment";

export const GET = async (req: MedusaRequest<ListPaymentsQuery>, res: MedusaResponse) => {
  const { offset = 0, limit = 50 } = (req.validatedQuery || {}) as Partial<ListPaymentsQuery>
  const { result } = await listPaymentWorkflow(req.scope).run({
    input: {
      filters: {},
      config: {
        skip: offset,
        take: limit,
      },
    },
  })
  return res.status(200).json({ payments: result[0], count: result[1], offset, limit })
};

export const POST = async (req: MedusaRequest<Payment>, res: MedusaResponse) => {
  const { result } = await createPaymentWorkflow(req.scope).run({
    input: req.validatedBody,
  });
  res.status(201).json({ payment: result });
};

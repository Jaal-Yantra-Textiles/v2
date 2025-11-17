import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { UpdateAgreement } from "../validators";
import { refetchAgreement } from "../helpers";
import { listAgreementWorkflow } from "../../../../workflows/agreements/list-agreement";
import { updateAgreementWorkflow } from "../../../../workflows/agreements/update-agreement";
import { deleteAgreementWorkflow } from "../../../../workflows/agreements/delete-agreement";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { result } = await listAgreementWorkflow(req.scope).run({
    input: { filters: { id: [req.params.id] } },
  });
  res.status(200).json({ agreement: result[0][0] });
};

export const POST = async (req: MedusaRequest<UpdateAgreement>, res: MedusaResponse) => {
  const { result } = await updateAgreementWorkflow(req.scope).run({
    input: {
      id: req.params.id,
      ...req.validatedBody,
    },
  });

  const agreement = await refetchAgreement(result[0].id, req.scope);
  res.status(200).json({ agreement });
};

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  await deleteAgreementWorkflow(req.scope).run({
    input: { id: req.params.id },
  });
  res.status(200).json({
    id: req.params.id,
    object: "agreement",
    deleted: true,
  });
};

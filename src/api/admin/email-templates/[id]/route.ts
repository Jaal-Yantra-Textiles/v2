import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { UpdateEmailTemplate } from "../validators";
import { refetchEmailTemplate } from "../helpers";
import { listEmailTemplateWorkflow } from "../../../../workflows/email_templates/list-email-template";
import { updateEmailTemplateWorkflow } from "../../../../workflows/email_templates/update-email-template";
import { deleteEmailTemplateWorkflow } from "../../../../workflows/email_templates/delete-email-template";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { result } = await listEmailTemplateWorkflow(req.scope).run({
    input: { filters: { id: [req.params.id] } },
  });
  res.status(200).json({ emailTemplate: result[0][0] });
};

export const POST = async (req: MedusaRequest<UpdateEmailTemplate>, res: MedusaResponse) => {
  const { result } = await updateEmailTemplateWorkflow(req.scope).run({
    input: {
      id: req.params.id,
      ...req.validatedBody,
    },
  });

  const emailTemplate = await refetchEmailTemplate(result[0].id, req.scope);
  res.status(200).json({ emailTemplate });
};

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  await deleteEmailTemplateWorkflow(req.scope).run({
    input: { id: req.params.id },
  });
  res.status(200).json({
    id: req.params.id,
    object: "emailtemplate",
    deleted: true,
  });
};

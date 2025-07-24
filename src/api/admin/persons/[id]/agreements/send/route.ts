import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { sendAgreementEmailWorkflow } from "../../../../../../workflows/agreements/send-agreement-email";
import { AdminSendPersonAgreementReq } from "../validators";

// POST /admin/persons/:id/agreements/send - Send an agreement to a person
export const POST = async (
  req: MedusaRequest<AdminSendPersonAgreementReq>,
  res: MedusaResponse
) => {
  const { id: person_id } = req.params;
  const { agreement_id, template_key } = req.validatedBody;

  // Execute the send agreement email workflow
  const { result } = await sendAgreementEmailWorkflow(req.scope).run({
    input: {
      person_id,
      agreement_id,
      template_key
    }
  });

  res.status(200).json({
    message: "Agreement sent successfully",
    person_id,
    agreement_id,
    agreement_response: result.agreement_response,
    person_agreement_link: result.person_agreement_link,
    email_result: result.email_result,
    stats_updated: result.stats_updated
  });
};

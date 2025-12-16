import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { sendAgreementEmailWorkflow } from "../../../../../../workflows/agreements/send-agreement-email";
import { sendAgreementEmailMultiWorkflow } from "../../../../../../workflows/agreements/send-agreement-email-multi";
import { AdminSendPersonAgreementReq } from "../validators";

// POST /admin/persons/:id/agreements/send - Send an agreement to a person (single or multiple signers)
export const POST = async (
  req: MedusaRequest<AdminSendPersonAgreementReq>,
  res: MedusaResponse
) => {
  const { id: person_id } = req.params;
  const { agreement_id, person_ids, template_key } = req.validatedBody;
  // If person_ids is provided, use multi-signer workflow
  if (person_ids && person_ids.length > 0) {
    // Combine the primary person_id with additional person_ids
    const all_person_ids = [person_id, ...person_ids];
    
    // Execute the send agreement email multi workflow
    const { result } = await sendAgreementEmailMultiWorkflow(req.scope).run({
      input: {
        agreement_id,
        person_ids: all_person_ids,
        template_key
      }
    });

    const statsUpdated = Array.isArray(result.stats_updated)
      ? result.stats_updated
      : [result.stats_updated];

    res.status(200).json({
      message: "Agreement sent successfully to all signers",
      agreement_id,
      person_ids: all_person_ids,
      agreement_responses: result.agreement_responses,
      person_agreement_links: result.person_agreement_links,
      email_results: result.email_results,
      stats_updated: statsUpdated
    });
  } else {
    // Use single signer workflow for backward compatibility
    const { result } = await sendAgreementEmailWorkflow(req.scope).run({
      input: {
        person_id,
        agreement_id,
        template_key
      }
    });

    const statsUpdated = Array.isArray(result.stats_updated)
      ? result.stats_updated
      : [result.stats_updated];

    res.status(200).json({
      message: "Agreement sent successfully",
      person_id,
      agreement_id,
      agreement_response: result.agreement_response,
      person_agreement_link: result.person_agreement_link,
      email_result: result.email_result,
      stats_updated: statsUpdated
    });
  }
};

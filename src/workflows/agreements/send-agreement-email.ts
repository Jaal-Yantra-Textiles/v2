import {
  createWorkflow,
  WorkflowResponse,
  transform,
} from "@medusajs/framework/workflows-sdk";
import { sendNotificationEmailWorkflow } from "../email/send-notification-email";
import {
  fetchAgreementDataStep,
  createAgreementResponseStep,
  linkPersonWithAgreementStep,
  updateAgreementStatsStep,
} from "./steps";
import { logger } from "@medusajs/framework";

export type SendAgreementEmailInput = {
  agreement_id: string;
  person_id: string;
  person_ids?: string[]; // Optional: additional signers (co-signers)
  template_key?: string; // Optional: override agreement's template_key
};

export const sendAgreementEmailWorkflow = createWorkflow(
  "send-agreement-email",
  (input: SendAgreementEmailInput) => {
    // Handle primary signer (backward compatibility)
    // Step 1: Fetch agreement and person data for primary signer
    const { agreement, person } = fetchAgreementDataStep({
      agreement_id: input.agreement_id,
      person_id: input.person_id,
    });

    // Step 2: Create agreement response record for primary signer
    const agreementResponse = createAgreementResponseStep({
      agreement_id: transform({ input }, (data) => data.input.agreement_id),
      person_id: input.person_id,
      email_sent_to: transform({ person }, (data) => data.person.email as string), // We validated email exists in fetchAgreementDataStep
    });

    // Step 3: Create person-agreement module link for primary signer
    const personAgreementLink = linkPersonWithAgreementStep({
      person_id: input.person_id,
      agreement_id: input.agreement_id,
    });

    // Step 4: Send the email using our email template system to primary signer
    const emailResult = sendNotificationEmailWorkflow.runAsStep({
      input: transform({ agreement, person, agreementResponse, input }, (data) => {
        const templateKey = data.input.template_key || data.agreement.template_key || "agreement-email";
        
        logger.info('Agreement Email Transform - Input data: ' + JSON.stringify({
          inputTemplateKey: data.input.template_key,
          agreementTemplateKey: data.agreement.template_key,
          finalTemplateKey: templateKey,
          agreementId: data.agreement.id,
          personEmail: data.person.email,
          agreementTitle: data.agreement.title
        }));
        
        const emailData = {
          to: data.person.email as string,
          template: templateKey,
          data: {
            // Agreement data
            agreement_title: data.agreement.title,
            agreement_content: data.agreement.content,
            agreement_subject: data.agreement.subject,
            agreement_id: data.agreement.id,
            
            // Person data
            first_name: data.person.first_name || "",
            last_name: data.person.last_name || "",
            email: data.person.email,
            person_id: data.person.id,
            
            // Response tracking data
            response_id: data.agreementResponse.id,
            agreement_url: `${process.env.FRONTEND_URL || 'https://jaalyantra.com'}/agreement/${data.agreementResponse.id}?token=${data.agreementResponse.access_token}`,
            
            // Additional template data
            website_url: process.env.FRONTEND_URL || 'https://jaalyantra.com',
            current_year: new Date().getFullYear().toString(),
          }
        };
        return emailData;
      })
    });

    // Step 5: Update agreement statistics
    const statsUpdate = updateAgreementStatsStep({
      agreement_id: input.agreement_id,
    });

    return new WorkflowResponse({
      agreement_response: agreementResponse,
      person_agreement_link: personAgreementLink,
      email_result: emailResult,
      stats_updated: statsUpdate,
    });
  }
);

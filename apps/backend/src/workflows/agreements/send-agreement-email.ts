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
import { linkPersonWithAgreementResponseStep } from "./steps/link-person-with-agreement-response";
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

    // Extract email to avoid type depth issues
    const personEmail = transform({ person }, (data: any) => data.person.email as string);

    // Step 2: Create agreement response record for primary signer
    const agreementResponse = createAgreementResponseStep({
      agreement_id: transform({ input }, (data: any) => data.input.agreement_id),
      person_id: input.person_id,
      email_sent_to: personEmail, // We validated email exists in fetchAgreementDataStep
    });

    // Step 3: Create person-agreement module link for primary signer
    const personAgreementLink = linkPersonWithAgreementStep({
      person_id: input.person_id,
      agreement_id: input.agreement_id,
    });

    // Extract agreement response ID to avoid type depth issues
    const agreementResponseId = transform({ agreementResponse }, (data: any) => (data as any).agreementResponse.id);
    const agreementResponseAccessToken = transform({ agreementResponse }, (data: any) => (data as any).agreementResponse.access_token);

    // Step 4: Create person-agreement response module link for primary signer
    const personAgreementResponseLink = linkPersonWithAgreementResponseStep({
      person_id: input.person_id,
      agreement_response_id: agreementResponseId,
    });

    // Step 5: Send the email using our email template system to primary signer
    const emailResult = sendNotificationEmailWorkflow.runAsStep({
      // @ts-ignore - Complex workflow types cause excessive stack depth error
      input: transform({ agreement, person, input, responseId: agreementResponseId, responseToken: agreementResponseAccessToken }, (data: any) => {
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
            response_id: data.responseId,
            agreement_url: `${process.env.FRONTEND_URL || 'https://jaalyantra.com'}/agreement/${data.responseId}?token=${data.responseToken}`,
            
            // Additional template data
            website_url: process.env.FRONTEND_URL || 'https://jaalyantra.com',
            current_year: new Date().getFullYear().toString(),
          }
        };
        return emailData;
      })
    });

    // Step 6: Update agreement statistics
    const statsUpdate = updateAgreementStatsStep({
      agreement_id: input.agreement_id,
    });

    return new WorkflowResponse({
      agreement_response: agreementResponse,
      person_agreement_link: personAgreementLink,
      person_agreement_response_link: personAgreementResponseLink,
      email_result: emailResult,
      stats_updated: statsUpdate,
    });
  }
);

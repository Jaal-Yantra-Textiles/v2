import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { sendNotificationEmailWorkflow } from "../../email/send-notification-email";

export type SendMultipleAgreementEmailsInput = {
  agreement: any;
  signers: Array<{
    person: any;
    agreementResponse: any;
  }>;
  template_key?: string;
};

export const sendMultipleAgreementEmailsStep = createStep(
  "send-multiple-agreement-emails",
  async (input: SendMultipleAgreementEmailsInput, { container }) => {
    const templateKey = input.template_key || input.agreement.template_key || "agreement-email";
    
    // Send emails to all signers
    const emailResults: Array<{ person_id: string; email_result: any }> = [];
    
    for (const signer of input.signers) {
      const emailData = {
        to: signer.person.email as string,
        template: templateKey,
        data: {
          // Agreement data
          agreement_title: input.agreement.title,
          agreement_content: input.agreement.content,
          agreement_subject: input.agreement.subject,
          agreement_id: input.agreement.id,
          
          // Person data
          first_name: signer.person.first_name || "",
          last_name: signer.person.last_name || "",
          email: signer.person.email,
          person_id: signer.person.id,
          
          // Response tracking data
          response_id: signer.agreementResponse.id,
          agreement_url: `${process.env.FRONTEND_URL || 'https://jaalyantra.com'}/agreement/${signer.agreementResponse.id}?token=${signer.agreementResponse.access_token}`,
          
          // Additional template data
          website_url: process.env.FRONTEND_URL || 'https://jaalyantra.com',
          current_year: new Date().getFullYear().toString(),
        },
      };
      
      // Send the email using the existing notification workflow
      const { result: emailResult } = await sendNotificationEmailWorkflow(container).run({
        input: emailData
      });
      
      emailResults.push({
        person_id: signer.person.id,
        email_result: emailResult
      });
    }

    return new StepResponse(emailResults);
  }
);

import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import * as Handlebars from "handlebars";

export type ProcessAgreementTemplateInput = {
  agreement: {
    id: string;
    title: string;
    content: string;
    template_key?: string | null;
    status: "draft" | "active" | "expired" | "cancelled";
    valid_from?: Date | null;
    valid_until?: Date | null;
    subject: string;
    from_email?: string | null;
    sent_count: number;
    response_count: number;
    agreed_count: number;
    metadata?: Record<string, any> | null;
  };
  agreementResponse: {
    id: string;
    status: "sent" | "viewed" | "agreed" | "disagreed" | "expired";
    sent_at: Date;
    viewed_at?: Date | null;
    responded_at?: Date | null;
    agreed?: boolean | null;
    response_notes?: string | null;
    email_sent_to: string;
    email_opened: boolean;
    email_opened_at?: Date | null;
    access_token: string;
    response_ip?: string | null;
    response_user_agent?: string | null;
    metadata?: Record<string, any> | null;
  };
};

export const processAgreementTemplateStep = createStep(
  "process-agreement-template",
  async (input: ProcessAgreementTemplateInput, { container }) => {
    try {
      // Prepare template data from agreement and response
      const templateData = {
        // Agreement data
        agreement: {
          id: input.agreement.id,
          title: input.agreement.title,
          subject: input.agreement.subject,
          valid_from: input.agreement.valid_from || undefined,
          valid_until: input.agreement.valid_until || undefined,
          status: input.agreement.status,
          template_key: input.agreement.template_key || undefined,
          from_email: input.agreement.from_email || undefined,
          sent_count: input.agreement.sent_count,
          response_count: input.agreement.response_count,
          agreed_count: input.agreement.agreed_count,
          ...(input.agreement.metadata || {})
        },
        // Response data
        response: {
          id: input.agreementResponse.id,
          status: input.agreementResponse.status,
          email_sent_to: input.agreementResponse.email_sent_to,
          sent_at: input.agreementResponse.sent_at,
          viewed_at: input.agreementResponse.viewed_at || undefined,
          responded_at: input.agreementResponse.responded_at || undefined,
          agreed: input.agreementResponse.agreed ?? undefined,
          response_notes: input.agreementResponse.response_notes || undefined,
          email_opened: input.agreementResponse.email_opened,
          email_opened_at: input.agreementResponse.email_opened_at || undefined,
          access_token: input.agreementResponse.access_token,
          response_ip: input.agreementResponse.response_ip || undefined,
          response_user_agent: input.agreementResponse.response_user_agent || undefined,
          ...(input.agreementResponse.metadata || {})
        },
        // Utility data
        current_date: new Date(),
        formatted_date: new Date().toLocaleDateString(),
        formatted_datetime: new Date().toLocaleString()
      };

      // Process the agreement content with Handlebars
      let processedContent = input.agreement.content;
      let processedSubject = input.agreement.subject;

      console.log('=== TEMPLATE PROCESSING DEBUG ===');
      console.log('Original content length:', input.agreement.content.length);
      console.log('Original subject:', input.agreement.subject);
      console.log('Template data keys:', Object.keys(templateData));
      console.log('Agreement data:', JSON.stringify(templateData.agreement, null, 2));
      console.log('Response data:', JSON.stringify(templateData.response, null, 2));

      try {
        // Compile and render the content template
        console.log('Compiling content template...');
        const contentTemplate = Handlebars.compile(input.agreement.content);
        console.log('Content template compiled successfully');
        
        processedContent = contentTemplate(templateData);
        console.log('Content rendered successfully, length:', processedContent.length);
        console.log('Processed content preview:', processedContent.substring(0, 200) + '...');

        // Compile and render the subject template
        console.log('Compiling subject template...');
        const subjectTemplate = Handlebars.compile(input.agreement.subject);
        console.log('Subject template compiled successfully');
        
        processedSubject = subjectTemplate(templateData);
        console.log('Subject rendered successfully:', processedSubject);
        
        console.log('Successfully processed agreement template with Handlebars');
      } catch (error) {
        console.error('ERROR in template processing:', error);
        console.error('Error details:', error.message);
        // Don't throw, just log and return original content
      }

      return new StepResponse({
        processedContent,
        processedSubject,
        templateData
      });

    } catch (error) {
      console.error(`Failed to process agreement template with Handlebars: ${error.message}`);
      
      // Return original content if processing fails
      return new StepResponse({
        processedContent: input.agreement.content,
        processedSubject: input.agreement.subject,
        templateData: {
          agreement: {
            id: input.agreement.id,
            title: input.agreement.title,
            subject: input.agreement.subject,
            valid_from: input.agreement.valid_from || undefined,
            valid_until: input.agreement.valid_until || undefined,
            status: input.agreement.status,
            template_key: input.agreement.template_key || undefined,
            from_email: input.agreement.from_email || undefined,
            sent_count: input.agreement.sent_count,
            response_count: input.agreement.response_count,
            agreed_count: input.agreement.agreed_count,
            ...(input.agreement.metadata || {})
          },
          response: {
            id: input.agreementResponse.id,
            status: input.agreementResponse.status,
            email_sent_to: input.agreementResponse.email_sent_to,
            sent_at: input.agreementResponse.sent_at,
            viewed_at: input.agreementResponse.viewed_at || undefined,
            responded_at: input.agreementResponse.responded_at || undefined,
            agreed: input.agreementResponse.agreed ?? undefined,
            response_notes: input.agreementResponse.response_notes || undefined,
            email_opened: input.agreementResponse.email_opened,
            email_opened_at: input.agreementResponse.email_opened_at || undefined,
            access_token: input.agreementResponse.access_token,
            response_ip: input.agreementResponse.response_ip || undefined,
            response_user_agent: input.agreementResponse.response_user_agent || undefined,
            ...(input.agreementResponse.metadata || {})
          },
          current_date: new Date(),
          formatted_date: new Date().toLocaleDateString(),
          formatted_datetime: new Date().toLocaleString()
        },
        error: error.message
      });
    }
  }
);

import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";
import { trackAgreementViewWorkflow } from "../../../../workflows/agreements/track-agreement-view";
import * as Handlebars from "handlebars";
import { Logger } from "@medusajs/framework/types";

// GET /web/agreement/:id - Fetch agreement for public access with token validation
export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  const { id } = req.params;
  const { token } = req.query;

  if (!token) {
    return res.status(400).json({
      error: "Access token is required",
      message: "Please provide a valid access token to view this agreement"
    });
  }

  try {
    // Use workflow to fetch and track agreement view
    const { result } = await trackAgreementViewWorkflow(req.scope).run({
      input: {
        response_id: id,
        access_token: token as string,
      },
    });

    // Process Handlebars templates at runtime
    const templateData = {
      // Agreement data
      agreement: {
        id: result.agreement.id,
        title: result.agreement.title,
        subject: result.agreement.subject,
        valid_from: result.agreement.valid_from || undefined,
        valid_until: result.agreement.valid_until || undefined,
        status: result.agreement.status,
        template_key: result.agreement.template_key || undefined,
        from_email: result.agreement.from_email || undefined,
        sent_count: result.agreement.sent_count,
        response_count: result.agreement.response_count,
        agreed_count: result.agreement.agreed_count,
        ...(result.agreement.metadata || {})
      },
      // Response data
      response: {
        id: result.response.id,
        status: result.response.status,
        email_sent_to: result.response.email_sent_to,
        sent_at: result.response.sent_at,
        viewed_at: result.response.viewed_at || undefined,
        responded_at: result.response.responded_at || undefined,
        agreed: result.response.agreed ?? undefined,
        response_notes: result.response.response_notes || undefined,
        email_opened: result.response.email_opened,
        email_opened_at: result.response.email_opened_at || undefined,
        access_token: result.response.access_token,
        response_ip: result.response.response_ip || undefined,
        response_user_agent: result.response.response_user_agent || undefined,
        ...(result.response.metadata || {})
      },
      // Person data (if available)
      person: result.person ? {
        id: result.person.id,
        first_name: result.person.first_name || undefined,
        last_name: result.person.last_name || undefined,
        email: result.person.email || undefined,
        date_of_birth: result.person.date_of_birth || undefined,
        state: result.person.state || undefined,
        avatar: result.person.avatar || undefined,
        ...(result.person.metadata || {})
      } : undefined,
      // Utility data
      current_date: new Date(),
      formatted_date: new Date().toLocaleDateString(),
      formatted_datetime: new Date().toLocaleString()
    };

    // Process templates with Handlebars
    let processedContent = result.agreement.content;
    let processedSubject = result.agreement.subject;

    try {
      const contentTemplate = Handlebars.compile(result.agreement.content);
      processedContent = contentTemplate(templateData);
      
      const subjectTemplate = Handlebars.compile(result.agreement.subject);
      processedSubject = subjectTemplate(templateData);
      
      console.log('Template processing successful at runtime');
    } catch (error) {
      const logger: Logger = req.scope.resolve("logger");
      logger.warn(`Handlebars template processing failed for agreement ${result.agreement.id}, falling back to original content: ${error.message}`);
      // Keep original content if processing fails
    }

    // Calculate can_respond logic in the API route
    const can_respond = result.response.status !== "agreed" && 
                       result.response.status !== "disagreed" &&
                       (!result.agreement.valid_until || new Date() <= new Date(result.agreement.valid_until));

    // Return the agreement data for public viewing with processed templates
    res.status(200).json({
      agreement: {
        id: result.agreement.id,
        title: result.agreement.title,
        content: processedContent,
        subject: processedSubject,
        valid_from: result.agreement.valid_from,
        valid_until: result.agreement.valid_until,
        status: result.agreement.status,
      },
      response: {
        id: result.response.id,
        status: result.response.status,
        email_sent_to: result.response.email_sent_to,
        sent_at: result.response.sent_at,
        viewed_at: result.response.viewed_at,
        responded_at: result.response.responded_at,
        agreed: result.response.agreed,
      },
      person: result.person ? {
        id: result.person.id,
        first_name: result.person.first_name || undefined,
        last_name: result.person.last_name || undefined,
        email: result.person.email || undefined,
        date_of_birth: result.person.date_of_birth || undefined,
        state: result.person.state || undefined,
        avatar: result.person.avatar || undefined,
        ...(result.person.metadata || {})
      } : undefined,
      can_respond
    });

  } catch (error) {
    if (error instanceof MedusaError) {
      const statusMap = {
        [MedusaError.Types.NOT_FOUND]: 404,
        [MedusaError.Types.UNAUTHORIZED]: 403,
        [MedusaError.Types.NOT_ALLOWED]: 410,
        [MedusaError.Types.DB_ERROR]: 500,
      };
      
      const status = statusMap[error.type] || 500;
      
      return res.status(status).json({
        error: error.type,
        message: error.message
      });
    }

    console.error("Error fetching agreement:", error);
    return res.status(500).json({
      error: "Internal server error",
      message: "An error occurred while fetching the agreement"
    });
  }
};

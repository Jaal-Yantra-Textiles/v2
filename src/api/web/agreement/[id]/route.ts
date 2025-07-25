import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";
import { trackAgreementViewWorkflow } from "../../../../workflows/agreements/track-agreement-view";

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

    // Calculate can_respond logic in the API route
    const can_respond = result.response.status !== "agreed" && 
                       result.response.status !== "disagreed" &&
                       (!result.agreement.valid_until || new Date() <= new Date(result.agreement.valid_until));

    // Return the agreement data for public viewing
    res.status(200).json({
      agreement: {
        id: result.agreement.id,
        title: result.agreement.title,
        content: result.agreement.content,
        subject: result.agreement.subject,
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

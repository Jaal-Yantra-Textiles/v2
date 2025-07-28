import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { AGREEMENTS_MODULE } from "../../../../../modules/agreements";
import { WebAgreementResponseSchema } from "../../validators";
import AgreementsService from "../../../../../modules/agreements/service";

// POST /web/agreement/:id/respond - Submit agreement response (agree/disagree)
export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  const { id } = req.params;

  try {
    // Validate request body
    const validatedData = WebAgreementResponseSchema.parse(req.body);
    const { token, agreed, response_notes, response_ip, response_user_agent } = validatedData;

    const agreementsService: AgreementsService = req.scope.resolve(AGREEMENTS_MODULE);

    // First, find the agreement response by ID and validate the token
    const agreementResponse = await agreementsService.retrieveAgreementResponse(id, {
      relations: ["agreement"]
    });

    if (!agreementResponse) {
      return res.status(404).json({
        error: "Agreement response not found",
        message: "The requested agreement response does not exist"
      });
    }

    // Validate the access token
    if (agreementResponse.access_token !== token) {
      return res.status(403).json({
        error: "Invalid access token",
        message: "The provided access token is invalid or has expired"
      });
    }

    // Check if already responded
    if (agreementResponse.status === "agreed" || agreementResponse.status === "disagreed") {
      return res.status(409).json({
        error: "Already responded",
        message: "You have already responded to this agreement"
      });
    }

    // Check if agreement has expired
    const agreement = agreementResponse.agreement;
    if (agreement.valid_until && new Date() > new Date(agreement.valid_until)) {
      return res.status(410).json({
        error: "Agreement expired",
        message: "This agreement has expired and can no longer be responded to"
      });
    }

    // Update the agreement response
    const updatedResponses = await agreementsService.updateAgreementResponses({
      selector: { id },
      data: {
        status: agreed ? "agreed" : "disagreed",
        agreed: agreed,
        responded_at: new Date(),
        response_notes: response_notes || null,
        response_ip: response_ip || null,
        response_user_agent: response_user_agent || null,
      }
    });
    
    const updatedResponse = updatedResponses[0]; // Get the first (and only) updated response

    // Update agreement statistics
    if (agreed) {
      await agreementsService.updateAgreements({
        selector: { id: agreement.id },
        data: {
          agreed_count: (agreement.agreed_count || 0) + 1,
          response_count: (agreement.response_count || 0) + 1,
        }
      });
    } else {
      await agreementsService.updateAgreements({
        selector: { id: agreement.id },
        data: {
          response_count: (agreement.response_count || 0) + 1,
        }
      });
    }

    res.status(200).json({
      message: agreed ? "Agreement accepted successfully" : "Agreement declined successfully",
      response: {
        id: updatedResponse.id,
        status: updatedResponse.status,
        agreed: updatedResponse.agreed,
        responded_at: updatedResponse.responded_at,
        response_notes: updatedResponse.response_notes,
      }
    });

  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({
        error: "Validation error",
        message: "Invalid request data",
        details: error.errors
      });
    }

    console.error("Error submitting agreement response:", error);
    return res.status(500).json({
      error: "Internal server error",
      message: "An error occurred while submitting your response"
    });
  }
};

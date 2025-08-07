import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";
import PersonAgreementLink from "../../../../../links/person-agreements";
import PersonAgreementResponseLink from "../../../../../links/person-agreement-responses";

// GET /admin/persons/:id/agreements - Fetch all agreements for a person
export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  const { id: person_id } = req.params;
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  // First, get the agreements for this person
  const { data: agreementData } = await query.graph({
    entity: PersonAgreementLink.entryPoint,
    fields: ["agreement.*", "person.*"],
    filters: {
      person_id: person_id,
    },
  });

  if (!agreementData || agreementData.length === 0) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `No agreements found for person with id "${person_id}"`
    );
  }

  // Extract person info and agreements
  const personInfo = agreementData[0].person;
  const agreements = agreementData.map(record => record.agreement);

  // Then, get the agreement responses for this person
  const { data: responseData } = await query.graph({
    entity: PersonAgreementResponseLink.entryPoint,
    fields: ["agreement_response.*", "person.*"],
    filters: {
      person_id: person_id,
    },
  });

  // Group responses by agreement_id for easier access
  const responsesByAgreement: Record<string, any[]> = {};
  if (responseData) {
    responseData.forEach(record => {
      const agreementId = record.agreement_response.agreement_id;
      if (!responsesByAgreement[agreementId]) {
        responsesByAgreement[agreementId] = [];
      }
      responsesByAgreement[agreementId].push(record.agreement_response);
    });
  }

  // Add responses to each agreement
  const agreementsWithResponses = agreements.map(agreement => ({
    ...agreement,
    responses: responsesByAgreement[agreement.id] || []
  }));

  res.status(200).json({
    person_id: personInfo.id,
    person_name: `${personInfo.first_name} ${personInfo.last_name}`.trim(),
    person_email: personInfo.email,
    agreements: agreementsWithResponses,
    count: agreementsWithResponses.length
  });
};

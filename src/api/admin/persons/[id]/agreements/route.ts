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
  // 1) Fetch agreements for this person via module link (graph)
  const { data: agreementData } = await query.graph({
    entity: PersonAgreementLink.entryPoint,
    fields: ["agreement.*", "person.*"],
    filters: { person_id },
  });

  if (!agreementData || agreementData.length === 0) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `No agreements found for person with id "${person_id}"`
    );
  }

  const personInfo = agreementData[0].person;
  const agreements = agreementData.map((rec: any) => rec.agreement);

  // 2) Fetch agreement responses for this person via module link (graph)
  const { data: responseData } = await query.graph({
    entity: PersonAgreementResponseLink.entryPoint,
    fields: ["agreement_response.*", "person.*"],
    filters: { person_id },
  });

  // Group responses by agreement_id for easier access
  const responsesByAgreement: Record<string, any[]> = {};
  for (const rec of responseData || []) {
    const ar = rec.agreement_response;
    const agreementId = ar.agreement_id;
    if (!responsesByAgreement[agreementId]) {
      responsesByAgreement[agreementId] = [];
    }
    responsesByAgreement[agreementId].push(ar);
  }

  // Attach responses and compute per-person counters
  const agreementsWithResponses = agreements.map((agreement: any) => {
    const resps = responsesByAgreement[agreement.id] || [];
    const perPersonSent = resps.length;
    const perPersonAgreed = resps.filter((r: any) => ["agreed", "accepted", "signed"].includes((r?.status || "").toLowerCase())).length;
    return {
      ...agreement,
      responses: resps,
      sent_count: perPersonSent,
      response_count: perPersonSent,
      agreed_count: perPersonAgreed,
    };
  });

  res.status(200).json({
    person_id: personInfo.id,
    person_name: `${personInfo.first_name || ""} ${personInfo.last_name || ""}`.trim(),
    person_email: personInfo.email,
    agreements: agreementsWithResponses,
    count: agreementsWithResponses.length,
  });
};

import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import PersonAgreementLink from "../../../../../links/person-agreements";
import PersonAgreementResponseLink from "../../../../../links/person-agreement-responses";

// GET /admin/persons/:id/agreements - Fetch all agreements for a person
export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  const { id: person_id } = req.params;
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  // 1) Get person info
  const { data: persons } = await query.graph({
    entity: "person",
    fields: ["id", "first_name", "last_name", "email"],
    filters: { id: person_id },
  });

  if (!persons || persons.length === 0) {
    return res.status(200).json({
      person_id,
      person_name: "",
      person_email: "",
      agreements: [],
      count: 0,
    });
  }

  const personInfo = persons[0];

  // 2) Get agreements linked to this person via the link entry point
  const { data: agreementLinks } = await query.graph({
    entity: PersonAgreementLink.entryPoint,
    fields: ["person_id", "agreement_id", "agreement.*"],
    filters: { person_id },
  });

  const agreements = (agreementLinks || []).map((l: any) => l.agreement).filter(Boolean);

  if (agreements.length === 0) {
    return res.status(200).json({
      person_id: personInfo.id,
      person_name: `${personInfo.first_name || ""} ${personInfo.last_name || ""}`.trim(),
      person_email: personInfo.email,
      agreements: [],
      count: 0,
    });
  }

  // 3) Get agreement responses linked to this person via the link entry point
  const { data: responseLinks } = await query.graph({
    entity: PersonAgreementResponseLink.entryPoint,
    fields: ["person_id", "agreement_response_id", "agreement_response.*"],
    filters: { person_id },
  });

  const responses = (responseLinks || []).map((l: any) => l.agreement_response).filter(Boolean);

  // Group responses by agreement_id
  const responsesByAgreement: Record<string, any[]> = {};
  for (const ar of responses) {
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
    const perPersonAgreed = resps.filter((r: any) =>
      ["agreed", "accepted", "signed"].includes((r?.status || "").toLowerCase())
    ).length;
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

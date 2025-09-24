import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";

// GET /admin/persons/:id/agreements - Fetch all agreements for a person
export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  const { id: person_id } = req.params;
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  // Fetch agreements linked to this person via Index Module (agreement.people)
  const { data: agreements } = await query.index({
    entity: "agreement",
    fields: ["*", "people.*"],
    filters: {
      people: { id: person_id },
    },
  });

  if (!agreements || agreements.length === 0) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `No agreements found for person with id "${person_id}"`
    );
  }

  // Person info from first joined record's linked people
  const personInfo = ((agreements[0] as any)?.people?.[0]) || {};

  // Fetch responses for this person across all agreements via Index Module
  const { data: responses } = await query.index({
    entity: "agreement_response",
    fields: ["*", "people.*"],
    filters: {
      people: { id: person_id },
    },
  });

  // Group responses by agreement_id for easier access
  const responsesByAgreement: Record<string, any[]> = {};
  for (const r of responses || []) {
    const agreementId = (r as any).agreement_id;
    if (!responsesByAgreement[agreementId]) {
      responsesByAgreement[agreementId] = [];
    }
    responsesByAgreement[agreementId].push(r);
  }

  // Attach responses and compute person-scoped counters
  const agreementsWithResponses = (agreements || []).map((agreement: any) => {
    const aId = agreement.id;
    const resps = responsesByAgreement[aId] || [];
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

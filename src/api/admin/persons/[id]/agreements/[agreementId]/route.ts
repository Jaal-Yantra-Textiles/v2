import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";

// GET /admin/persons/:id/agreements/:agreementId - Fetch a specific agreement for a person (Index-based)
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id: person_id, agreementId: agreement_id } = req.params as { id: string; agreementId: string };
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  // Fetch the specific agreement linked to this person
  const { data: agreements } = await query.index({
    entity: "agreement",
    fields: ["*", "people.*"],
    filters: {
      id: agreement_id,
      people: { id: person_id },
    },
  });

  if (!agreements || agreements.length === 0) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Agreement with id "${agreement_id}" not found for person "${person_id}"`
    );
  }

  const agreement = agreements[0] as any;
  const person = (agreement.people?.[0]) || {};

  // Fetch responses for this person for this agreement
  const { data: responses } = await query.index({
    entity: "agreementResponse",
    fields: ["*", "person.*"],
    filters: {
      person: { id: person_id },
      agreement_id,
    },
  });

  const resps = responses || [];
  const perPersonSent = resps.length;
  const perPersonAgreed = resps.filter((r: any) => ["agreed", "accepted", "signed"].includes((r?.status || "").toLowerCase())).length;

  res.status(200).json({
    person_id: person.id,
    person_name: `${person.first_name || ""} ${person.last_name || ""}`.trim(),
    person_email: person.email,
    agreement: {
      ...agreement,
      responses: resps,
      sent_count: perPersonSent,
      response_count: perPersonSent,
      agreed_count: perPersonAgreed,
    },
  });
};

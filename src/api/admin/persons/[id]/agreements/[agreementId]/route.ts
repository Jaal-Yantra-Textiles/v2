import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";
import PersonAgreementLink from "../../../../../../links/person-agreements";
import PersonAgreementResponseLink from "../../../../../../links/person-agreement-responses";

// GET /admin/persons/:id/agreements/:agreementId - Fetch a specific agreement for a person
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id: person_id, agreementId: agreement_id } = req.params as { id: string; agreementId: string };
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  // 1) Get person info
  const { data: personData } = await query.graph({
    entity: "person",
    fields: ["id", "first_name", "last_name", "email"],
    filters: { id: person_id },
  });

  const person = personData?.[0] || {} as any;

  // 2) Check this agreement is linked to this person via the link entry point
  const { data: agreementLinks } = await query.graph({
    entity: PersonAgreementLink.entryPoint,
    fields: ["person_id", "agreement_id", "agreement.*"],
    filters: { person_id, agreement_id },
  });

  const agreement = agreementLinks?.[0]?.agreement;

  if (!agreement) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Agreement with id "${agreement_id}" not found for person "${person_id}"`
    );
  }

  // 3) Get this person's responses via the link entry point
  const { data: responseLinks } = await query.graph({
    entity: PersonAgreementResponseLink.entryPoint,
    fields: ["person_id", "agreement_response_id", "agreement_response.*"],
    filters: { person_id },
  });

  // Filter to only responses for this specific agreement
  const responses = (responseLinks || [])
    .map((l: any) => l.agreement_response)
    .filter((r: any) => r?.agreement_id === agreement_id);

  const perPersonSent = responses.length;
  const perPersonAgreed = responses.filter((r: any) =>
    ["agreed", "accepted", "signed"].includes((r?.status || "").toLowerCase())
  ).length;

  res.status(200).json({
    person_id: person.id,
    person_name: `${person.first_name || ""} ${person.last_name || ""}`.trim(),
    person_email: person.email,
    agreement: {
      ...agreement,
      responses,
      sent_count: perPersonSent,
      response_count: perPersonSent,
      agreed_count: perPersonAgreed,
    },
  });
};

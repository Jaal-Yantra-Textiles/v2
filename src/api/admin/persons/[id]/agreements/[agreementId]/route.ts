import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";
import PersonAgreementLink from "../../../../../../links/person-agreements";

// GET /admin/persons/:id/agreements/:agreementId - Fetch a specific agreement for a person
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id: person_id, agreementId: agreement_id } = req.params;
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  const { data } = await query.graph({
    entity: PersonAgreementLink.entryPoint,
    fields: ["agreement.*", "person.*"],
    filters: {
      person_id: person_id,
      agreement_id: agreement_id,
    },
  });

  if (!data || data.length === 0) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Agreement with id "${agreement_id}" not found for person "${person_id}"`
    );
  }

  const record = data[0];
  const { person, agreement } = record;

  res.status(200).json({
    person_id: person.id,
    person_name: `${person.first_name} ${person.last_name}`.trim(),
    person_email: person.email,
    agreement
  });
};

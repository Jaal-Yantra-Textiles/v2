import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";
import PersonAgreementLink from "../../../../../links/person-agreements";

// GET /admin/persons/:id/agreements - Fetch all agreements for a person
export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  const { id: person_id } = req.params;
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  const { data } = await query.graph({
    entity: PersonAgreementLink.entryPoint,
    fields: ["agreement.*", "person.*"],
    filters: {
      person_id: person_id,
    },
  });

  if (!data || data.length === 0) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `No agreements found for person with id "${person_id}"`
    );
  }

  // Extract person info from first record (same for all records)
  const personInfo = data[0].person;
  const agreements = data.map(record => record.agreement);

  res.status(200).json({
    person_id: personInfo.id,
    person_name: `${personInfo.first_name} ${personInfo.last_name}`.trim(),
    person_email: personInfo.email,
    agreements: agreements,
    count: agreements.length
  });
};

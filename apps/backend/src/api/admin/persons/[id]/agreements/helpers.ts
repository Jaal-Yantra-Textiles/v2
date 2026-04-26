import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import PersonAgreementLink from "../../../../../links/person-agreements";
import PersonAgreementResponseLink from "../../../../../links/person-agreement-responses";

export const refetchPersonWithAgreements = async (
  personId: string,
  scope: any,
  fields?: string[]
) => {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY);

  // Get person info
  const { data: persons } = await query.graph({
    entity: "person",
    fields: ["id", "first_name", "last_name", "email"],
    filters: { id: personId },
  });

  if (!persons?.[0]) return null;

  const person = persons[0];

  // Get linked agreements via link entry point
  const { data: agreementLinks } = await query.graph({
    entity: PersonAgreementLink.entryPoint,
    fields: ["agreement_id", "agreement.*"],
    filters: { person_id: personId },
  });

  const agreements = (agreementLinks || []).map((l: any) => l.agreement).filter(Boolean);

  // Get linked responses via link entry point
  const { data: responseLinks } = await query.graph({
    entity: PersonAgreementResponseLink.entryPoint,
    fields: ["agreement_response_id", "agreement_response.*"],
    filters: { person_id: personId },
  });

  const responses = (responseLinks || []).map((l: any) => l.agreement_response).filter(Boolean);

  return { ...person, agreements, agreement_responses: responses };
};

export const refetchPersonAgreement = async (
  personId: string,
  agreementId: string,
  scope: any,
  fields?: string[]
) => {
  const person = await refetchPersonWithAgreements(personId, scope, fields);

  if (!person) return null;

  const agreement = person.agreements?.find((a: any) => a.id === agreementId);

  return agreement ? { person, agreement } : null;
};

import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

export const refetchPersonWithAgreements = async (
  personId: string,
  scope: any,
  fields?: string[]
) => {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY);
  
  const defaultFields = [
    "id",
    "first_name", 
    "last_name",
    "email",
    "agreements.*",
    "agreements.responses.*"
  ];

  const { data } = await query.graph({
    entity: "person",
    fields: fields || defaultFields,
    filters: { id: personId },
  });

  return data?.[0];
};

export const refetchPersonAgreement = async (
  personId: string,
  agreementId: string,
  scope: any,
  fields?: string[]
) => {
  const person = await refetchPersonWithAgreements(personId, scope, fields);
  
  if (!person) {
    return null;
  }

  const agreement = person.agreements?.find(a => a.id === agreementId);
  
  return agreement ? { person, agreement } : null;
};

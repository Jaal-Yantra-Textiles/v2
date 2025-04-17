import {  useParams } from "react-router-dom";
import { usePerson, useUpdatePerson } from "../../../../../hooks/api/persons";
import { MetadataForm } from "../../../../../components/common/medata-form";



const PersonMetadata = () => {
  const { id } = useParams();
  const { person, isPending, isError, error } = usePerson(id!);

  const { mutateAsync, isPending: isMutating } = useUpdatePerson(person?.id!);

  if (isError) {
    throw error;
  }

  return (
    <MetadataForm
      metadata={person?.metadata}
      hook={mutateAsync}
      isPending={isPending}
      isMutating={isMutating}
    />
  );
};

export default PersonMetadata;



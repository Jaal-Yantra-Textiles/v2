import {  useParams } from "react-router-dom";
import { MetadataForm } from "../../../../../components/common/medata-form";
import { useDesign, useUpdateDesign } from "../../../../../hooks/api/designs";



const DesignMetadata = () => {
  const { id } = useParams();
  
  const { design, isPending, isError, error } = useDesign(id!);

  const { mutateAsync, isPending: isMutating } = useUpdateDesign(design?.id!);

  if (isError) {
    throw error;
  }

  return (
    <MetadataForm
      metadata={design?.metadata}
      hook={mutateAsync}
      isPending={isPending}
      isMutating={isMutating}
    />
  );
};

export default DesignMetadata;



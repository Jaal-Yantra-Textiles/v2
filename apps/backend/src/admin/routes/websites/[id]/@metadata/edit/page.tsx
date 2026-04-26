import {  useParams } from "react-router-dom";
import { MetadataForm } from "../../../../../components/common/medata-form";
import { useUpdateWebsite, useWebsite } from "../../../../../hooks/api/websites";



const WebsiteMetadata = () => {
  const { id } = useParams();
  

  const { website, isPending, isError, error } = useWebsite(id!);

  const { mutateAsync, isPending: isMutating } = useUpdateWebsite(website?.id!);

  if (isError) {
    throw error;
  }

  return (
    <MetadataForm
      metadata={website?.metadata}
      hook={mutateAsync}
      isPending={isPending}
      isMutating={isMutating}
    />
  );
};

export default WebsiteMetadata;



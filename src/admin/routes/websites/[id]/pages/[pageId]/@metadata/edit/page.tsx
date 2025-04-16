import {  useParams } from "react-router-dom";
import { MetadataForm } from "@/components/common/medata-form";
import { useUpdatePage, usePage } from "../../../../../../../hooks/api/pages";


const WebsitePageMetadata = () => {
  const { id, pageId } = useParams();
  

  const { page, isPending, isError, error } = usePage(id!, pageId!);

  const { mutateAsync, isPending: isMutating } = useUpdatePage(id!, pageId!);

  if (isError) {
    throw error;
  }

  return (
    <MetadataForm
      metadata={page?.metadata}
      hook={mutateAsync}
      isPending={isPending}
      isMutating={isMutating}
    />
  );
};

export default WebsitePageMetadata;



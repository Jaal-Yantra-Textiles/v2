import {  useParams } from "react-router-dom";
import { useUpdatePage, usePage } from "../../../../../../../hooks/api/pages";
import { PublicMetadataForm } from "../../../../../../../components/common/public-metadata-form";


const WebsitePublicPageMetadata = () => {
  const { id, pageId } = useParams();
  

  const { page, isPending, isError, error } = usePage(id!, pageId!);

  const { mutateAsync, isPending: isMutating } = useUpdatePage(id!, pageId!);

  if (isError) {
    throw error;
  }

  return (
    <PublicMetadataForm
      public_metadata={page?.public_metadata}
      hook={mutateAsync}
      isPending={isPending}
      isMutating={isMutating}
    />
  );
};

export default WebsitePublicPageMetadata;



import { useParams } from "react-router-dom";
import { MetadataForm } from "../../../../../components/common/medata-form";
import { useSocialPost, useUpdateSocialPost } from "../../../../../hooks/api/social-posts";

const SocialPostMetadata = () => {
  const { id } = useParams();
  
  const { socialPost, isPending, isError, error } = useSocialPost(id!);

  const { mutateAsync, isPending: isMutating } = useUpdateSocialPost(socialPost?.id!);

  if (isError) {
    throw error;
  }

  // Wrapper to match MetadataForm's expected hook signature
  const handleMetadataUpdate = async (
    params: { metadata?: Record<string, any> | null },
    callbacks: { onSuccess: () => void; onError: (error: any) => void }
  ) => {
    try {
      const result = await mutateAsync(params);
      callbacks.onSuccess();
      return result;
    } catch (error) {
      callbacks.onError(error as any);
      throw error;
    }
  };

  return (
    <MetadataForm
      metadata={socialPost?.metadata}
      hook={handleMetadataUpdate}
      isPending={isPending}
      isMutating={isMutating}
    />
  );
};

export default SocialPostMetadata;

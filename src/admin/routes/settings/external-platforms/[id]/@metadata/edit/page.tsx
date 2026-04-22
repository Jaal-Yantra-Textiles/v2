import { useParams } from "react-router-dom"
import { MetadataForm } from "../../../../../../components/common/medata-form"
import {
  useSocialPlatform,
  useUpdateSocialPlatform,
} from "../../../../../../hooks/api/social-platforms"

const ExternalPlatformMetadata = () => {
  const { id } = useParams()
  const { socialPlatform, isPending, isError, error } = useSocialPlatform(id!) as any
  const { mutateAsync, isPending: isMutating } = useUpdateSocialPlatform(id!)

  if (isError) {
    throw error
  }

  return (
    <MetadataForm
      metadata={socialPlatform?.metadata}
      hook={mutateAsync as any}
      isPending={isPending}
      isMutating={isMutating}
    />
  )
}

export default ExternalPlatformMetadata

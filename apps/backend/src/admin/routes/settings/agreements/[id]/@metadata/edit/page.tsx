import { useParams } from "react-router-dom"
import { MetadataForm } from "../../../../../../components/common/medata-form"
import {
  useAgreement,
  useUpdateAgreement,
} from "../../../../../../hooks/api/agreement"

const AgreementMetadata = () => {
  const { id } = useParams()
  const { agreement, isPending, isError, error } = useAgreement(id!) as any
  const { mutateAsync, isPending: isMutating } = useUpdateAgreement(id!)

  if (isError) {
    throw error
  }

  return (
    <MetadataForm
      metadata={agreement?.metadata}
      hook={mutateAsync as any}
      isPending={isPending}
      isMutating={isMutating}
    />
  )
}

export default AgreementMetadata

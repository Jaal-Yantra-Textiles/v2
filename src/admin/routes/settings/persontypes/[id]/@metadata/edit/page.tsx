import { useParams } from "react-router-dom"
import { MetadataForm } from "../../../../../../components/common/medata-form"
import {
  usePersonType,
  useUpdatePersonType,
} from "../../../../../../hooks/api/persontype"

const PersonTypeMetadata = () => {
  const { id } = useParams()
  const { personType, isPending, isError, error } = usePersonType(id!) as any
  const { mutateAsync, isPending: isMutating } = useUpdatePersonType(id!)

  if (isError) {
    throw error
  }

  return (
    <MetadataForm
      metadata={personType?.metadata}
      hook={mutateAsync as any}
      isPending={isPending}
      isMutating={isMutating}
    />
  )
}

export default PersonTypeMetadata

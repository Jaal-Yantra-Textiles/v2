import { useParams } from "react-router-dom"
import { MetadataForm } from "../../../../../../components/common/medata-form"
import { useForm, useUpdateForm } from "../../../../../../hooks/api/forms"

const FormMetadata = () => {
  const { id } = useParams()
  const { form, isPending, isError, error } = useForm(id!) as any
  const { mutateAsync, isPending: isMutating } = useUpdateForm(id!)

  if (isError) {
    throw error
  }

  return (
    <MetadataForm
      metadata={form?.metadata}
      hook={mutateAsync as any}
      isPending={isPending}
      isMutating={isMutating}
    />
  )
}

export default FormMetadata

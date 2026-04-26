import { useParams } from "react-router-dom"
import { MetadataForm } from "../../../../../../components/common/medata-form"
import {
  useEmailTemplate,
  useUpdateEmailTemplate,
} from "../../../../../../hooks/api/email-templates"

const EmailTemplateMetadata = () => {
  const { id } = useParams()
  const { emailTemplate, isPending, isError, error } = useEmailTemplate(id!) as any
  const { mutateAsync, isPending: isMutating } = useUpdateEmailTemplate(id!)

  if (isError) {
    throw error
  }

  return (
    <MetadataForm
      metadata={emailTemplate?.metadata}
      hook={mutateAsync as any}
      isPending={isPending}
      isMutating={isMutating}
    />
  )
}

export default EmailTemplateMetadata

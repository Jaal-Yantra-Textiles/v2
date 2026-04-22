import { useCallback } from "react"
import { useParams } from "react-router-dom"
import { MetadataForm } from "../../../../../components/common/medata-form"
import {
  usePartner,
  useUpdatePartner,
} from "../../../../../hooks/api/partners-admin"

const PartnerMetadata = () => {
  const { id } = useParams()
  const { partner, isPending, isError, error } = usePartner(id!) as any
  const { mutateAsync, isPending: isMutating } = useUpdatePartner()

  const hook = useCallback(
    (payload: { metadata?: Record<string, any> | null }, callbacks: any) =>
      mutateAsync({ id: id!, data: payload as any }, callbacks),
    [mutateAsync, id]
  )

  if (isError) {
    throw error
  }

  return (
    <MetadataForm
      metadata={partner?.metadata}
      hook={hook}
      isPending={isPending}
      isMutating={isMutating}
    />
  )
}

export default PartnerMetadata

import { useParams } from "react-router-dom"
import { MetadataForm } from "../../../../../components/common/medata-form"
import {
  useUpdateVisualFlow,
  useVisualFlow,
} from "../../../../../hooks/api/visual-flows"

const VisualFlowMetadata = () => {
  const { id } = useParams()
  const { data: flow, isPending, isError, error } = useVisualFlow(id!)
  const { mutateAsync, isPending: isMutating } = useUpdateVisualFlow(id!)

  if (isError) {
    throw error
  }

  return (
    <MetadataForm
      metadata={flow?.metadata as Record<string, any> | null | undefined}
      hook={mutateAsync as any}
      isPending={isPending}
      isMutating={isMutating}
    />
  )
}

export default VisualFlowMetadata

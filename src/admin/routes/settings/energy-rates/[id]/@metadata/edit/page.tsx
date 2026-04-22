import { useParams } from "react-router-dom"
import { MetadataForm } from "../../../../../../components/common/medata-form"
import {
  useEnergyRate,
  useUpdateEnergyRate,
} from "../../../../../../hooks/api/energy-rates"

const EnergyRateMetadata = () => {
  const { id } = useParams()
  const { energy_rate, isPending, isError, error } = useEnergyRate(id!) as any
  const { mutateAsync, isPending: isMutating } = useUpdateEnergyRate(id!)

  if (isError) {
    throw error
  }

  return (
    <MetadataForm
      metadata={energy_rate?.metadata}
      hook={mutateAsync as any}
      isPending={isPending}
      isMutating={isMutating}
    />
  )
}

export default EnergyRateMetadata

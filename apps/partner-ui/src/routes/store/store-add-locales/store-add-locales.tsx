import { RouteFocusModal } from "../../../components/modals/route-focus-modal"
import { Skeleton } from "../../../components/common/skeleton"
import { useStore } from "../../../hooks/api"
import { AddLocalesForm } from "./components/add-locales-form/add-locales-form"
import { useFeatureFlag } from "../../../providers/feature-flag-provider"
import { useNavigate } from "react-router-dom"

export const StoreAddLocales = () => {
  const isEnabled = useFeatureFlag("translation")
  const navigate = useNavigate()

  if (!isEnabled) {
    navigate(-1)
    return null
  }

  const { store, isPending, isError, error } = useStore()

  const ready = !!store && !isPending

  if (isError) {
    throw error
  }

  return (
    <RouteFocusModal>
      {!ready && (
        <div className="p-6 space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-9 w-full rounded-md" />
            </div>
          ))}
        </div>
      )}
      {ready && <AddLocalesForm store={store} />}
    </RouteFocusModal>
  )
}

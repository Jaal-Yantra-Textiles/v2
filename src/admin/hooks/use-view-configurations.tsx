import { useMemo } from "react"
import { toast } from "@medusajs/ui"
import {
  useActiveViewConfiguration,
  useCreateViewConfiguration,
  useDeleteViewConfiguration,
  useSetActiveViewConfiguration,
  useUpdateViewConfiguration,
  useViewConfigurations,
} from "./api/views"

export const useViewConfigurationActions = (entity: string) => {
  const listViews = useViewConfigurations(entity)
  const activeView = useActiveViewConfiguration(entity)

  const createView = useCreateViewConfiguration(entity, {
    onSuccess: () => {
      toast.success("View saved")
    },
    onError: (error) => {
      toast.error(error.message || "Failed to save view")
    },
  })

  const updateView = useUpdateViewConfiguration(entity, {
    onSuccess: () => {
      toast.success("View updated")
    },
    onError: (error) => {
      toast.error(error.message || "Failed to update view")
    },
  })

  const deleteView = useDeleteViewConfiguration(entity, {
    onSuccess: () => {
      toast.success("View deleted")
    },
    onError: (error) => {
      toast.error(error.message || "Failed to delete view")
    },
  })

  const setActiveView = useSetActiveViewConfiguration(entity, {
    onSuccess: () => {
      toast.success("View applied")
    },
    onError: (error) => {
      toast.error(error.message || "Failed to apply view")
    },
  })

  const result = useMemo(
    () => ({
      listViews,
      activeView,
      createView,
      updateView,
      deleteView,
      setActiveView,
    }),
    [listViews, activeView, createView, updateView, deleteView, setActiveView],
  )

  return result
}

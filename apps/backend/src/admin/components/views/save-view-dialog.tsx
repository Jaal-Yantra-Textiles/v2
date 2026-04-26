import React, { useState } from "react"
import { Button, Drawer, Heading, Input, Label, Text } from "@medusajs/ui"
import { useForm } from "react-hook-form"
import type { ViewConfiguration } from "../../hooks/api/views"
import {
  useCreateViewConfiguration,
  useUpdateViewConfiguration,
} from "../../hooks/api/views"

export type ViewDialogConfig = {
  filters?: Record<string, any>
  sorting?: { id: string; desc: boolean } | null
  search?: string
}

interface SaveViewDialogProps {
  entity: string
  currentColumns?: {
    visible: string[]
    order: string[]
  }
  currentConfiguration?: ViewDialogConfig
  editingView?: ViewConfiguration | null
  onClose: () => void
  onSaved: (view: ViewConfiguration) => void
}

interface SaveViewFormData {
  name: string
}

export const SaveViewDialog: React.FC<SaveViewDialogProps> = ({
  entity,
  currentColumns,
  currentConfiguration,
  editingView,
  onClose,
  onSaved,
}) => {
  const [isLoading, setIsLoading] = useState(false)
  const createView = useCreateViewConfiguration(entity)
  const updateView = useUpdateViewConfiguration(entity)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SaveViewFormData>({
    defaultValues: {
      name: editingView?.name ?? "",
    },
  })

  const buildConfiguration = () => {
    const baseConfig = currentConfiguration || {}
    const filters = baseConfig.filters || {}
    const sorting = baseConfig.sorting || null
    const search = baseConfig.search || ""

    return {
      visible_columns: currentColumns?.visible || editingView?.configuration.visible_columns || [],
      column_order: currentColumns?.order || editingView?.configuration.column_order || [],
      filters,
      sorting,
      search,
    }
  }

  const onSubmit = async (data: SaveViewFormData) => {
    const trimmedName = data.name.trim()
    if (!trimmedName) {
      return
    }

    setIsLoading(true)
    try {
      const configuration = buildConfiguration()

      if (editingView) {
        const result = await updateView.mutateAsync({
          id: editingView.id,
          name: trimmedName,
          configuration,
        })
        if (result.view_configuration) {
          onSaved(result.view_configuration)
        }
      } else {
        const result = await createView.mutateAsync({
          name: trimmedName,
          set_active: true,
          configuration,
        })
        if (result.view_configuration) {
          onSaved(result.view_configuration)
        }
      }
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Drawer open onOpenChange={onClose}>
      <Drawer.Content className="flex flex-col">
        <Drawer.Header>
          <Drawer.Title asChild>
            <Heading level="h2">
              {editingView ? "Edit view" : "Save current view"}
            </Heading>
          </Drawer.Title>
          <Drawer.Description asChild>
            <Text size="small">
              {editingView
                ? "Rename and update this view with your current filters."
                : "Give your current configuration a memorable name."}
            </Text>
          </Drawer.Description>
        </Drawer.Header>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-1 flex-col">
          <Drawer.Body className="flex-1">
            <div className="flex flex-col gap-y-2">
              <Label htmlFor="view-name" weight="plus">
                View name
              </Label>
              <Input
                id="view-name"
                autoFocus
                placeholder="e.g. Approved by Partner X"
                {...register("name", {
                  required: "Name is required",
                  validate: (value) => value.trim().length > 0 || "Name cannot be empty",
                })}
              />
              {errors.name && (
                <span className="text-sm text-ui-fg-error">{errors.name.message}</span>
              )}
            </div>
          </Drawer.Body>

          <Drawer.Footer>
            <Drawer.Close asChild>
              <Button variant="secondary" size="small" type="button">
                Cancel
              </Button>
            </Drawer.Close>
            <Button variant="primary" size="small" type="submit" isLoading={isLoading}>
              {editingView ? "Update" : "Save"}
            </Button>
          </Drawer.Footer>
        </form>
      </Drawer.Content>
    </Drawer>
  )
}

import {
  defaultDropAnimationSideEffects,
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  DropAnimation,
  KeyboardSensor,
  PointerSensor,
  UniqueIdentifier,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { zodResolver } from "@hookform/resolvers/zod"
import { Button, Checkbox, clx, toast, Tooltip } from "@medusajs/ui"
import {  useCallback, useState } from "react"
import { useFieldArray, useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { KeyboundForm } from "../../../../../../components/utilitites/key-bound-form"
import { AdminDesign, DesignMedia, useUpdateDesign } from "../../../../../../hooks/api/designs"
import { sdk } from "../../../../../../lib/config"
import { UploadMediaFormItem } from "./upload-media-form-item"
import { useDesignMediaViewContext } from "../design-media-view"
import { RouteFocusModal } from "../../../../../../components/modal/route-focus-modal"



type DesignMediaViewProps = {
  design: AdminDesign
}

// Define schema for media files
export const MediaSchema = z.object({
  id: z.string().optional(),
  field_id: z.string(),
  url: z.string(),
  isThumbnail: z.boolean(),
  file: z.any().optional(),
})

export const EditDesignMediaSchema = z.object({
  media: z.array(MediaSchema),
})

export type EditDesignMediaSchemaType = z.infer<typeof EditDesignMediaSchema>
type Media = z.infer<typeof MediaSchema>

export const EditDesignMediaForm = ({ design }: DesignMediaViewProps) => {
  const [selection, setSelection] = useState<Record<string, true>>({})
  const { t } = useTranslation()
  const { goToGallery } = useDesignMediaViewContext()

  const form = useForm<EditDesignMediaSchemaType>({
    defaultValues: {
      media: getDefaultValues(design.media_files || []),
    },
    resolver: zodResolver(EditDesignMediaSchema),
  })

  const { fields, append, remove, update } = useFieldArray({
    name: "media",
    control: form.control,
    keyName: "field_id",
  })

  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null)
    const { active, over } = event

    if (active.id !== over?.id) {
      const oldIndex = fields.findIndex((item) => item.field_id === active.id)
      const newIndex = fields.findIndex((item) => item.field_id === over?.id)

      form.setValue("media", arrayMove(fields, oldIndex, newIndex), {
        shouldDirty: true,
        shouldTouch: true,
      })
    }
  }

  const handleDragCancel = () => {
    setActiveId(null)
  }

  const { mutateAsync, isPending } = useUpdateDesign(design.id!)

  const handleSubmit = form.handleSubmit(async ({ media }) => {
    const filesToUpload = media
      .map((m, i) => ({ file: m.file, index: i }))
      .filter((m) => !!m.file)

    let uploaded: any[] = []

    if (filesToUpload.length) {
      const { files: uploads } = await sdk.admin.upload
        .create({ files: filesToUpload.map((m) => m.file) })
        .catch(() => {
          form.setError("media", {
            type: "invalid_file",
            message: "Failed to upload media files",
          })
          return { files: [] }
        })
      uploaded = uploads
    }

    const withUpdatedUrls = media.map((entry, i) => {
      const toUploadIndex = filesToUpload.findIndex((m) => m.index === i)
      if (toUploadIndex > -1 && uploaded[toUploadIndex]) {
        // For newly uploaded files, use the ID returned from the upload API
        // or generate one if not available
        return { 
          ...entry, 
          url: uploaded[toUploadIndex].url,
          id: uploaded[toUploadIndex].id || entry.field_id // Use the ID from the API or fallback to field_id
        }
      }
      return entry
    })
    
    const thumbnail = withUpdatedUrls.find((m) => m.isThumbnail)?.url
    
    // Create the base payload
    const payload = {
      media_files: withUpdatedUrls.map((file) => {
        // Create media file object with required properties
        const mediaFile = {
          url: file.url,
          isThumbnail: file.isThumbnail
        };
        
        // Only include id if it exists and is not empty
        if (file.id) {
          Object.assign(mediaFile, { id: file.id });
        }
        
        return mediaFile;
      })
    }
    
    // Only add thumbnail_url if a thumbnail is selected
    if (thumbnail) {
      Object.assign(payload, { thumbnail_url: thumbnail })
    }

    await mutateAsync(
      payload,
      {
        onSuccess: () => {
          toast.success("Media updated successfully")
          goToGallery()
        },
        onError: (error) => {
          toast.error(error.message || "Failed to update media")
        },
      }
    )
  })

  const handleCheckedChange = useCallback(
    (id: string) => {
      return (val: boolean) => {
        if (!val) {
          const { [id]: _, ...rest } = selection
          setSelection(rest)
        } else {
          setSelection((prev) => ({ ...prev, [id]: true }))
        }
      }
    },
    [selection]
  )

  const handleDelete = () => {
    const ids = Object.keys(selection)
    const indices = ids.map((id) => fields.findIndex((m) => m.id === id))

    remove(indices)
    setSelection({})
  }

  const handlePromoteToThumbnail = () => {
    const ids = Object.keys(selection)

    if (!ids.length) {
      return
    }

    const currentThumbnailIndex = fields.findIndex((m) => m.isThumbnail)

    if (currentThumbnailIndex > -1) {
      update(currentThumbnailIndex, {
        ...fields[currentThumbnailIndex],
        isThumbnail: false,
      })
    }

    const index = fields.findIndex((m) => m.id === ids[0])

    update(index, {
      ...fields[index],
      isThumbnail: true,
    })

    setSelection({})
  }

  const selectionCount = Object.keys(selection).length

  return (
    <RouteFocusModal.Form blockSearchParams form={form}>
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <KeyboundForm onSubmit={handleSubmit}>
          <div className="flex flex-col px-8 py-6 gap-y-8">
            <div>
              <UploadMediaFormItem
                form={form}
                append={append}
              />
            </div>
            <div className="flex flex-col gap-y-2">
              <div className="flex items-center justify-between">
                <div className="inter-small-semibold">
                  Uploaded Images
                </div>
                {selectionCount > 0 && (
                  <div className="flex items-center gap-x-2">
                    <Button
                      size="small"
                      variant="secondary"
                      onClick={handlePromoteToThumbnail}
                      disabled={selectionCount !== 1}
                    >
                      Set as thumbnail
                    </Button>
                    <Button
                      size="small"
                      variant="secondary"
                      onClick={handleDelete}
                    >
                      Delete
                    </Button>
                  </div>
                )}
              </div>

              <SortableContext
                items={fields.map((f) => f.field_id)}
                strategy={rectSortingStrategy}
              >
                <div className="grid grid-cols-3 md:grid-cols-6 lg:grid-cols-8 gap-2">
                  {fields.map((media) => {
                    return (
                      <MediaGridItem
                        key={media.field_id}
                        media={media}
                        checked={!!selection[media.id || ""]}
                        onCheckedChange={handleCheckedChange(
                          media.id || ""
                        )}
                      />
                    )
                  })}
                  <DragOverlay dropAnimation={dropAnimationConfig}>
                    {activeId ? (
                      <MediaGridItemOverlay
                        media={fields.find((m) => m.field_id === activeId)!}
                        checked={!!selection[fields.find((m) => m.field_id === activeId)?.id || ""]}
                      />
                    ) : null}
                  </DragOverlay>
                </div>
              </SortableContext>
            </div>
          </div>
          <div className="flex px-8 py-6 gap-x-2 border-t border-ui-border-base justify-end">
            <Button
              variant="secondary"
              onClick={goToGallery}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              isLoading={isPending}
              disabled={!form.formState.isDirty || !fields.length}
            >
              Save and close
            </Button>
          </div>
        </KeyboundForm>
        <DragOverlay>
          {activeId ? (
            <MediaGridItemOverlay
              media={
                fields.find((item) => item.field_id === activeId) as Media
              }
              checked={false}
            />
          ) : null}
        </DragOverlay>
      </DndContext>
    </RouteFocusModal.Form>
  )
}

// Helper function to convert the design media files to the format expected by the form
const getDefaultValues = (
  mediaFiles: DesignMedia[]
): Media[] => {
  return mediaFiles.map((media) => ({
    id: media.id,
    field_id: media.id || Math.random().toString(36).substring(2, 9),
    url: media.url,
    isThumbnail: media.isThumbnail || false,
  }))
}

// Drop animation configuration
const dropAnimationConfig: DropAnimation = {
  sideEffects: defaultDropAnimationSideEffects({
    styles: {
      active: {
        opacity: "0.5",
      },
    },
  }),
}

type MediaGridItemProps = {
  media: Media
  checked: boolean
  onCheckedChange: (value: boolean) => void
}

// Component for each media item in the grid
const MediaGridItem = ({
  media,
  checked,
  onCheckedChange,
}: MediaGridItemProps) => {
  const handleToggle = useCallback(
    (value: boolean) => {
      onCheckedChange(value)
    },
    [onCheckedChange]
  )
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: media.field_id })

  const style = {
    opacity: isDragging ? 0.4 : undefined,
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      className={clx(
        "shadow-elevation-card-rest hover:shadow-elevation-card-hover focus-visible:shadow-borders-focus bg-ui-bg-subtle-hover group relative aspect-square h-auto max-w-full overflow-hidden rounded-lg outline-none"
      )}
      style={style}
      ref={setNodeRef}
    >
      {media.isThumbnail && (
        <div className="absolute left-2 top-2">
          <Tooltip content="Thumbnail image">
            <div className="rounded-full bg-ui-tag-green-bg text-ui-tag-green-text p-1.5 flex items-center justify-center">
              <div className="w-3 h-3 rounded-full bg-ui-tag-green-icon" />
            </div>
          </Tooltip>
        </div>
      )}
      <div
        className={clx("absolute inset-0 cursor-grab touch-none outline-none", {
          "cursor-grabbing": isDragging,
        })}
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
      >
        <img
          src={media.url}
          alt="Design media"
          className="object-cover absolute inset-0 z-0 w-full h-full"
        />
      </div>
      <div className="absolute bottom-0 flex w-full justify-between p-2 z-10 bg-ui-bg-base bg-opacity-70">
        <Checkbox
          id={`select-${media.field_id}`}
          onCheckedChange={handleToggle}
          checked={checked}
          />
      </div>
    </div>
  )
}

// Overlay for drag operations
const MediaGridItemOverlay = ({
  media,
  checked,
}: {
  media: Media
  checked: boolean
}) => {
  return (
    <div
      className="shadow-elevation-card-rest bg-ui-bg-subtle-hover group relative aspect-square h-auto max-w-full overflow-hidden rounded-lg outline-none"
    >
      {media.isThumbnail && (
        <div className="absolute left-2 top-2">
          <Tooltip content="Thumbnail image">
            <div className="rounded-full bg-ui-tag-green-bg text-ui-tag-green-text p-1.5 flex items-center justify-center">
              <div className="w-3 h-3 rounded-full bg-ui-tag-green-icon" />
            </div>
          </Tooltip>
        </div>
      )}
      <div className="absolute inset-0 cursor-grabbing touch-none outline-none">
        <img
          src={media.url}
          alt="Design media"
          className="object-cover absolute inset-0 z-0 w-full h-full"
        />
      </div>
      <div className="absolute bottom-0 flex w-full justify-between p-2 z-10 bg-ui-bg-base bg-opacity-70">
        <Checkbox
          id={`select-${media.field_id}`}
          checked={checked}
        />
      </div>
    </div>
  )
}

export default EditDesignMediaForm

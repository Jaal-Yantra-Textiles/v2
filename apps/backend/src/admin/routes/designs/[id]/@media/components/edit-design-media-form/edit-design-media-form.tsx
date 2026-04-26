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
import { ArrowLeft, ThumbnailBadge } from "@medusajs/icons"
import { Button, Checkbox, CommandBar, Heading, IconButton, Tooltip, clx, toast } from "@medusajs/ui"
import { Fragment } from "react"
import { useCallback, useState } from "react"
import { useFieldArray, useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { z } from "@medusajs/framework/zod"
import { KeyboundForm } from "../../../../../../components/utilitites/key-bound-form"
import { AdminDesign, DesignMedia, useUpdateDesign } from "../../../../../../hooks/api/designs"
import { sdk } from "../../../../../../lib/config"
import { UploadMediaFormItem } from "./upload-media-form-item"
import { useDesignMediaViewContext } from "../design-media-view"
import { RouteFocusModal } from "../../../../../../components/modal/route-focus-modal"
import { Link } from "react-router-dom"
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
      }),
      // Add metadata with thumbnail information
      metadata: {}
    }
    
    // Only add thumbnail to metadata if a thumbnail is selected
    if (thumbnail) {
      payload.metadata = { 
        ...payload.metadata,
        thumbnail: thumbnail 
      }
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
    // Get the ID of the selected media item
    const selectedId = Object.keys(selection)[0]
    if (!selectedId) return

    // Find the current thumbnail and unset it
    const currentThumbnailIndex = fields.findIndex((m) => m.isThumbnail)
    if (currentThumbnailIndex > -1) {
      update(currentThumbnailIndex, {
        ...fields[currentThumbnailIndex],
        isThumbnail: false,
      })
    }

    // Find the selected item and set it as thumbnail
    const targetIndex = fields.findIndex((m) => m.id === selectedId)
    if (targetIndex > -1) {
      update(targetIndex, {
        ...fields[targetIndex],
        isThumbnail: true,
      })
    }
    setSelection({})
  }

  return (
    <RouteFocusModal.Form blockSearchParams form={form}>
      <KeyboundForm
        className="flex size-full flex-col overflow-hidden"
        onSubmit={handleSubmit}
      >
        <RouteFocusModal.Header>
          <div className="flex items-center justify-end w-full">
            <div className="flex justify-end gap-x-2">
              
              <Button variant="secondary" size="small" asChild>
              <Link to={{ pathname: `.`, search: 'view=gallery' }}>
                {t("products.media.galleryLabel")}
              </Link>
              </Button>
            </div>
            <div className="flex items-center gap-x-2">
              {Object.keys(selection).length > 0 && (
                <div className="flex items-center gap-x-2 text-ui-fg-subtle text-sm">
                  <span>
                    {t("general.itemsSelected", {
                      count: Object.keys(selection).length,
                      defaultValue: "{{count}} selected"
                    })}
                  </span>
                </div>
              )}
            </div>
          </div>
        </RouteFocusModal.Header>
        <RouteFocusModal.Body className="flex flex-col overflow-auto p-0">
          <div className="flex size-full flex-col-reverse lg:grid lg:grid-cols-[1fr_400px]">
            <DndContext
              sensors={sensors}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragCancel={handleDragCancel}
            >
              <div className="bg-ui-bg-subtle size-full overflow-auto">
                <div className="grid h-fit auto-rows-auto grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-6">
                  <SortableContext
                    items={fields.map((f) => f.field_id)}
                    strategy={rectSortingStrategy}
                  >
                    {fields.map((field) => {
                      const checked = !!selection[field.id || ""];
                      return (
                        <MediaGridItem
                          key={field.field_id}
                          media={field}
                          checked={checked}
                          onCheckedChange={handleCheckedChange(field.id || "")}
                        />
                      );
                    })}
                  </SortableContext>
                  <DragOverlay dropAnimation={dropAnimationConfig}>
                    {activeId && (() => {
                      const field = fields.find((f) => f.field_id === activeId);
                      if (!field) return null;
                      
                      const checked = !!selection[field.id || ""];
                      return (
                        <MediaGridItemOverlay
                          media={field}
                          checked={checked}
                        />
                      );
                    })()}
                  </DragOverlay>
                </div>
              </div>
            </DndContext>
            <div className="bg-ui-bg-base overflow-auto border-b px-6 py-4 lg:border-b-0 lg:border-l">
              <UploadMediaFormItem form={form} append={append} />
            </div>
          </div>
        </RouteFocusModal.Body>
        <CommandBar open={!!Object.keys(selection).length}>
          <CommandBar.Bar>
            <CommandBar.Value>
              {t("general.countSelected", {
                count: Object.keys(selection).length,
              })}
            </CommandBar.Value>
            <CommandBar.Seperator />
            {Object.keys(selection).length === 1 && (
              <Fragment>
                <CommandBar.Command
                  action={handlePromoteToThumbnail}
                  label={t("designs.media.makeThumbnail", "Set as thumbnail")}
                  shortcut="t"
                />
                <CommandBar.Seperator />
              </Fragment>
            )}
            <CommandBar.Command
              action={handleDelete}
              label={t("actions.delete", "Delete")}
              shortcut="d"
            />
          </CommandBar.Bar>
        </CommandBar>
        <RouteFocusModal.Footer>
          <div className="flex items-center justify-end gap-x-2">
            <Button
              variant="secondary"
              size="small"
              onClick={goToGallery}
              disabled={isPending}
            >
              {t("actions.cancel", "Cancel")}
            </Button>
            <Button 
              size="small" 
              type="submit" 
              isLoading={isPending}
            >
              {t("actions.save", "Save")}
            </Button>
          </div>
        </RouteFocusModal.Footer>
      </KeyboundForm>
    </RouteFocusModal.Form>
  )
}

interface MediaGridItemProps {
  media: MediaView
  checked: boolean
  onCheckedChange: (value: boolean) => void
}
const MediaGridItem = ({
  media,
  checked,
  onCheckedChange,
}: MediaGridItemProps) => {
  const { t } = useTranslation()

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
          <Tooltip content={t("products.media.thumbnailTooltip")}>
            <ThumbnailBadge />
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
      />
      <div
        className={clx("transition-fg absolute right-2 top-2 opacity-0", {
          "group-focus-within:opacity-100 group-hover:opacity-100 group-focus:opacity-100":
            !isDragging && !checked,
          "opacity-100": checked,
        })}
      >
        <Checkbox
          onClick={(e) => {
            e.stopPropagation()
          }}
          checked={checked}
          onCheckedChange={handleToggle}
        />
      </div>
      <img
        src={media.url}
        alt=""
        className="size-full object-cover object-center"
      />
    </div>
  )
}

interface MediaView {
  id?: string
  field_id: string
  url: string
  isThumbnail: boolean
}

export const MediaGridItemOverlay = ({
  media,
  checked,
}: {
  media: MediaView
  checked: boolean
}) => {
  return (
    <div className="shadow-elevation-card-rest hover:shadow-elevation-card-hover focus-visible:shadow-borders-focus bg-ui-bg-subtle-hover group relative aspect-square h-auto max-w-full cursor-grabbing overflow-hidden rounded-lg outline-none">
      {media.isThumbnail && (
        <div className="absolute left-2 top-2">
          <ThumbnailBadge />
        </div>
      )}
      <div
        className={clx("transition-fg absolute right-2 top-2 opacity-0", {
          "opacity-100": checked,
        })}
      >
        <Checkbox checked={checked} />
      </div>
      <img
        src={media.url}
        alt=""
        className="size-full object-cover object-center"
      />
    </div>
  )
}

export default EditDesignMediaForm

// Helper function to convert the design media files to the format expected by the form
function getDefaultValues(mediaFiles: DesignMedia[]): Media[] {
  return mediaFiles.map((m) => ({
    id: m.id,
    field_id: m.id || crypto.randomUUID(),
    url: m.url,
    isThumbnail: m.isThumbnail || false,
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

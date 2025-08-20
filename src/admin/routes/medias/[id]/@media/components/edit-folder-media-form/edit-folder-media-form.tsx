import { useState, useMemo } from "react"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { Button, CommandBar, IconButton, Text, clx, toast } from "@medusajs/ui"
import { useFieldArray, useForm } from "react-hook-form"
import { useQueryClient } from "@tanstack/react-query"
import { KeyboundForm } from "../../../../../../components/utilitites/key-bound-form"
import { RouteFocusModal } from "../../../../../../components/modal/route-focus-modal"
import { useFolderMediaViewContext } from "../folder-media-view/folder-media-view"
import { AdminMediaFolder } from "../../../../../../hooks/api/media-folders"
import { useUploadFolderMedia } from "../../../../../../hooks/api/media-folders/use-upload-folder-media"
import { mediaFolderQueryKeys } from "../../../../../../hooks/api/media-folders/use-media-folder"
import { mediaFolderDetailQueryKeys } from "../../../../../../hooks/api/media-folders/use-media-folder-detail"
import { Trash } from "@medusajs/icons"

const UploadEntrySchema = z.object({
  id: z.string().optional(),
  url: z.string().optional(),
  file: z.any(),
})

const EditFolderMediaSchema = z.object({
  uploads: z.array(UploadEntrySchema),
})

type EditFolderMediaFormType = z.infer<typeof EditFolderMediaSchema>

export const EditFolderMediaForm = ({ folder }: { folder: AdminMediaFolder }) => {
  const { goToGallery } = useFolderMediaViewContext()
  const { mutateAsync, isPending } = useUploadFolderMedia()
  const queryClient = useQueryClient()

  const form = useForm<EditFolderMediaFormType>({
    defaultValues: { uploads: [] },
    resolver: zodResolver(EditFolderMediaSchema),
  })

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "uploads",
    keyName: "_key",
  })

  const [selection, setSelection] = useState<Record<number, true>>({})

  const handleFilesSelected: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const files = Array.from(e.target.files || [])
    files.forEach((file) => append({ file }))
    // reset input so selecting the same file again works
    e.currentTarget.value = ""
  }

  const handleSubmit = form.handleSubmit(async ({ uploads }) => {
    const files = uploads.map((u) => u.file).filter(Boolean) as File[]
    if (!files.length) {
      toast.info("Select files to upload")
      return
    }

    let successCount = 0
    let failCount = 0
    const total = files.length
    let processed = 0
    // Show persistent loading toast with progress
    let progressToastId = toast.loading("Uploading files...", {
      description: `${processed}/${total} uploaded`,
      duration: Infinity,
    })
    for (const file of files) {
      try {
        await mutateAsync({ files: [file], folderId: folder.id })
        successCount++
      } catch (err: any) {
        failCount++
        toast.error(err?.message || "Upload failed")
      }
      // Update progress
      processed++
      if (progressToastId) {
        toast.dismiss(progressToastId)
      }
      progressToastId = toast.loading("Uploading files...", {
        description: `${processed}/${total} uploaded`,
        duration: Infinity,
      })
    }

    // Dismiss progress toast
    if (progressToastId) {
      toast.dismiss(progressToastId)
    }

    if (successCount > 0) {
      toast.success(`Uploaded ${successCount}/${files.length} files`)
      // Ensure folder views are up-to-date before navigating
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: mediaFolderQueryKeys.detail(folder.id) }),
        queryClient.invalidateQueries({ queryKey: mediaFolderDetailQueryKeys.detail(folder.id) }),
      ])
      await queryClient.refetchQueries({ queryKey: mediaFolderDetailQueryKeys.detail(folder.id) })
      form.reset({ uploads: [] })
      setSelection({})
      goToGallery()
    }
  })

  const selectedCount = useMemo(() => Object.keys(selection).length, [selection])

  const handleToggle = (index: number) => (checked: boolean) => {
    setSelection((prev) => {
      const next = { ...prev }
      if (!checked) delete next[index]
      else next[index] = true
      return next
    })
  }

  const handleDelete = () => {
    const indices = Object.keys(selection).map((k) => Number(k))
    const toRemove = Array.from(new Set(indices)).sort((a, b) => b - a)
    remove(toRemove)
    setSelection({})
  }

  return (
    <RouteFocusModal.Form blockSearchParams form={form}>
      <KeyboundForm className="flex size-full flex-col overflow-hidden" onSubmit={handleSubmit}>
        <RouteFocusModal.Header>
          <div className="flex items-center justify-end w-full gap-x-2">
            <input
              type="file"
              multiple
              onChange={handleFilesSelected}
              className="hidden"
              id="folder-media-file-input"
            />
            <label htmlFor="folder-media-file-input">
              <Button asChild variant="secondary" size="small">
                <span>Select files</span>
              </Button>
            </label>
            <Button size="small" type="submit" isLoading={isPending}>
              Upload
            </Button>
            <Button variant="secondary" size="small" type="button" onClick={goToGallery} disabled={isPending}>
              Cancel
            </Button>
          </div>
        </RouteFocusModal.Header>
        <RouteFocusModal.Body className="flex flex-col overflow-auto p-0">
          <div className="bg-ui-bg-subtle size-full overflow-auto">
            <div className="grid h-fit auto-rows-auto grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-6">
              {fields.length === 0 && (
                <div className="flex flex-col items-center justify-center gap-y-2 py-10 col-span-full">
                  <Text size="small" className="text-ui-fg-muted">No files selected</Text>
                  <Text size="small" className="text-ui-fg-subtle">Use Select files to choose files to upload</Text>
                </div>
              )}
              {fields.map((field, index) => (
                <UploadPreviewItem
                  key={(field as any)._key || index}
                  file={form.watch(`uploads.${index}.file`) as any}
                  selected={!!selection[index]}
                  onSelectedChange={handleToggle(index)}
                />
              ))}
            </div>
          </div>
        </RouteFocusModal.Body>
        <CommandBar open={selectedCount > 0}>
          <CommandBar.Bar>
            <CommandBar.Value>{selectedCount} selected</CommandBar.Value>
            <CommandBar.Seperator />
            <CommandBar.Command action={handleDelete} label="Delete" shortcut="d" />
          </CommandBar.Bar>
        </CommandBar>
      </KeyboundForm>
    </RouteFocusModal.Form>
  )
}

const UploadPreviewItem = ({ file, selected, onSelectedChange }: { file?: File; selected: boolean; onSelectedChange: (v: boolean) => void }) => {
  const url = useMemo(() => (file ? URL.createObjectURL(file) : ""), [file])
  
  return (
    <div className={clx("shadow-elevation-card-rest hover:shadow-elevation-card-hover focus-visible:shadow-borders-focus bg-ui-bg-subtle-hover group relative aspect-square h-auto max-w-full overflow-hidden rounded-lg outline-none", { "shadow-borders-focus": selected })}>
      {!!url ? (
        <img src={url} alt="preview" className="size-full object-cover" onClick={() => onSelectedChange(!selected)} />
      ) : (
        <div className="flex size-full items-center justify-center text-ui-fg-muted">No preview</div>
      )}
      <div className="absolute right-2 top-2 flex gap-1">
        <IconButton size="small" variant="transparent" className="text-ui-fg-muted" type="button" onClick={() => onSelectedChange(!selected)}>
          <Trash />
        </IconButton>
      </div>
    </div>
  )
}

export default EditFolderMediaForm

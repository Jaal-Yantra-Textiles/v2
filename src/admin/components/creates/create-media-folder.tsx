import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button, Heading, Input, Text, toast, Textarea, Select } from "@medusajs/ui";
import React from "react";

import { useRouteModal } from "../modal/use-route-modal";
import { RouteFocusModal } from "../modal/route-focus-modal";
import { KeyboundForm } from "../utilitites/key-bound-form";
import { useCreateMediaFolder } from "../../hooks/api/media-folders";
import { Form } from "../common/form";
import { FileUpload } from "../common/file-upload";
import { useUploadMedia } from "../../hooks/api/media-folders/use-upload-media";
import { useListMediaDictionaries } from "../../hooks/api/media-folders/use-list-dictionaries";

// Define a form-specific schema with validation rules
const mediaFolderFormSchema = z.object({
  name: z.string().min(1, "Folder name is required"),
  description: z.string().optional(),
  is_public: z.boolean().optional().default(false),
  parent_folder_id: z.string().nullable().optional(),
});

type MediaFolderFormData = z.infer<typeof mediaFolderFormSchema>;

export const CreateMediaFolderComponent = () => {
  const [pendingFiles, setPendingFiles] = React.useState<{ file: File; url: string }[]>([])
  const [albumIdsText, setAlbumIdsText] = React.useState<string>("")
  const form = useForm<MediaFolderFormData>({
    defaultValues: {
      name: "",
      description: "",
      is_public: false,
      parent_folder_id: null,
    },
    resolver: zodResolver(mediaFolderFormSchema) as any,
  });

  const { handleSuccess } = useRouteModal();

  const { mutateAsync, isPending } = useCreateMediaFolder();
  const { mutateAsync: uploadMedia, isPending: isUploading } = useUploadMedia();
  const { data: dicts, isLoading: isDictsLoading } = useListMediaDictionaries();

  // Revoke object URLs on unmount
  React.useEffect(() => {
    return () => {
      try {
        pendingFiles.forEach((pf) => URL.revokeObjectURL(pf.url))
      } catch {}
    }
  }, [])

  const handleSubmit = form.handleSubmit(
    async (data) => {
      try {
        // Validate data with the schema before submitting
        const validatedData = mediaFolderFormSchema.parse(data);
        
        try {
          const response = await mutateAsync({
            name: validatedData.name,
            description: validatedData.description,
            is_public: validatedData.is_public,
            parent_folder_id: validatedData.parent_folder_id,
          });
          
          // Handle success
          const folder = response.folder;
          toast.success(
            `Folder "${folder.name}" created successfully`,
          );
          handleSuccess();
        } catch (error: any) {
          // Handle mutation error
          toast.error(error.message || 'Failed to create folder');
          console.error('Error creating folder:', error);
        }
      } catch (error) {
        // Handle Zod validation errors
        if (error instanceof z.ZodError) {
          error.errors.forEach((err) => {
            const fieldName = err.path.join('.');
            toast.error(`${fieldName}: ${err.message}`);
          });
        } else {
          toast.error('An unexpected error occurred');
          console.error(error);
        }
      }
    },
    (errors) => {
      // This callback handles react-hook-form validation errors
      const firstError = Object.values(errors).find(error => error);
      if (firstError?.message) {
        toast.error(firstError.message);
      }
    }
  );

  return (
    <RouteFocusModal.Form form={form}>
      <KeyboundForm
        onSubmit={handleSubmit}
        className="flex flex-1 flex-col overflow-hidden"
      >
        <RouteFocusModal.Header>
          <div className="flex items-center justify-between">
            <Heading>Create Folder</Heading>
          </div>
          <Text size="small" className="text-ui-fg-subtle">
            Create a new media folder
          </Text>
        </RouteFocusModal.Header>
        <RouteFocusModal.Body className="flex flex-1 flex-col gap-y-4 overflow-y-auto p-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Form.Field
              control={form.control}
              name="name"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label>Name *</Form.Label>
                  <Form.Control>
                    <Input {...field} placeholder="Enter folder name" />
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />
            
            <Form.Field
              control={form.control}
              name="is_public"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label>Public</Form.Label>
                  <Form.Control>
                    <div className="flex items-center gap-x-2">
                      <input
                        type="checkbox"
                        checked={field.value ?? false}
                        onChange={(e) => field.onChange(e.target.checked)}
                        className="h-4 w-4 rounded border-ui-border-base bg-ui-bg-base text-ui-fg-interactive focus:ring-ui-fg-interactive focus:ring-offset-ui-bg-base"
                      />
                      <Text size="small">Make this folder public</Text>
                    </div>
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />
          </div>
          
          <Form.Field
            control={form.control}
            name="description"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>Description</Form.Label>
                <Form.Control>
                  <Textarea {...field} placeholder="Enter folder description" />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
          
          <Form.Field
            control={form.control}
            name="parent_folder_id"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>Parent Folder</Form.Label>
                <Form.Control>
                  <Select
                    value={(field.value as string) ?? undefined}
                    onValueChange={(val) => field.onChange(val)}
                    disabled={isDictsLoading}
                  >
                    <Select.Trigger>
                      <Select.Value placeholder={isDictsLoading ? "Loading folders..." : "Select parent folder (optional)"} />
                    </Select.Trigger>
                    <Select.Content>
                      {(dicts?.folders || []).map((f) => (
                        <Select.Item key={f.id} value={f.id}>
                          {f.name}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select>
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />

          {/* Independent file upload section */}
          <div className="mt-6 border-t border-ui-border-base pt-4">
            <Heading level="h3">Optional: Upload files (independent)</Heading>
            <Text size="small" className="text-ui-fg-subtle mt-1">
              Select files to upload without associating them to this folder. You can organize them later.
            </Text>

            <div className="mt-3">
              <FileUpload
                label="Select files"
                hint="You can drag & drop or click to select multiple files"
                multiple
                onUploaded={(files) => setPendingFiles((prev) => [...prev, ...files])}
              />
            </div>

            {/* Optional album association */}
            <div className="mt-4 grid grid-cols-1 gap-2">
              <Form.Item>
                <Form.Label>Album IDs (optional)</Form.Label>
                <Form.Control>
                  <Input
                    placeholder="Comma-separated album IDs (e.g. alb_123, alb_456)"
                    value={albumIdsText}
                    onChange={(e) => setAlbumIdsText(e.target.value)}
                  />
                </Form.Control>
                <Text size="small" className="text-ui-fg-subtle">
                  If provided, uploaded files will be associated with these albums.
                </Text>
              </Form.Item>
              <Form.Item>
                <Form.Label>Add Album</Form.Label>
                <Form.Control>
                  <Select
                    disabled={isDictsLoading}
                    onValueChange={(val) => {
                      if (!val) return
                      const current = albumIdsText
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean)
                      if (!current.includes(val)) {
                        const next = [...current, val].join(', ')
                        setAlbumIdsText(next)
                      }
                    }}
                  >
                    <Select.Trigger>
                      <Select.Value placeholder={isDictsLoading ? "Loading albums..." : "Select album to add"} />
                    </Select.Trigger>
                    <Select.Content>
                      {(dicts?.albums || []).map((a) => (
                        <Select.Item key={a.id} value={a.id}>
                          {a.name}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select>
                </Form.Control>
              </Form.Item>
            </div>

            {pendingFiles.length > 0 && (
              <div className="mt-3 flex flex-col gap-y-2">
                <Text size="small" className="text-ui-fg-subtle">
                  {pendingFiles.length} file(s) selected
                </Text>
                <div className="flex flex-wrap gap-2">
                  {pendingFiles.slice(0, 8).map((f, idx) => (
                    <img key={idx} src={f.url} alt={f.file.name} className="h-16 w-16 object-cover rounded" />
                  ))}
                </div>
                <div className="flex items-center gap-x-2">
                  <Button
                    type="button"
                    isLoading={isUploading}
                    disabled={isUploading || pendingFiles.length === 0}
                    onClick={async () => {
                      try {
                        const files = pendingFiles.map((p) => p.file)
                        if (!files.length) {
                          toast.error("Please select file(s) to upload")
                          return
                        }
                        const existingAlbumIds = albumIdsText
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean)
                        await uploadMedia({ files, existingAlbumIds: existingAlbumIds.length ? existingAlbumIds : undefined })
                        toast.success(`${files.length} file(s) uploaded`)
                        // Cleanup object URLs
                        pendingFiles.forEach((pf) => URL.revokeObjectURL(pf.url))
                        setPendingFiles([])
                        setAlbumIdsText("")
                      } catch (e: any) {
                        const msg = e?.message || e?.response?.data?.message || "Failed to upload files"
                        toast.error(msg)
                      }
                    }}
                  >
                    Upload files (no folder)
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      pendingFiles.forEach((pf) => URL.revokeObjectURL(pf.url))
                      setPendingFiles([])
                      setAlbumIdsText("")
                    }}
                  >
                    Clear selection
                  </Button>
                </div>
              </div>
            )}
          </div>
        </RouteFocusModal.Body>
        <RouteFocusModal.Footer>
          <div className="flex items-center justify-end gap-x-2">
            <RouteFocusModal.Close asChild>
              <Button variant="secondary" type="button">
                Cancel
              </Button>
            </RouteFocusModal.Close>
            <Button 
              type="submit" 
              isLoading={isPending}
              className="w-full sm:w-auto"
            >
              Create Folder
            </Button>
          </div>
        </RouteFocusModal.Footer>
      </KeyboundForm>
    </RouteFocusModal.Form>
  );
};

import { Button, Input, Select, Textarea, toast } from "@medusajs/ui"
import { useTranslation } from "react-i18next"
import { z as zod } from "zod";
import { Form } from "../../../../../components/common/form"
import { useUpdateWebsite } from "../../../../../hooks/api/websites"
import { useFileUpload } from "../../../../../hooks/api/upload"
import { AdminWebsite } from "../../../../../hooks/api/websites"
import { useRouteModal } from "../../../../../components/modal/use-route-modal"
import { RouteDrawer } from "../../../../../components/modal/route-drawer/route-drawer"
import { KeyboundForm } from "../../../../../components/utilitites/key-bound-form"
import { FileUpload } from "../../../../../components/common/file-upload"
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useState } from "react"

type EditWebsiteFormProps = {
  website: AdminWebsite
}

const EditWebsiteSchema = zod.object({
  domain: zod.string().min(1),
  name: zod.string().min(1),
  description: zod.string().optional(),
  status: zod.enum(["Active", "Inactive", "Maintenance", "Development"]),
  primary_language: zod.string().min(1),
  supported_languages: zod.array(zod.string()).optional(),
  favicon_url: zod.string().optional(),
  analytics_id: zod.string().optional(),
})

type EditWebsiteFormData = zod.infer<typeof EditWebsiteSchema>

export const EditWebsiteForm = ({ website }: EditWebsiteFormProps) => {
  const { t } = useTranslation()
  const { handleSuccess } = useRouteModal()
  const [isUploading, setIsUploading] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | undefined>(website.favicon_url)

  const form = useForm<EditWebsiteFormData>({
    defaultValues: {
      domain: website.domain,
      name: website.name,
      description: website.description || "",
      status: website.status,
      primary_language: website.primary_language,
      supported_languages: website.supported_languages || [],
      favicon_url: website.favicon_url || "",
      analytics_id: website.analytics_id || "",
    },
    resolver: zodResolver(EditWebsiteSchema),
  })

  const { mutateAsync: updateWebsite, isPending } = useUpdateWebsite(website.id)
  const { mutateAsync: uploadFile } = useFileUpload()

  const handleFileUpload = async (files: File[]) => {
    if (!files?.[0]) return

    setIsUploading(true)
    try {
      const file = files[0]
      
      // Create a temporary preview URL
      const tempPreviewUrl = URL.createObjectURL(file)
      setPreviewUrl(tempPreviewUrl)
      
      const uploadResponse = await uploadFile({
        files: [file],
      })
      
      if (uploadResponse.files?.[0]) {
        const faviconUrl = uploadResponse.files[0].url
        form.setValue("favicon_url", faviconUrl)
        // Update preview with the actual URL
        setPreviewUrl(faviconUrl)
        toast.success(t("websites.edit.faviconUploaded", { 
          defaultValue: "Favicon uploaded successfully" 
        }))
      }
    } catch (error) {
      toast.error(t("websites.edit.faviconUploadError", { 
        defaultValue: "Failed to upload favicon" 
      }))
      // Reset preview on error
      setPreviewUrl(form.getValues("favicon_url"))
    } finally {
      setIsUploading(false)
    }
  }

  const handleSubmit = form.handleSubmit(async (data) => {
    const { domain, name, status, primary_language, ...optional } = data

    await updateWebsite(
      {
        domain,
        name,
        status,
        primary_language,
        ...optional,
      },
      {
        onSuccess: ({ website }) => {
          toast.success(
            t("websites.edit.successToast", { 
              defaultValue: "Successfully updated website {{name}}", 
              name: website.name 
            })
          )
          handleSuccess()
        },
        onError: (e) => {
          toast.error(e.message)
        },
      }
    )
  })

  return (
    <RouteDrawer.Form form={form}>
      <KeyboundForm
        onSubmit={handleSubmit}
        className="flex flex-1 flex-col overflow-hidden"
      >
        <RouteDrawer.Body className="flex flex-1 flex-col gap-y-8 overflow-y-auto">
          <div className="flex flex-col gap-y-8">
            <div className="flex flex-col gap-y-4">
              <Form.Field
                control={form.control}
                name="name"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>{t("fields.name", { defaultValue: "Name" })}</Form.Label>
                    <Form.Control>
                      <Input {...field} />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />
              
              <Form.Field
                control={form.control}
                name="domain"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>{t("fields.domain", { defaultValue: "Domain" })}</Form.Label>
                    <Form.Control>
                      <Input {...field} />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />

              <Form.Field
                control={form.control}
                name="description"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label optional>{t("fields.description", { defaultValue: "Description" })}</Form.Label>
                    <Form.Control>
                      <Textarea {...field} />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />

              <Form.Field
                control={form.control}
                name="status"
                render={({ field: { onChange, ref, ...field } }) => (
                  <Form.Item>
                    <Form.Label>{t("fields.status", { defaultValue: "Status" })}</Form.Label>
                    <Form.Control>
                      <Select {...field} onValueChange={onChange}>
                        <Select.Trigger ref={ref}>
                          <Select.Value />
                        </Select.Trigger>
                        <Select.Content>
                          {(["Active", "Inactive", "Maintenance", "Development"] as const).map((status) => (
                            <Select.Item key={status} value={status}>
                              {t(`websites.status.${status.toLowerCase()}`, { defaultValue: status })}
                            </Select.Item>
                          ))}
                        </Select.Content>
                      </Select>
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />

              <Form.Field
                control={form.control}
                name="primary_language"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>{t("fields.primaryLanguage", { defaultValue: "Primary Language" })}</Form.Label>
                    <Form.Control>
                      <Input {...field} />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />

              <Form.Field
                control={form.control}
                name="favicon_url"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label optional>{t("fields.favicon", { defaultValue: "Favicon" })}</Form.Label>
                    <Form.Control>
                      <FileUpload
                        accept="image/*"
                        value={field.value}
                        onChange={handleFileUpload}
                        isLoading={isUploading}
                        preview={previewUrl}
                      />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />

              <Form.Field
                control={form.control}
                name="analytics_id"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label optional>{t("fields.analyticsId", { defaultValue: "Analytics ID" })}</Form.Label>
                    <Form.Control>
                      <Input {...field} />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />
            </div>
          </div>
        </RouteDrawer.Body>
        <RouteDrawer.Footer>
          <div className="flex items-center justify-end gap-x-2">
            <RouteDrawer.Close asChild>
              <Button size="small" variant="secondary">
                {t("actions.cancel", { defaultValue: "Cancel" })}
              </Button>
            </RouteDrawer.Close>
            <Button size="small" type="submit" isLoading={isPending}>
              {t("actions.save", { defaultValue: "Save" })}
            </Button>
          </div>
        </RouteDrawer.Footer>
      </KeyboundForm>
    </RouteDrawer.Form>
  )
}

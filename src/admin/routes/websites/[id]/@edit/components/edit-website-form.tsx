import { Badge, Button, Input, Select, Textarea, toast } from "@medusajs/ui"
import { useEffect } from "react"
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
  supported_languages:  zod.record(zod.string(), zod.string()).default({ en: "English" }),
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
      supported_languages: website.supported_languages || { en: "English" },
      favicon_url: website.favicon_url || "",
      analytics_id: website.analytics_id || "",
    },
    resolver: zodResolver(EditWebsiteSchema),
  })

  const { mutateAsync: updateWebsite, isPending } = useUpdateWebsite(website.id)
  const { mutateAsync: uploadFile } = useFileUpload()
  
  // Add a state to track form modifications manually
  const [isFormModified, setIsFormModified] = useState(false)
  
  useEffect(() => {
    const subscription = form.watch(() => {
      // Check if any field has been modified
      if (form.formState.isDirty) {
        setIsFormModified(true)
      }
    })
    
    return () => subscription.unsubscribe()
  }, [form])

  const handleFileUpload = async (files: { file: File; url: string }[]) => {
    if (!files?.length) return

    setIsUploading(true)
    try {
      const { file, url: tempPreviewUrl } = files[0]
      
      // Set temporary preview URL from the dropped/selected file
      setPreviewUrl(tempPreviewUrl)
      
      const uploadResponse = await uploadFile({
        files: [file],
      })
      
      if (uploadResponse.files?.[0]) {
        const faviconUrl = uploadResponse.files[0].url
        form.setValue("favicon_url", faviconUrl, {
          shouldDirty: true,
          shouldTouch: true,
          shouldValidate: true
        })
        // Update preview with the actual URL from the server
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
      setPreviewUrl(website.favicon_url)
    } finally {
      setIsUploading(false)
    }
  }

  // Separate function to handle the actual API call
  const submitForm = async (formData: EditWebsiteFormData) => {
    const { domain, name, status, primary_language, ...optional } = formData

    try {
      // Explicitly log what we're sending to the API
      console.log('Sending to API:', {
        domain,
        name,
        status,
        primary_language,
        ...optional,
      })

      const result = await updateWebsite(
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
            console.error('API error:', e)
            toast.error(e.message)
          },
        }
      )
      return result
    } catch (error) {
      console.error('Submission error:', error)
      toast.error('Failed to save: ' + (error instanceof Error ? error.message : String(error)))
    }
  }

  // This is the handler connected to the form
  const handleSubmit = form.handleSubmit(async (data) => {
    // Debug what's being submitted
    console.log('Form data being submitted:', data)
    console.log('Form isDirty:', form.formState.isDirty)
    console.log('isFormModified:', isFormModified)
    console.log('Form dirtyFields:', form.formState.dirtyFields)
    
    // Call our submission function
    await submitForm(data)
  })

  // For debugging
  console.log('Form is dirty:', form.formState.isDirty)
  console.log('isFormModified:', isFormModified)

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
                name="supported_languages"
                render={({ field }) => {
                  // Define language options
                  const languageOptions = [
                    { value: "en", label: "English" },
                    { value: "es", label: "Spanish" },
                    { value: "fr", label: "French" },
                    { value: "de", label: "German" },
                    { value: "it", label: "Italian" },
                    { value: "pt", label: "Portuguese" },
                    { value: "hi", label: "Hindi" },
                  ];
                  
                  return (
                    <Form.Item>
                      <Form.Label>{t("fields.supportedLanguages", { defaultValue: "Supported Languages" })}</Form.Label>
                      <Form.Control>
                        <div className="flex flex-col gap-y-2">
                          <Select
                            value=""
                            onValueChange={(value: string) => {
                              const langOption = languageOptions.find(opt => opt.value === value);
                              // Create a new object to ensure react-hook-form detects the change
                              const newValues = { ...(field.value || {}) };
                              if (!newValues[value]) {
                                newValues[value] = langOption?.label || value;
                                field.onChange(newValues);
                                setIsFormModified(true);
                              }
                            }}
                            size="small"
                          >
                            <Select.Trigger>
                              <Select.Value placeholder={t("fields.selectLanguages", { defaultValue: "Select languages" })} />
                            </Select.Trigger>
                            <Select.Content>
                              {languageOptions.map((option) => (
                                <Select.Item key={option.value} value={option.value}>
                                  {option.label}
                                </Select.Item>
                              ))}
                            </Select.Content>
                          </Select>
                          
                          {field.value && Object.keys(field.value).length > 0 && (
                            <div className="flex flex-wrap gap-2">
                              {Object.entries(field.value).map(([key, label]) => (
                                <Badge key={key} color="green" className="flex items-center gap-x-1">
                                  <span>{label}</span>
                                  <button
                                    type="button"
                                    className="text-ui-fg-subtle hover:text-ui-fg-base ml-1"
                                    onClick={() => {
                                      // Create a new object to ensure react-hook-form detects the change
                                      const newValues = { ...field.value };
                                      delete newValues[key];
                                      field.onChange(newValues);
                                      setIsFormModified(true);
                                    }}
                                  >
                                    ×
                                  </button>
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  );
                }}
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
                        multiple={false}
                        label={t("fields.uploadFavicon", { defaultValue: "Upload favicon" })}
                        hint={t("fields.imageFilesOnly", { defaultValue: "PNG, JPG or SVG (max 1MB)" })}
                        onUploaded={(files) => {
                          handleFileUpload(files);
                        }}
                        isLoading={isUploading}
                        preview={field.value || previewUrl}
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
            <Button 
              size="small" 
              type="submit" 
              isLoading={isPending}
              // Force enable the button for testing
              disabled={false}
            >
              {t("actions.save", { defaultValue: "Save" })}
            </Button>
          </div>
        </RouteDrawer.Footer>
      </KeyboundForm>
    </RouteDrawer.Form>
  )
}

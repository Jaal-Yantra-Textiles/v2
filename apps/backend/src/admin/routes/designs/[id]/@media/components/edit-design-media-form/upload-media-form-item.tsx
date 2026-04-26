import { useCallback } from "react"
import { UseFormReturn } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { z } from "@medusajs/framework/zod"
import { v4 as uuidv4 } from "uuid"
import { FileUpload } from "../../../../../../components/common/file-upload"
import { Form } from "../../../../../../components/common/form"
import { Heading, Text } from "@medusajs/ui"

interface FileType {
  file: File
  url: string
}
import { EditDesignMediaSchemaType, MediaSchema } from "./edit-design-media-form"

type Media = z.infer<typeof MediaSchema>

const SUPPORTED_FORMATS = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/svg+xml",
]

const SUPPORTED_FORMATS_FILE_EXTENSIONS = [
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".heic",
  ".svg",
]

export const UploadMediaFormItem = ({
  form,
  append,
  showHint = true,
}: {
  form: UseFormReturn<EditDesignMediaSchemaType>
  append: (value: Media) => void
  showHint?: boolean
}) => {
  const { t } = useTranslation()

  const hasInvalidFiles = useCallback(
    (fileList: FileType[]) => {
      const invalidFile = fileList.find(
        (f) => !SUPPORTED_FORMATS.includes(f.file.type)
      )

      if (invalidFile) {
        form.setError("media", {
          type: "invalid_file",
          message: t("designs.media.invalidFileType", {
            name: invalidFile.file.name,
            types: SUPPORTED_FORMATS_FILE_EXTENSIONS.join(", "),
          }),
        })

        return true
      }

      return false
    },
    [form]
  )

  const onUploaded = useCallback(
    (files: FileType[]) => {
      form.clearErrors("media")
      if (hasInvalidFiles(files)) {
        return
      }

      files.forEach((f) => {
        const newId = uuidv4(); // Generate a unique ID for the new file
        append({ 
          ...f, 
          isThumbnail: false,
          field_id: newId, // Use for draggable components
          id: newId // Use the same ID for backend persistence
        });
      })
    },
    [form, append, hasInvalidFiles]
  )

  return (
    <div className="flex flex-col gap-y-6">
      <div>
        <Heading className="text-ui-fg-base mb-1" level="h2">
          {t("designs.media.uploadTitle", "Upload Media")}
        </Heading>
        <Text className="text-ui-fg-subtle">
          {t("designs.media.uploadDescription", "Upload images for your design")}
        </Text>
      </div>
      <Form.Field
        control={form.control}
        name="media"
        render={() => {
          return (
            <Form.Item>
              <div className="flex flex-col gap-y-2">
                <div className="flex flex-col gap-y-1">
                  <Form.Label optional>{t("designs.media.label", "Media")}</Form.Label>
                  {showHint && (
                    <Form.Hint>{t("designs.media.editHint", "Add images to your design")}</Form.Hint>
                  )}
                </div>
                <Form.Control>
                  <FileUpload
                    label={t("designs.media.uploadImagesLabel", "Upload images")}
                    hint={t("designs.media.uploadImagesHint", "You can upload multiple images at once.")}
                    hasError={!!form.formState.errors.media}
                    formats={SUPPORTED_FORMATS}
                    onUploaded={onUploaded}
                  />
                </Form.Control>
                <Form.ErrorMessage />
              </div>
            </Form.Item>
          )
        }}
      />
    </div>
  )
}

export default UploadMediaFormItem
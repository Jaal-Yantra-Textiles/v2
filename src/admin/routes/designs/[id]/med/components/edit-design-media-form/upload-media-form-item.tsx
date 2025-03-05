import { useCallback } from "react"
import { UseFormReturn } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { v4 as uuidv4 } from "uuid"
import { FileUpload } from "../../../../../../components/common/file-upload"
import { Form } from "../../../../../../components/common/form"

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
          message: `Invalid file type: ${invalidFile.file.name}. Supported types: ${SUPPORTED_FORMATS_FILE_EXTENSIONS.join(", ")}`,
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

      files.forEach((f) => append({ 
        ...f, 
        isThumbnail: false,
        field_id: uuidv4() // Generate a unique ID for each new field
      }))
    },
    [form, append, hasInvalidFiles]
  )

  return (
    <Form.Field
      control={form.control}
      name="media"
      render={() => {
        return (
          <Form.Item>
            <div className="flex flex-col gap-y-2">
              <div className="flex flex-col gap-y-1">
                <Form.Label optional>Media</Form.Label>
                {showHint && (
                  <Form.Hint>Add images to your design</Form.Hint>
                )}
              </div>
              <Form.Control>
                <FileUpload
                  label="Upload images"
                  hint="You can upload multiple images at once."
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
  )
}

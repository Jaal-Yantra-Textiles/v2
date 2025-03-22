import { useState } from "react"
import { Hint } from "@medusajs/ui"
import { FileUpload } from "../../../components/common/file-upload"

const SUPPORTED_FORMATS = ["text/csv"]
const SUPPORTED_FORMATS_FILE_EXTENSIONS = [".csv"]

export const UploadImport = ({
  onUploaded,
}: {
  onUploaded: (file: File) => void
}) => {
  const [error, setError] = useState<string>()

  const hasInvalidFiles = (fileList: { file: File; url: string }[]) => {
    const invalidFile = fileList.find(
      (f) => !SUPPORTED_FORMATS.includes(f.file.type)
    )

    if (invalidFile) {
      setError(
        `Invalid file type ${invalidFile.file.name}. Only ${SUPPORTED_FORMATS_FILE_EXTENSIONS.join(", ")} are supported.`
      )
      return true
    }

    return false
  }

  return (
    <div className="flex flex-col gap-y-4">
      <FileUpload
        label="Upload a CSV file"
        hint="The file should contain person data with necessary fields (first name, last name, email)"
        multiple={false}
        hasError={!!error}
        formats={SUPPORTED_FORMATS}
        onUploaded={(files) => {
          setError(undefined)
          if (hasInvalidFiles(files)) {
            return
          }
          onUploaded(files[0].file)
        }}
      />

      {error && (
        <div>
          <Hint variant="error">{error}</Hint>
        </div>
      )}
    </div>
  )
}

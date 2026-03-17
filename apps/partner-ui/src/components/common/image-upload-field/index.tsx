import { useState } from "react"
import { Input, Label, Text, toast } from "@medusajs/ui"
import { Trash, Photo } from "@medusajs/icons"
import { FileUpload, FileType } from "../file-upload"
import { usePartnerUpload } from "../../../hooks/api/uploads"

const IMAGE_FORMATS = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "image/x-icon",
  "image/vnd.microsoft.icon",
]

interface ImageUploadFieldProps {
  label: string
  value: string
  onChange: (url: string) => void
  hint?: string
  compact?: boolean
}

export function ImageUploadField({
  label,
  value,
  onChange,
  hint,
  compact,
}: ImageUploadFieldProps) {
  const [isUploading, setIsUploading] = useState(false)
  const [showUrlInput, setShowUrlInput] = useState(false)
  const { mutateAsync: upload } = usePartnerUpload()

  const handleUpload = async (files: FileType[]) => {
    if (!files.length) return

    setIsUploading(true)
    try {
      const result = await upload(files.map((f) => f.file))
      const url = result.files?.[0]?.url
      if (url) {
        onChange(url)
        toast.success("Image uploaded")
      }
    } catch (e: any) {
      toast.error("Upload failed", {
        description: e?.message || "Could not upload image",
      })
    } finally {
      setIsUploading(false)
    }
  }

  if (value) {
    return (
      <div className="space-y-1.5">
        <Label size="xsmall">{label}</Label>
        <div className="relative group rounded-lg border border-ui-border-base overflow-hidden bg-ui-bg-subtle">
          <img
            src={value}
            alt={label}
            className={compact ? "w-full h-20 object-contain p-2" : "w-full h-32 object-contain p-2"}
            onError={(e) => {
              ;(e.target as HTMLImageElement).style.display = "none"
            }}
          />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
            <button
              type="button"
              onClick={() => onChange("")}
              className="p-1.5 rounded-md bg-white/90 hover:bg-white text-ui-fg-error transition-colors"
            >
              <Trash className="w-4 h-4" />
            </button>
          </div>
        </div>
        <Text size="xsmall" className="text-ui-fg-muted truncate">
          {value.split("/").pop()}
        </Text>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label size="xsmall">{label}</Label>
        <button
          type="button"
          onClick={() => setShowUrlInput(!showUrlInput)}
          className="text-xs text-ui-fg-interactive hover:underline"
        >
          {showUrlInput ? "Upload" : "Use URL"}
        </button>
      </div>

      {showUrlInput ? (
        <Input
          size="small"
          placeholder="https://example.com/image.png"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <div className={compact ? "scale-90 origin-top-left" : ""}>
          <FileUpload
            label={isUploading ? "Uploading..." : "Drop image here"}
            hint={hint || "JPEG, PNG, SVG, WebP. Max 10MB."}
            formats={IMAGE_FORMATS}
            multiple={false}
            onUploaded={(files, rejected) => {
              if (rejected?.length) {
                toast.error(
                  rejected[0].reason === "size"
                    ? "File too large (max 10MB)"
                    : "Unsupported format"
                )
                return
              }
              handleUpload(files)
            }}
          />
        </div>
      )}
    </div>
  )
}

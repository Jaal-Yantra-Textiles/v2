import React, { useRef } from "react"
import { Button, Toast } from "@medusajs/ui"
import { Upload } from "lucide-react"

interface FileUploadProps {
  accept?: string
  value?: string
  onChange?: (files: File[]) => void
  isLoading?: boolean
  preview?: string
}

export const FileUpload = ({ accept, value, onChange, isLoading, preview }: FileUploadProps) => {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleClick = () => {
    inputRef.current?.click()
  }

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || [])
    onChange?.(files)
  }

  return (
    <div className="flex flex-col gap-y-4">
      <div className="flex items-center gap-x-4">
        <input
          type="file"
          className="hidden"
          ref={inputRef}
          accept={accept}
          onChange={handleFileChange}
        />
        <Button
          variant="secondary"
          size="base"
          type="button"
          onClick={handleClick}
          className="min-w-[120px]"
        >
          <Upload className="w-4 h-4 mr-2" />
          Upload File
        </Button>
      </div>
      
      {preview && (
        <div className="relative flex items-center justify-center w-16 h-16 overflow-hidden rounded-md bg-ui-bg-subtle">
          <img 
            src={preview} 
            alt="Preview" 
            className="object-contain w-full h-full"
          />
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-ui-bg-base bg-opacity-50">
              <Toast id="uploading" variant="loading" title="Uploading..." />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

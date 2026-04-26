import React, { useRef, useState } from "react"
import { Button, Text, Toast, clx } from "@medusajs/ui"
import { Upload } from "lucide-react"

export interface FileUploadProps {
  label?: string
  hint?: string
  accept?: string
  multiple?: boolean
  formats?: string[]
  hasError?: boolean
  onUploaded?: (files: { file: File; url: string }[]) => void
  isLoading?: boolean
  preview?: string
}

export const FileUpload = ({ 
  label = "Upload files", 
  hint,
  accept, 
  multiple = true, 
  formats, 
  hasError, 
  onUploaded, 
  isLoading, 
  preview 
}: FileUploadProps) => {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleClick = () => {
    inputRef.current?.click()
  }

  const [isDragging, setIsDragging] = useState(false)

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || [])
    if (!files.length) return

    const result = await Promise.all(
      files.map(async (file) => {
        const url = URL.createObjectURL(file)
        return { file, url }
      })
    )

    onUploaded?.(result)
    if (inputRef.current) {
      inputRef.current.value = ""
    }
  }

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    const files = Array.from(e.dataTransfer.files || [])
    if (!files.length) return

    const result = await Promise.all(
      files.map(async (file) => {
        const url = URL.createObjectURL(file)
        return { file, url }
      })
    )

    onUploaded?.(result)
  }

  const acceptString = formats?.join(",") || accept

  return (
    <div className="flex flex-col gap-y-4">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={clx(
          "border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center gap-y-2 cursor-pointer transition-colors",
          {
            "border-ui-tag-neutral-border bg-ui-tag-neutral-bg": !isDragging && !hasError,
            "border-ui-tag-blue-border bg-ui-tag-blue-bg": isDragging && !hasError,
            "border-ui-tag-red-border bg-ui-tag-red-bg": hasError,
          }
        )}
        onClick={handleClick}
      >
        <input
          type="file"
          className="hidden"
          ref={inputRef}
          accept={acceptString}
          onChange={handleFileChange}
          multiple={multiple}
        />
        <div className="flex flex-col items-center justify-center gap-y-2">
          <div className="bg-ui-bg-base rounded-full p-3">
            <Upload className="text-ui-fg-subtle" />
          </div>
          <Text size="small" weight="plus" className="text-ui-fg-base text-center">
            {label}
          </Text>
          {hint && (
            <Text size="small" className="text-ui-fg-subtle text-center">
              {hint}
            </Text>
          )}
        </div>
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

import { Button, FocusModal } from "@medusajs/ui"
import { useState } from "react"
import MediaUpload from "../forms/raw-material/media-upload"

interface ProductMediaModalProps {
  onSave: (urls: string[]) => void
  initialUrls?: string[]
  trigger?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

const ProductMediaModal = ({
  onSave,
  initialUrls = [],
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: ProductMediaModalProps) => {
  const [internalOpen, setInternalOpen] = useState(false)
  const [selectedUrls, setSelectedUrls] = useState<string[]>(initialUrls)
  
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen
  const setOpen = controlledOnOpenChange || setInternalOpen

  const handleSelect = (url: string) => {
    const newSelection = selectedUrls.includes(url)
      ? selectedUrls.filter((u) => u !== url)
      : [...selectedUrls, url]
    setSelectedUrls(newSelection)
  }

  const handleSave = () => {
    onSave(selectedUrls)
    setOpen(false)
  }

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen)
    if (isOpen) {
      // Reset selection when opening
      setSelectedUrls(initialUrls)
    }
  }

  const isControlled = controlledOpen !== undefined
  
  return (
    <FocusModal open={open} onOpenChange={handleOpenChange}>
      {!isControlled && (
        <FocusModal.Trigger asChild>
          {trigger || (
            <Button variant="secondary" size="small">
              Add Media
            </Button>
          )}
        </FocusModal.Trigger>
      )}
      <FocusModal.Content>
        <FocusModal.Header>
          <FocusModal.Title>Select Media</FocusModal.Title>
        </FocusModal.Header>
        <FocusModal.Body className="overflow-y-auto">
          <MediaUpload selectedUrls={selectedUrls} handleSelect={handleSelect} />
        </FocusModal.Body>
        <FocusModal.Footer>
          <div className="flex w-full items-center justify-end gap-x-2">
            <FocusModal.Close asChild>
              <Button variant="secondary">Cancel</Button>
            </FocusModal.Close>
            <Button variant="primary" onClick={handleSave}>
              Save and Close
            </Button>
          </div>
        </FocusModal.Footer>
      </FocusModal.Content>
    </FocusModal>
  )
}

export default ProductMediaModal

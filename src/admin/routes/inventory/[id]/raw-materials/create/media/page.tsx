import { Button } from "@medusajs/ui"
import { useState } from "react"
import MediaUpload from "../../../../../../components/forms/raw-material/media-upload"
import { StackedFocusModal } from "../../../../../../components/modal/stacked-modal/stacked-focused-modal"

interface RawMaterialMediaModalProps {
  onSave: (urls: string[]) => void
  initialUrls?: string[]
}

const RawMaterialMediaModal = ({
  onSave,
  initialUrls = [],
}: RawMaterialMediaModalProps) => {
  const [selectedUrls, setSelectedUrls] = useState<string[]>(initialUrls)

  const handleSelect = (url: string) => {
    const newSelection = selectedUrls.includes(url)
      ? selectedUrls.filter((u) => u !== url)
      : [...selectedUrls, url]
    setSelectedUrls(newSelection)
  }

  const handleSave = () => {
    onSave(selectedUrls)
  }

  return (
    <StackedFocusModal id="media-modal">
      <StackedFocusModal.Trigger asChild>
        <Button
          variant="secondary"
          size="small"
          onClick={() => setSelectedUrls(initialUrls)} // Reset selection on open
        >
          Add Media
        </Button>
      </StackedFocusModal.Trigger>
      <StackedFocusModal.Content>
        <StackedFocusModal.Header>
          <StackedFocusModal.Title>Media</StackedFocusModal.Title>
        </StackedFocusModal.Header>
        <MediaUpload selectedUrls={selectedUrls} handleSelect={handleSelect} />
        <StackedFocusModal.Footer>
          <div className="flex w-full items-center justify-end gap-x-2">
            <StackedFocusModal.Close asChild>
              <Button variant="secondary">Cancel</Button>
            </StackedFocusModal.Close>
            <StackedFocusModal.Close asChild>
              <Button variant="primary" onClick={handleSave}>
                Save and Close
              </Button>
            </StackedFocusModal.Close>
          </div>
        </StackedFocusModal.Footer>
      </StackedFocusModal.Content>
    </StackedFocusModal>
  )
}

export default RawMaterialMediaModal;

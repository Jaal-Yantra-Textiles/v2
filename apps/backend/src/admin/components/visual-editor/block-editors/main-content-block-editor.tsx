import { Select, Button, Text } from "@medusajs/ui"
import { PencilSquare } from "@medusajs/icons"
import { BlockEditorProps } from "./index"
import { useState } from "react"
import { StackedFocusModal } from "../../modal/stacked-modal/stacked-focused-modal"
import { SimpleEditor } from "../../editor/editor"

export function MainContentBlockEditor({ content, onContentChange }: BlockEditorProps) {
  const contentType = (content.content_type as string) || "html"
  const body = ((content.body || content.text || "") as string)
  const maxWidth = (content.max_width as string) || "medium"
  const [richEditorContent, setRichEditorContent] = useState<string>(body)

  const updateField = (field: string, value: unknown) => {
    onContentChange({ ...content, [field]: value })
  }

  const handleRichEditorSave = () => {
    onContentChange({ ...content, body: richEditorContent, text: richEditorContent })
  }

  return (
    <div className="space-y-4">
      {/* Content Type */}
      <div className="visual-editor-property-field">
        <label className="visual-editor-property-label">Content Type</label>
        <Select
          value={contentType}
          onValueChange={(value) => updateField("content_type", value)}
        >
          <Select.Trigger>
            <Select.Value placeholder="Select content type" />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="html">HTML</Select.Item>
            <Select.Item value="markdown">Markdown</Select.Item>
            <Select.Item value="text">Plain Text</Select.Item>
          </Select.Content>
        </Select>
      </div>

      {/* Max Width */}
      <div className="visual-editor-property-field">
        <label className="visual-editor-property-label">Max Width</label>
        <Select
          value={maxWidth}
          onValueChange={(value) => updateField("max_width", value)}
        >
          <Select.Trigger>
            <Select.Value placeholder="Select max width" />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="narrow">Narrow (680px)</Select.Item>
            <Select.Item value="medium">Medium (960px)</Select.Item>
            <Select.Item value="wide">Wide (1200px)</Select.Item>
            <Select.Item value="full">Full Width</Select.Item>
          </Select.Content>
        </Select>
      </div>

      {/* Rich Editor Button */}
      <div className="visual-editor-property-field">
        <label className="visual-editor-property-label">Content</label>
        <StackedFocusModal id="rich-content-editor">
          <StackedFocusModal.Trigger asChild>
            <Button variant="secondary" className="w-full">
              <PencilSquare className="w-4 h-4 mr-2" />
              Open Rich Editor
            </Button>
          </StackedFocusModal.Trigger>
          <StackedFocusModal.Content>
            <StackedFocusModal.Header>
              <Text weight="plus">Edit Content</Text>
            </StackedFocusModal.Header>
            <StackedFocusModal.Body className="p-4">
              <div className="h-[60vh]">
                <SimpleEditor
                  editorContent={richEditorContent}
                  setEditorContent={setRichEditorContent}
                  outputFormat="json"
                />
              </div>
            </StackedFocusModal.Body>
            <StackedFocusModal.Footer>
              <StackedFocusModal.Close asChild>
                <Button variant="secondary">Cancel</Button>
              </StackedFocusModal.Close>
              <StackedFocusModal.Close asChild>
                <Button onClick={handleRichEditorSave}>Save Content</Button>
              </StackedFocusModal.Close>
            </StackedFocusModal.Footer>
          </StackedFocusModal.Content>
        </StackedFocusModal>
        <Text size="small" className="text-ui-fg-subtle mt-2">
          Use the rich editor to format your content with headings, lists, images, and more.
        </Text>
      </div>
    </div>
  )
}

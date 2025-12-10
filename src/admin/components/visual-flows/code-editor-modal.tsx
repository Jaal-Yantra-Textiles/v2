import { useState } from "react"
import Editor from "@monaco-editor/react"
import { Button, Text } from "@medusajs/ui"
import { PencilSquare } from "@medusajs/icons"
import { StackedFocusModal } from "../modal/stacked-modal/stacked-focused-modal"

interface CodeEditorModalProps {
  code: string
  onChange: (code: string) => void
  modalId?: string
}

export function CodeEditorModal({
  code,
  onChange,
  modalId = "code-editor-modal",
}: CodeEditorModalProps) {
  const [localCode, setLocalCode] = useState(code)

  const handleOpen = () => {
    // Reset to current code when opening
    setLocalCode(code)
  }

  const handleSave = () => {
    onChange(localCode)
  }

  return (
    <StackedFocusModal id={modalId}>
      <StackedFocusModal.Trigger asChild>
        <Button variant="secondary" size="small" onClick={handleOpen}>
          <PencilSquare className="w-4 h-4 mr-1" />
          Open Editor
        </Button>
      </StackedFocusModal.Trigger>
      <StackedFocusModal.Content className="flex flex-col">
        <StackedFocusModal.Header>
          <StackedFocusModal.Title>Edit JavaScript Code</StackedFocusModal.Title>
          <StackedFocusModal.Description>
            Available: <code className="bg-ui-bg-subtle px-1 rounded">$last</code>, 
            <code className="bg-ui-bg-subtle px-1 rounded ml-1">$input</code>, 
            <code className="bg-ui-bg-subtle px-1 rounded ml-1">$trigger</code>, 
            <code className="bg-ui-bg-subtle px-1 rounded ml-1">console.log()</code>
          </StackedFocusModal.Description>
        </StackedFocusModal.Header>

        <div className="h-[100vh] overflow-hidden">
          <Editor
            height="100%"
            defaultLanguage="javascript"
            value={localCode}
            onChange={(value) => setLocalCode(value || "")}
            theme="vs-dark"
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              lineNumbers: "on",
              scrollBeyondLastLine: false,
              automaticLayout: true,
              tabSize: 2,
              wordWrap: "on",
              padding: { top: 16, bottom: 16 },
              suggestOnTriggerCharacters: true,
              quickSuggestions: true,
              folding: true,
              bracketPairColorization: { enabled: true },
            }}
          />
        </div>

        <StackedFocusModal.Footer>
          <div className="flex w-full items-center justify-between">
            <Text className="text-xs text-ui-fg-subtle">
              Tip: Use <code className="bg-ui-bg-subtle px-1 rounded">return</code> to output data
            </Text>
            <div className="flex items-center gap-x-2">
              <StackedFocusModal.Close asChild>
                <Button variant="secondary">Cancel</Button>
              </StackedFocusModal.Close>
              <StackedFocusModal.Close asChild>
                <Button variant="primary" onClick={handleSave}>
                  Save and Close
                </Button>
              </StackedFocusModal.Close>
            </div>
          </div>
        </StackedFocusModal.Footer>
      </StackedFocusModal.Content>
    </StackedFocusModal>
  )
}

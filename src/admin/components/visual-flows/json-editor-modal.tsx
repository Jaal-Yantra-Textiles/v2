import { useState, useCallback, useRef } from "react"
import { Button, Text, Badge } from "@medusajs/ui"
import { PencilSquare, CodePullRequest } from "@medusajs/icons"
import Editor from "@monaco-editor/react"
import { JsonEditor, monoLightTheme, monoDarkTheme } from "json-edit-react"
import { StackedFocusModal } from "../modal/stacked-modal/stacked-focused-modal"
import { useDarkMode } from "../../hooks/use-dark-mode"
import "../common/json-editor-overrides.css"

type Mode = "visual" | "raw"

interface JsonEditorModalProps {
  /** Current value — any JSON-serialisable object or array */
  value: any
  onChange: (value: any) => void
  /** Title shown in the modal header */
  title?: string
  /** Hint shown below the title, e.g. "Use {{ item.field }} for per-item values" */
  hint?: string
  /** Unique id for the StackedFocusModal — must be unique on the page */
  modalId: string
  /** Label for the trigger button. Defaults to "Edit JSON" */
  triggerLabel?: string
  /** Root name shown in the visual tree. Defaults to "value" */
  rootName?: string
  /** How deep to auto-expand in visual mode. Defaults to 2 */
  collapse?: number
}

export function JsonEditorModal({
  value,
  onChange,
  title = "Edit JSON",
  hint,
  modalId,
  triggerLabel = "Edit JSON",
  rootName = "value",
  collapse = 2,
}: JsonEditorModalProps) {
  const isDarkMode = useDarkMode()
  const [mode, setMode] = useState<Mode>("visual")

  // Local copies — committed only on "Save and Close"
  const [visualData, setVisualData] = useState<any>(null)
  const [rawText, setRawText] = useState("")
  const [rawError, setRawError] = useState<string | null>(null)

  // committedValue drives the trigger-button preview. It's updated immediately
  // when the user saves so the preview reflects the new value without waiting
  // for the parent's prop update to propagate through Radix's close animation.
  const [committedValue, setCommittedValue] = useState<any>(value)

  // Keep committedValue in sync when the parent changes value externally
  // (e.g. node selection changes or initial load).
  const prevValueRef = useRef(value)
  if (prevValueRef.current !== value) {
    prevValueRef.current = value
    setCommittedValue(value)
  }

  // Initialise local state when the modal opens
  const handleOpen = useCallback(() => {
    const initial = value === undefined || value === null ? {} : value
    setVisualData(initial)
    setRawText(JSON.stringify(initial, null, 2))
    setRawError(null)
    setMode("visual")
  }, [value])

  // Keep raw text in sync when switching to raw mode
  const handleSetMode = (next: Mode) => {
    if (next === "raw") {
      setRawText(JSON.stringify(visualData, null, 2))
      setRawError(null)
    } else {
      // Switching back to visual — parse raw first
      try {
        const parsed = JSON.parse(rawText)
        setVisualData(parsed)
        setRawError(null)
      } catch (e: any) {
        setRawError(e.message)
        return // Don't switch if text is invalid
      }
    }
    setMode(next)
  }

  const handleRawChange = (text: string | undefined) => {
    const t = text ?? ""
    setRawText(t)
    try {
      const parsed = JSON.parse(t)
      setVisualData(parsed)
      setRawError(null)
    } catch {
      setRawError("Invalid JSON")
    }
  }

  const handleSave = () => {
    if (mode === "raw") {
      try {
        const parsed = JSON.parse(rawText)
        onChange(parsed)
        setCommittedValue(parsed)
      } catch {
        // Don't save invalid JSON
      }
    } else {
      onChange(visualData)
      setCommittedValue(visualData)
    }
  }

  // Themes for json-edit-react
  const lightTheme = [monoLightTheme, { styles: { container: { backgroundColor: "#ffffff" } } }]
  const darkTheme = [
    monoDarkTheme,
    {
      styles: {
        container:      { backgroundColor: "#1a1a1a" },
        // monoDarkTheme doesn't define input styles so the library falls back to
        // the default theme's dark-text input — invisible on the dark background.
        // Explicitly set light text + a slightly lifted dark background for all
        // inline edit inputs, key inputs, textareas, and selects.
        input:           { color: "#e5e5e5", backgroundColor: "#2a2a2a" },
        inputHighlight:  { backgroundColor: "#3a3a3a" },
      },
    },
  ]

  // Preview shown on the trigger button — uses committedValue so it updates
  // immediately on save without waiting for the prop to re-propagate through
  // Radix's close animation.
  const preview = (() => {
    try {
      const s = JSON.stringify(committedValue)
      if (!s || s === "{}") return null
      return s.length > 50 ? s.slice(0, 50) + "…" : s
    } catch {
      return null
    }
  })()

  return (
    <StackedFocusModal id={modalId}>
      <StackedFocusModal.Trigger asChild>
        <button
          type="button"
          onClick={handleOpen}
          className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm border border-ui-border-base rounded-md bg-ui-bg-field hover:bg-ui-bg-field-hover text-left group"
        >
          <span className="flex items-center gap-2 min-w-0">
            <PencilSquare className="w-3.5 h-3.5 text-ui-fg-muted shrink-0" />
            <span className="text-ui-fg-muted truncate text-xs font-mono">
              {preview ?? triggerLabel}
            </span>
          </span>
          <Badge size="2xsmall" color="grey">JSON</Badge>
        </button>
      </StackedFocusModal.Trigger>

      <StackedFocusModal.Content className="flex flex-col h-[calc(100vh-3rem)] max-h-[calc(100vh-3rem)]">
        <StackedFocusModal.Header>
          <div className="flex items-center justify-between w-full pr-4">
            <div>
              <StackedFocusModal.Title>{title}</StackedFocusModal.Title>
              {hint && (
                <Text className="text-xs text-ui-fg-subtle mt-0.5">{hint}</Text>
              )}
            </div>
            {/* Mode toggle */}
            <div className="flex items-center gap-1 border border-ui-border-base rounded-md p-0.5 bg-ui-bg-subtle">
              <button
                type="button"
                onClick={() => handleSetMode("visual")}
                className={[
                  "flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors",
                  mode === "visual"
                    ? "bg-ui-bg-base text-ui-fg-base shadow-sm"
                    : "text-ui-fg-muted hover:text-ui-fg-base",
                ].join(" ")}
              >
                <PencilSquare className="w-3.5 h-3.5" />
                Visual
              </button>
              <button
                type="button"
                onClick={() => handleSetMode("raw")}
                className={[
                  "flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors",
                  mode === "raw"
                    ? "bg-ui-bg-base text-ui-fg-base shadow-sm"
                    : "text-ui-fg-muted hover:text-ui-fg-base",
                ].join(" ")}
              >
                <CodePullRequest className="w-3.5 h-3.5" />
                Raw
              </button>
            </div>
          </div>
        </StackedFocusModal.Header>

        <StackedFocusModal.Body className="flex-1 overflow-hidden p-0">
          {mode === "visual" ? (
            <div className="h-full overflow-auto p-4">
              <JsonEditor
                data={visualData ?? {}}
                setData={(newData) => {
                  if (typeof newData === "object" && newData !== null) {
                    setVisualData(newData)
                  }
                }}
                theme={isDarkMode ? darkTheme : lightTheme}
                rootName={rootName}
                collapse={collapse}
              />
            </div>
          ) : (
            <div className="h-full">
              <Editor
                height="100%"
                defaultLanguage="json"
                value={rawText}
                onChange={handleRawChange}
                theme={isDarkMode ? "vs-dark" : "vs-light"}
                options={{
                  minimap: { enabled: false },
                  fontSize: 13,
                  lineNumbers: "on",
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  tabSize: 2,
                  wordWrap: "on",
                  padding: { top: 16, bottom: 16 },
                  formatOnPaste: true,
                  formatOnType: true,
                }}
              />
            </div>
          )}
        </StackedFocusModal.Body>

        <StackedFocusModal.Footer>
          <div className="flex w-full items-center justify-between">
            <div>
              {rawError && mode === "raw" && (
                <Text className="text-xs text-ui-fg-error">{rawError}</Text>
              )}
              {!rawError && (
                <Text className="text-xs text-ui-fg-subtle">
                  {mode === "visual"
                    ? "Click any value to edit it inline"
                    : 'Use {{ step_key.field }} for dynamic values'}
                </Text>
              )}
            </div>
            <div className="flex items-center gap-2">
              <StackedFocusModal.Close asChild>
                <Button variant="secondary">Cancel</Button>
              </StackedFocusModal.Close>
              <StackedFocusModal.Close asChild>
                <Button
                  variant="primary"
                  onClick={handleSave}
                  disabled={mode === "raw" && !!rawError}
                >
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

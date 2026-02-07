import { Text } from "@medusajs/ui"
import { JsonEditor, monoLightTheme, monoDarkTheme } from "json-edit-react"
import { BlockEditorProps } from "./index"
import { useDarkMode } from "../../../hooks/use-dark-mode"
import "../../common/json-editor-overrides.css"

export function GenericBlockEditor({ content, onContentChange }: BlockEditorProps) {
  const isDarkMode = useDarkMode()

  // Custom theme with proper background colors
  const lightTheme = [
    monoLightTheme,
    {
      styles: {
        container: {
          backgroundColor: "#ffffff",
        },
        input: {
          color: "#292929",
        },
        property: "#292929",
      },
    },
  ]

  const darkTheme = [
    monoDarkTheme,
    {
      styles: {
        container: {
          backgroundColor: "#1a1a1a",
        },
        input: {
          color: "#e0e0e0",
        },
        property: "#e0e0e0",
      },
    },
  ]

  return (
    <div className="space-y-4">
      <Text size="small" className="text-ui-fg-subtle">
        Edit the block content directly as JSON. Changes will be saved automatically.
      </Text>

      <div className="border border-ui-border-base rounded-md overflow-hidden">
        <JsonEditor
          data={content || {}}
          setData={(newData) => {
            if (typeof newData === "object" && newData !== null) {
              onContentChange(newData as Record<string, unknown>)
            }
          }}
          theme={isDarkMode ? darkTheme : lightTheme}
          rootName="content"
          collapse={2}
        />
      </div>
    </div>
  )
}

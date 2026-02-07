import { forwardRef, useState } from "react"
import { Text } from "@medusajs/ui"
import { ArrowPath } from "@medusajs/icons"

interface PreviewPanelProps {
  previewUrl: string
  iframeReady: boolean
  selectedBlockId: string | null
}

export const PreviewPanel = forwardRef<HTMLIFrameElement, PreviewPanelProps>(
  ({ previewUrl, iframeReady, selectedBlockId }, ref) => {
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const handleIframeLoad = () => {
      setIsLoading(false)
      setError(null)
    }

    const handleIframeError = () => {
      setIsLoading(false)
      setError("Failed to load preview")
    }

    const handleRefresh = () => {
      setIsLoading(true)
      setError(null)
      if (ref && "current" in ref && ref.current) {
        ref.current.src = previewUrl
      }
    }

    return (
      <div className="visual-editor-preview-container">
        {/* Loading State */}
        {isLoading && (
          <div className="visual-editor-preview-loading">
            <div className="flex flex-col items-center gap-2">
              <ArrowPath className="w-5 h-5 animate-spin text-ui-fg-muted" />
              <Text size="small" className="text-ui-fg-muted">Loading preview...</Text>
            </div>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="visual-editor-preview-loading">
            <div className="flex flex-col items-center gap-2">
              <Text size="small" className="text-ui-fg-error">{error}</Text>
              <button
                onClick={handleRefresh}
                className="text-ui-fg-interactive hover:underline text-xs"
              >
                Try again
              </button>
            </div>
          </div>
        )}

        {/* Iframe */}
        <iframe
          ref={ref}
          src={previewUrl}
          className="visual-editor-preview-iframe"
          onLoad={handleIframeLoad}
          onError={handleIframeError}
          title="Page Preview"
          sandbox="allow-scripts allow-same-origin allow-forms"
        />
      </div>
    )
  }
)

PreviewPanel.displayName = "PreviewPanel"

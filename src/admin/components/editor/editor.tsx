import * as React from "react"
import { EditorContent, EditorContext, useEditor } from "@tiptap/react"
import { toast } from "@medusajs/ui"
import { sdk } from "@/lib/config"

// --- Tiptap Core Extensions ---
import { StarterKit } from "@tiptap/starter-kit"
import { Image } from "@tiptap/extension-image"
import { TaskItem } from "@tiptap/extension-task-item"
import { TaskList } from "@tiptap/extension-task-list"
import { TextAlign } from "@tiptap/extension-text-align"
import { Typography } from "@tiptap/extension-typography"
import { Highlight } from "@tiptap/extension-highlight"
import { Subscript } from "@tiptap/extension-subscript"
import { Superscript } from "@tiptap/extension-superscript"
import { Underline } from "@tiptap/extension-underline"
import { TextStyleKit } from "@tiptap/extension-text-style"

// --- Custom Extensions ---
import { Link } from "@/components/tiptap-extension/link-extension"
import { Selection } from "@/components/tiptap-extension/selection-extension"
import { SelectionPopover } from "@/components/tiptap-extension/selection-popover-extension"
import { TrailingNode } from "@/components/tiptap-extension/trailing-node-extension"

// --- UI Primitives ---
import { Button } from "@/components/tiptap-ui-primitive/button"
import { Spacer } from "@/components/tiptap-ui-primitive/spacer"
import {
  Toolbar,
  ToolbarGroup,
  ToolbarSeparator,
} from "@/components/tiptap-ui-primitive/toolbar"

// --- Tiptap Node ---
import { ImageUploadNode } from "@/components/tiptap-node/image-upload-node/image-upload-node-extension"
import "@/components/tiptap-node/code-block-node/code-block-node.scss"
import "@/components/tiptap-node/list-node/list-node.scss"
import "@/components/tiptap-node/image-node/image-node.scss"
import "@/components/tiptap-node/paragraph-node/paragraph-node.scss"

// --- Tiptap UI ---
import { HeadingDropdownMenu } from "@/components/tiptap-ui/heading-dropdown-menu"
import { ImageUploadButton } from "@/components/tiptap-ui/image-upload-button"
import { ListDropdownMenu } from "@/components/tiptap-ui/list-dropdown-menu"
import { BlockquoteButton } from "@/components/tiptap-ui/blockquote-button"
import { CodeBlockButton } from "@/components/tiptap-ui/code-block-button"
import {
  ColorHighlightPopover,
  ColorHighlightPopoverContent,
  ColorHighlightPopoverButton,
} from "@/components/tiptap-ui/color-highlight-popover"
import {
  LinkPopover,
  LinkContent,
  LinkButton,
} from "@/components/tiptap-ui/link-popover"
import { MarkButton } from "@/components/tiptap-ui/mark-button"
import { TextAlignButton } from "@/components/tiptap-ui/text-align-button"
import { UndoRedoButton } from "@/components/tiptap-ui/undo-redo-button"

// --- Icons ---
import { ArrowLeftIcon } from "@/components/tiptap-icons/arrow-left-icon"
import { HighlighterIcon } from "@/components/tiptap-icons/highlighter-icon"
import { LinkIcon } from "@/components/tiptap-icons/link-icon"

// --- Hooks ---



// --- Components ---
import { ThemeToggle } from "@/components/tiptap-templates/simple/theme-toggle"

// --- Lib ---


// --- Styles ---
import "@/components/tiptap-templates/simple/simple-editor.scss"

import { useCursorVisibility } from "../../hooks/use-cursor-visibility"
import { MAX_FILE_SIZE } from "../../lib/tiptap-utils"
import { useMobile } from "../../hooks/use-mobile"
import { useWindowSize } from "../../hooks/use-window-size"

const MainToolbarContent = ({
  onHighlighterClick,
  onLinkClick,
  isMobile,
}: {
  onHighlighterClick: () => void
  onLinkClick: () => void
  isMobile: boolean
}) => {
  return (
    <>
      <Spacer />

      <ToolbarGroup>
        <UndoRedoButton action="undo" />
        <UndoRedoButton action="redo" />
      </ToolbarGroup>

      <ToolbarSeparator />

      <ToolbarGroup>
        <HeadingDropdownMenu levels={[1, 2, 3, 4]} />
        <ListDropdownMenu types={["bulletList", "orderedList", "taskList"]} />
        <BlockquoteButton />
        <CodeBlockButton />
      </ToolbarGroup>

      <ToolbarSeparator />

      <ToolbarGroup>
        <MarkButton type="bold" />
        <MarkButton type="italic" />
        <MarkButton type="strike" />
        <MarkButton type="code" />
        <MarkButton type="underline" />
        {!isMobile ? (
          <ColorHighlightPopover />
        ) : (
          <ColorHighlightPopoverButton onClick={onHighlighterClick} />
        )}
        {!isMobile ? <LinkPopover /> : <LinkButton onClick={onLinkClick} />}
      </ToolbarGroup>

      <ToolbarSeparator />

      <ToolbarGroup>
        <MarkButton type="superscript" />
        <MarkButton type="subscript" />
      </ToolbarGroup>

      <ToolbarSeparator />

      <ToolbarGroup>
        <TextAlignButton align="left" />
        <TextAlignButton align="center" />
        <TextAlignButton align="right" />
        <TextAlignButton align="justify" />
      </ToolbarGroup>

      <ToolbarSeparator />

      <ToolbarGroup>
        <ImageUploadButton text="Add" />
      </ToolbarGroup>

      <Spacer />

      {isMobile && <ToolbarSeparator />}

      <ToolbarGroup>
        <ThemeToggle />
      </ToolbarGroup>
    </>
  )
}

const MobileToolbarContent = ({
  type,
  onBack,
}: {
  type: "highlighter" | "link"
  onBack: () => void
}) => (
  <>
    <ToolbarGroup>
      <Button data-style="ghost" onClick={onBack}>
        <ArrowLeftIcon className="tiptap-button-icon" />
        {type === "highlighter" ? (
          <HighlighterIcon className="tiptap-button-icon" />
        ) : (
          <LinkIcon className="tiptap-button-icon" />
        )}
      </Button>
    </ToolbarGroup>

    <ToolbarSeparator />

    {type === "highlighter" ? (
      <ColorHighlightPopoverContent />
    ) : (
      <LinkContent />
    )}
  </>
)

export function SimpleEditor({
  editorContent,
  setEditorContent,
  outputFormat = "html",
}: {
  editorContent: string;
  setEditorContent: (content: any | string) => void;
  outputFormat?: "html" | "json";
}) {
  const isMobile = useMobile()
  const windowSize = useWindowSize()
  const [mobileView, setMobileView] = React.useState<
    "main" | "highlighter" | "link"
  >("main")
  
  // Selection popover state
  const [selectionPopover, setSelectionPopover] = React.useState<{
    isVisible: boolean
    coords: { x: number; y: number } | null
    selection: { from: number; to: number; text: string } | null
    showLinkPopover: boolean
  }>({
    isVisible: false,
    coords: null,
    selection: null,
    showLinkPopover: false,
  })
  const toolbarRef = React.useRef<HTMLDivElement>(null)

  // Enhanced file upload function with toast notifications
  const handleImageUploadWithToast = React.useCallback(async (
    file: File
  ): Promise<string> => {
    if (!file) {
      throw new Error("No file provided")
    }

    if (file.size > MAX_FILE_SIZE) {
      const errorMsg = `File size exceeds maximum allowed (${MAX_FILE_SIZE / (1024 * 1024)}MB)`
      toast.error("Upload failed", { description: errorMsg, duration: 4000 })
      throw new Error(errorMsg)
    }

    // Show loading toast
    const toastId = toast.loading('Uploading image...', {
      description: 'Please wait while your image is being uploaded.',
      duration: Infinity,
    })

    try {
      // Use the SDK directly to upload the file
      const result = await sdk.admin.upload.create({
        files: [file]
      })

      // Dismiss loading toast
      toast.dismiss(toastId)

      // Return the URL of the uploaded file
      if (result.files && result.files.length > 0) {
        toast.success('Image uploaded!', { duration: 2000 })
        return result.files[0].url
      }

      toast.error('Upload failed', { duration: 3000 })
      throw new Error('No file URL returned')
    } catch (error) {
      toast.dismiss(toastId)
      const errorMessage = (error as Error)?.message || 'Unknown error'
      toast.error('Error uploading image', { description: errorMessage, duration: 4000 })
      console.error('Error uploading image:', error)
      throw error
    }
  }, [])

  const editor = useEditor({
    immediatelyRender: false,
    editorProps: {
      attributes: {
        autocomplete: "off",
        autocorrect: "off",
        autocapitalize: "off",
        "aria-label": "Main content area, start typing to enter text.",
      },
    },
    extensions: [
      StarterKit,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Underline,
      TaskList,
      TaskItem.configure({ nested: true }),
      Highlight.configure({ multicolor: true }),
      Image,
      Typography,
      Superscript,
      Subscript,
      Selection,
      ImageUploadNode.configure({
        accept: "image/*",
        maxSize: MAX_FILE_SIZE,
        limit: 3,
        upload: handleImageUploadWithToast,
        onError: (error) => console.error("Upload failed:", error),
      }),
      TrailingNode,
      Link.configure({ openOnClick: false }),
      SelectionPopover.configure({
        onSelectionChange: (selection) => {
          // Handle selection changes if needed
          
        },
        onShowPopover: (selection, coords) => {
          setSelectionPopover({
            isVisible: true,
            coords,
            selection,
            showLinkPopover: false,
          })
        },
        onHidePopover: () => {
          setSelectionPopover({
            isVisible: false,
            coords: null,
            selection: null,
            showLinkPopover: false,
          })
        },
      }),
      TextStyleKit,
    ],
    content: React.useMemo(() => {
      // Handle initial content based on output format
      if (outputFormat === "json" && typeof editorContent === "string") {
        try {
          // If it's a JSON string, parse it to object for Tiptap
          return JSON.parse(editorContent)
        } catch (error) {
          // If parsing fails, treat as HTML content
          console.warn('Failed to parse JSON content, treating as HTML:', error)
          return editorContent
        }
      }
      // For HTML format or if content is already an object, use as-is
      return editorContent
    }, [editorContent, outputFormat]),
    onUpdate: ({ editor }) => {
      // Get content in the requested format
      const content = outputFormat === "json" 
        ? editor.getJSON()
        : editor.getHTML()
      
      setEditorContent(content)
    },
  })

  const bodyRect = useCursorVisibility({
    editor,
    overlayHeight: toolbarRef.current?.getBoundingClientRect().height ?? 0,
  })

  React.useEffect(() => {
    if (!isMobile && mobileView !== "main") {
      setMobileView("main")
    }
  }, [isMobile, mobileView])

  return (
    <EditorContext.Provider value={{ editor }}>
      <Toolbar
        ref={toolbarRef}
        style={
          isMobile
            ? {
                bottom: `calc(100% - ${windowSize.height - bodyRect.y}px)`,
              }
            : {}
        }
      >
        {mobileView === "main" ? (
          <MainToolbarContent
            onHighlighterClick={() => setMobileView("highlighter")}
            onLinkClick={() => setMobileView("link")}
            isMobile={isMobile}
          />
        ) : (
          <MobileToolbarContent
            type={mobileView === "highlighter" ? "highlighter" : "link"}
            onBack={() => setMobileView("main")}
          />
        )}
      </Toolbar>

      <div className="content-wrapper">
        <EditorContent
          editor={editor}
          role="presentation"
          className="simple-editor-content"
        />
        
        {/* Selection Popover for Quick Link Creation */}
        {selectionPopover.isVisible && selectionPopover.coords && selectionPopover.selection && (
          <div
            className="fixed z-50 bg-ui-bg-base border border-ui-border-base rounded-lg shadow-elevation-modal"
            style={{
              left: selectionPopover.coords.x,
              top: selectionPopover.coords.y - 10,
              transform: 'translateX(-50%)',
              minWidth: selectionPopover.showLinkPopover ? '320px' : '180px',
            }}
          >
            {selectionPopover.showLinkPopover ? (
              // Show link popover content for desktop
              <div className="p-3">
                {/* Header with navigation */}
                <div className="flex items-center justify-between mb-3 pb-2 border-b border-ui-border-base">
                  <div className="flex items-center gap-2">
                    <Button
                      className="flex items-center gap-1 text-ui-fg-subtle hover:text-ui-fg-base hover:bg-ui-bg-subtle-hover px-2 py-1 rounded text-sm transition-colors"
                      onClick={() => {
                        setSelectionPopover(prev => ({
                          ...prev,
                          showLinkPopover: false,
                        }))
                      }}
                    >
                      <span className="text-xs">←</span>
                      <span>Back</span>
                    </Button>
                  </div>
                  <Button
                    className="flex items-center justify-center w-6 h-6 text-ui-fg-muted hover:text-ui-fg-base hover:bg-ui-bg-subtle-hover rounded transition-colors"
                    onClick={() => {
                      setSelectionPopover({
                        isVisible: false,
                        coords: null,
                        selection: null,
                        showLinkPopover: false,
                      })
                    }}
                  >
                    ✕
                  </Button>
                </div>
                
                {/* Link Content */}
                <div className="space-y-2">
                  <LinkContent />
                </div>
              </div>
            ) : (
              // Show initial selection popover
              <div className="p-2">
                <div className="flex items-center gap-1">
                  <Button
                    className="flex items-center gap-2 bg-ui-button-neutral text-ui-fg-base hover:bg-ui-button-neutral-hover px-3 py-2 rounded-md text-sm font-medium transition-colors"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      
                      // Focus the editor and set selection
                      if (editor && selectionPopover.selection) {
                        try {
                          editor.commands.focus()
                          editor.commands.setTextSelection({
                            from: selectionPopover.selection.from,
                            to: selectionPopover.selection.to,
                          })
                          
                          // For mobile, use mobile view
                          if (isMobile) {
                            setMobileView('link')
                            // Hide selection popover for mobile
                            setSelectionPopover({
                              isVisible: false,
                              coords: null,
                              selection: null,
                              showLinkPopover: false,
                            })
                          } else {
                            // For desktop, show link popover inline
                            setSelectionPopover(prev => ({
                              ...prev,
                              showLinkPopover: true,
                            }))
                          }
                          
                        } catch (error) {
                          console.error('Error in button click handler:', error)
                        }
                      }
                    }}
                  >
                    <span className="text-base">🔗</span>
                    <span>Add Link</span>
                  </Button>
                  <Button
                    className="flex items-center justify-center w-8 h-8 text-ui-fg-muted hover:text-ui-fg-base hover:bg-ui-bg-subtle-hover rounded transition-colors"
                    onClick={() => {
                      setSelectionPopover({
                        isVisible: false,
                        coords: null,
                        selection: null,
                        showLinkPopover: false,
                      })
                    }}
                  >
                    ✕
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </EditorContext.Provider>
  )
}
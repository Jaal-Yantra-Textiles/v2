import { Button, Drawer, DropdownMenu, Heading, Text, toast, usePrompt } from "@medusajs/ui"
import { EmailEditor, type EmailEditorRef } from "@react-email/editor"
import { StarterKit } from "@react-email/editor/extensions"
import { EmailTheming } from "@react-email/editor/plugins"
import "@react-email/editor/themes/default.css"
import { Placeholder } from "@tiptap/extension-placeholder"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useFileUpload } from "../../hooks/api/upload"
import { convertTipTapToHtml } from "../../../workflows/blogs/send-blog-subscribers/utils/tiptap-to-html"
import { PRODUCT_CARD_NODE, ProductCard } from "./product-card"
import type { ProductCardAttrs } from "./product-card-data"
import { ProductPicker } from "./product-picker"
import { JYT_EMAIL_THEME, STARTER_TEMPLATES } from "./starter-templates"

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const SAVE_DEBOUNCE_MS = 1200
const PERSON_MADE_ATOMS = new Set(["image", "button", "horizontalRule", PRODUCT_CARD_NODE])
const PLACEHOLDER = "Pick a template above, or type “/” to add blocks"

export type EmailComposerValue = { json: unknown; html: string }

type EmailComposerProps = {
  /** The saved email version (editor JSON), or null when the page has none yet. */
  initialContent: unknown | null
  /** The blog post's TipTap JSON, for "Start from this blog post". */
  blogDoc: unknown
  /** The post's slug — the utm_campaign on product card links, as on every other newsletter link. */
  campaign?: string | null
  onSave: (value: EmailComposerValue) => Promise<void>
}

/** The blog converter wraps everything in one styled <div>; the editor wants the inside. */
const blogDocToHtml = (doc: unknown): string => {
  const html = convertTipTapToHtml(doc as any)
  const match = html.match(/^\s*<div[^>]*>([\s\S]*)<\/div>\s*$/)
  return match ? match[1] : html
}

/**
 * #2349 — the Email tab. A React Email editor that builds the inside of the
 * `blog-subscriber` email: columns, buttons, sized/aligned/clickable images.
 * Saves editor JSON (to reopen it) and email HTML (to send it).
 */
export const EmailComposer = ({ initialContent, blogDoc, campaign, onSave }: EmailComposerProps) => {
  const prompt = usePrompt()
  const { mutateAsync: uploadFile } = useFileUpload()
  const editorRef = useRef<EmailEditorRef | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const [seed, setSeed] = useState<{ key: number; content: unknown | null }>({
    key: 0,
    content: initialContent,
  })
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const campaignRef = useRef(campaign)
  campaignRef.current = campaign

  // Passing `extensions` replaces the editor's defaults, so this is its default
  // set (StarterKit, Placeholder, theming) plus the product card. Built once:
  // new extensions would rebuild the editor and drop unsaved state.
  const extensions = useMemo(
    () => [
      StarterKit.configure(),
      Placeholder.configure({ placeholder: PLACEHOLDER, includeChildren: true }),
      EmailTheming.configure({ theme: JYT_EMAIL_THEME }),
      ProductCard.configure({ getUtmCampaign: () => campaignRef.current }),
    ],
    []
  )

  useEffect(() => () => clearTimeout(saveTimerRef.current), [])

  const uploadImage = useCallback(
    async (file: File) => {
      if (file.size > MAX_IMAGE_BYTES) {
        toast.error("Image is larger than 5 MB")
        throw new Error("Image too large")
      }
      const result = await uploadFile({ files: [file] })
      const url = result.files?.[0]?.url
      if (!url) {
        toast.error("Upload failed")
        throw new Error("No file URL returned")
      }
      return { url }
    },
    [uploadFile]
  )

  const save = useCallback(
    async (ref: EmailEditorRef) => {
      setStatus("saving")
      try {
        const [html, json] = [await ref.getEmailHTML(), ref.getJSON()]
        await onSave({ json, html })
        setStatus("saved")
      } catch (error) {
        console.error("Email save failed", error)
        setStatus("error")
      }
    },
    [onSave]
  )

  const handleUpdate = useCallback(
    (ref: EmailEditorRef) => {
      editorRef.current = ref
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => save(ref), SAVE_DEBOUNCE_MS)
    },
    [save]
  )

  const startFrom = useCallback(
    async (content: string, label: string) => {
      // `editor.isEmpty` is false for this editor's blank document (it carries
      // wrapper nodes), so ask whether anything a person made is in there.
      const editor = editorRef.current?.editor
      let hasContent = false
      editor?.state.doc.descendants((node) => {
        if (hasContent) return false
        // Not "any atom": the blank document carries a hidden globalContent atom.
        if ((node.isText && node.text?.trim()) || PERSON_MADE_ATOMS.has(node.type.name)) hasContent = true
        return !hasContent
      })
      if (hasContent) {
        const confirmed = await prompt({
          title: `Replace with “${label}”?`,
          description: "The current email will be replaced. The blog post on the website is not affected.",
          confirmText: "Replace",
          cancelText: "Cancel",
        })
        if (!confirmed) return
      }
      setSeed((s) => ({ key: s.key + 1, content }))
      // The new editor reports itself through onReady; save once it has content.
      setStatus("idle")
    },
    [prompt]
  )

  const insertProductCard = useCallback((card: ProductCardAttrs) => {
    setPickerOpen(false)
    editorRef.current?.editor?.chain().focus().insertContent({ type: PRODUCT_CARD_NODE, attrs: card }).run()
  }, [])

  const openPreview = useCallback(async () => {
    const ref = editorRef.current
    if (!ref) return
    setPreviewHtml(await ref.getEmailHTML())
  }, [])

  const statusText = {
    idle: "",
    saving: "Saving…",
    saved: "Saved",
    error: "Not saved — check your connection",
  }[status]

  return (
    <div className="flex h-full flex-col">
      <div className="border-ui-border-base flex items-center justify-between gap-2 border-b px-8 py-2">
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenu.Trigger asChild>
              <Button size="small" variant="secondary">Templates</Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content>
              <DropdownMenu.Item onClick={() => startFrom(blogDocToHtml(blogDoc), "this blog post")}>
                Start from this blog post
              </DropdownMenu.Item>
              <DropdownMenu.Separator />
              {STARTER_TEMPLATES.map((t) => (
                <DropdownMenu.Item key={t.id} onClick={() => startFrom(t.html, t.name)}>
                  <div className="flex flex-col">
                    <span>{t.name}</span>
                    <span className="text-ui-fg-muted txt-compact-xsmall">{t.description}</span>
                  </div>
                </DropdownMenu.Item>
              ))}
              <DropdownMenu.Separator />
              <DropdownMenu.Item onClick={() => startFrom("<p></p>", "a blank email")}>Blank</DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu>
          <Button
            size="small"
            variant="secondary"
            // `uploadImage` is the image extension's own command: file picker → onUploadImage → node.
            onClick={() => (editorRef.current?.editor?.commands as any)?.uploadImage?.()}
          >
            Image
          </Button>
          <Button size="small" variant="secondary" onClick={() => setPickerOpen(true)}>
            Product
          </Button>
          <Button size="small" variant="secondary" onClick={openPreview}>
            Preview
          </Button>
          <Text size="small" className="text-ui-fg-muted">
            Type “/” for columns, buttons, dividers and sections.
          </Text>
        </div>
        <Text size="small" className={status === "error" ? "text-ui-fg-error" : "text-ui-fg-muted"}>
          {statusText}
        </Text>
      </div>

      {/* The frame's linen background and paper column, 620px with 42px sides. */}
      <div className="flex-1 overflow-y-auto bg-[#eeeae2] px-8 py-6">
        <div className="mx-auto max-w-[620px] bg-[#fcfbf8] px-[42px] py-8">
          <EmailEditor
            key={seed.key}
            content={(seed.content as any) ?? undefined}
            theme={JYT_EMAIL_THEME}
            extensions={extensions}
            // The text toolbar (bold, links…) means nothing on a product card.
            bubbleMenu={{ hideWhenActiveNodes: ["button", "horizontalRule", PRODUCT_CARD_NODE] }}
            onUploadImage={uploadImage}
            onUpdate={handleUpdate}
            onReady={(ref) => {
              editorRef.current = ref
              // A freshly chosen template is a change worth keeping.
              if (seed.key > 0) handleUpdate(ref)
            }}
          />
        </div>
      </div>

      <ProductPicker open={pickerOpen} onOpenChange={setPickerOpen} onPick={insertProductCard} />

      <Drawer open={previewHtml !== null} onOpenChange={(open) => !open && setPreviewHtml(null)}>
        <Drawer.Content className="max-w-[720px]">
          <Drawer.Header>
            <Heading>Email preview</Heading>
            <Text size="small" className="text-ui-fg-muted">
              The part this editor builds. The masthead, greeting and footer come from the
              blog-subscriber email template; send a test email to see the whole thing.
            </Text>
          </Drawer.Header>
          <Drawer.Body className="p-0">
            {previewHtml !== null && (
              <iframe
                title="Email preview"
                srcDoc={previewHtml}
                sandbox=""
                className="h-full w-full border-0 bg-white"
              />
            )}
          </Drawer.Body>
        </Drawer.Content>
      </Drawer>
    </div>
  )
}

import { useParams } from "react-router-dom"
import {
  Container,
  Heading,
  Text,
  Badge,
  StatusBadge,
  Skeleton,
  Button,
} from "@medusajs/ui"
import { DocumentText } from "@medusajs/icons"
import {
  useDesign,
  useDesignInventory,
  LinkedInventoryItem,
  DesignSizeSet,
} from "../../../../hooks/api/designs"
import { useDesignMediaFolder } from "../../../../hooks/api/use-design-media-folder"
import { RouteFocusModal } from "../../../../components/modal/route-focus-modal"

const statusColor = (status: string) => {
  switch (status) {
    case "Conceptual":
      return "grey"
    case "In_Development":
    case "Sample_Production":
      return "orange"
    case "Technical_Review":
      return "purple"
    case "Approved":
    case "Commerce_Ready":
      return "green"
    case "Revision":
    case "Rejected":
      return "red"
    default:
      return "grey"
  }
}

const priorityColor = (priority: string) => {
  switch (priority?.toLowerCase()) {
    case "high":
    case "urgent":
      return "red"
    case "medium":
      return "orange"
    case "low":
      return "blue"
    default:
      return "grey"
  }
}

const PrintStyles = () => (
  <style>{`
    @media print {
      /* Prevent images from being cut across pages */
      img {
        break-inside: avoid !important;
        page-break-inside: avoid !important;
        max-height: 280px !important;
        object-fit: contain !important;
      }
      /* Each card / grid item should not split across pages */
      [class*="print\\:break-inside-avoid"] {
        break-inside: avoid !important;
        page-break-inside: avoid !important;
      }
      /* Grid items should not be split */
      .grid > * {
        break-inside: avoid !important;
        page-break-inside: avoid !important;
      }
      /* Allow sections to break between them, not inside */
      .divide-y > * {
        break-inside: avoid !important;
      }
      /* Ensure the modal body takes full width */
      [role="dialog"] {
        position: static !important;
        width: 100% !important;
        max-width: 100% !important;
        height: auto !important;
        max-height: none !important;
        overflow: visible !important;
        transform: none !important;
        box-shadow: none !important;
      }
      /* Remove modal overlay */
      [data-radix-popper-content-wrapper],
      [data-state="open"][role="dialog"] ~ div {
        display: none !important;
      }
      /* Page margins */
      @page {
        margin: 12mm 10mm;
        size: A4;
      }
    }
  `}</style>
)

const DesignStitchingPrintPage = () => {
  const { id } = useParams<{ id: string }>()

  const { design, isLoading } = useDesign(id!, {
    fields: [
      "colors.*",
      "size_sets.*",
      "specifications.*",
      "moodboard",
      "media_files",
    ],
  })

  const { data: inventoryData, isLoading: inventoryLoading } =
    useDesignInventory(id!)
  const inventoryItems: LinkedInventoryItem[] =
    inventoryData?.inventory_items || []

  const { data: mediaFolder, isLoading: mediaFolderLoading } =
    useDesignMediaFolder(id!)
  const mediaFiles = (mediaFolder as any)?.media_files || []

  if (isLoading) {
    return (
      <RouteFocusModal>
        <RouteFocusModal.Header />
        <RouteFocusModal.Body className="flex flex-col items-center py-16">
          <Skeleton className="h-8 w-64 mb-4" />
          <Skeleton className="h-96 w-full max-w-4xl" />
        </RouteFocusModal.Body>
      </RouteFocusModal>
    )
  }

  if (!design) return null

  const moodboard = design.moodboard as any
  const hasMoodboard = moodboard?.elements?.length > 0

  // Combine media from linked folder and any direct media_files on the design
  const designMediaFiles = Array.isArray((design as any).media_files) ? (design as any).media_files : []
  const allMediaFiles = [...mediaFiles, ...designMediaFiles].filter(
    (f: any, i: number, arr: any[]) => arr.findIndex((x: any) => x.id === f.id) === i // dedupe
  )

  const structuredSizeSets: DesignSizeSet[] = design.size_sets || []
  const customSizes = design.custom_sizes || {}
  const hasStructuredSizes = structuredSizeSets.length > 0
  const hasLegacySizes = Object.keys(customSizes).length > 0
  const hasSizes = hasStructuredSizes || hasLegacySizes

  // Collect all unique measurement keys across all size sets
  const allMeasurementKeys = hasStructuredSizes
    ? Array.from(
        new Set(
          structuredSizeSets.flatMap((s) =>
            Object.keys(s.measurements || {})
          )
        )
      )
    : hasLegacySizes
    ? Array.from(
        new Set(
          Object.values(customSizes).flatMap((m: any) =>
            Object.keys(m || {})
          )
        )
      )
    : []

  const description = design.description || ""
  const tags: string[] = Array.isArray(design.tags) ? design.tags : []
  const inspirationSources: string[] = Array.isArray(design.inspiration_sources) ? design.inspiration_sources : []
  const designFiles: string[] = Array.isArray(design.design_files) ? design.design_files : []
  const specifications: any[] = (design as any).specifications || []
  const feedbackHistory: any[] = Array.isArray(design.feedback_history) ? design.feedback_history : []
  const metadata = (design.metadata || {}) as Record<string, any>

  // TipTap JSON → plain text extraction
  const extractTipTapText = (input: any): string => {
    if (!input) return ""
    if (typeof input === "string") {
      if (!input.startsWith("{") && !input.startsWith("[")) return input
      try {
        return extractTipTapText(JSON.parse(input))
      } catch {
        return input
      }
    }
    if (Array.isArray(input)) {
      return input.map(extractTipTapText).filter(Boolean).join("\n")
    }
    if (typeof input === "object") {
      // Text node — return the text content
      if (input.type === "text") return input.text || ""
      // Hard break — newline
      if (input.type === "hardBreak") return "\n"
      // Horizontal rule
      if (input.type === "horizontalRule") return "---"
      // Nodes with content children (paragraph, heading, listItem, blockquote, etc.)
      if (Array.isArray(input.content) && input.content.length > 0) {
        const childText = input.content.map(extractTipTapText).join("")
        // Block-level nodes get newlines between them
        if (["paragraph", "heading", "listItem", "blockquote"].includes(input.type)) {
          return childText
        }
        return childText
      }
      // List wrappers — join children with newlines and add bullets/numbers
      if (input.type === "bulletList" && Array.isArray(input.content)) {
        return input.content
          .map((li: any) => `• ${extractTipTapText(li)}`)
          .join("\n")
      }
      if (input.type === "orderedList" && Array.isArray(input.content)) {
        return input.content
          .map((li: any, i: number) => `${i + 1}. ${extractTipTapText(li)}`)
          .join("\n")
      }
      // Empty paragraph (enter key) — blank line
      if (input.type === "paragraph" || input.type === "heading") return ""
      // Doc root
      if (input.type === "doc" && Array.isArray(input.content)) {
        return input.content.map(extractTipTapText).join("\n")
      }
      // Unknown node with no content — skip, don't stringify
      return ""
    }
    return ""
  }

  // TipTap JSON → HTML string for rich rendering
  const tipTapToHtml = (input: any): string => {
    if (!input) return ""
    if (typeof input === "string") {
      if (!input.startsWith("{") && !input.startsWith("[")) {
        return input.replace(/\n/g, "<br/>")
      }
      try {
        return tipTapToHtml(JSON.parse(input))
      } catch {
        return input.replace(/\n/g, "<br/>")
      }
    }
    if (typeof input !== "object") return ""

    const renderInline = (node: any): string => {
      if (!node) return ""
      if (node.type === "text") {
        let html = (node.text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
        for (const mark of node.marks || []) {
          if (mark.type === "bold") html = `<strong>${html}</strong>`
          else if (mark.type === "italic") html = `<em>${html}</em>`
          else if (mark.type === "underline") html = `<u>${html}</u>`
          else if (mark.type === "strike") html = `<s>${html}</s>`
          else if (mark.type === "code") html = `<code style="background:#f1f1f1;padding:1px 4px;border-radius:3px;font-size:0.9em">${html}</code>`
          else if (mark.type === "link") html = `<a href="${mark.attrs?.href || "#"}" style="color:#0066cc;text-decoration:underline">${html}</a>`
        }
        return html
      }
      if (node.type === "hardBreak") return "<br/>"
      return ""
    }

    const renderBlock = (node: any): string => {
      if (!node) return ""
      const children = (node.content || []).map((c: any) =>
        c.type === "text" || c.type === "hardBreak" ? renderInline(c) : renderBlock(c)
      ).join("")

      switch (node.type) {
        case "doc": return children
        case "paragraph": return children ? `<p style="margin:0 0 8px">${children}</p>` : `<p style="margin:0 0 8px">&nbsp;</p>`
        case "heading": {
          const level = Math.min(Math.max(node.attrs?.level || 2, 1), 6)
          return `<h${level} style="margin:12px 0 6px;font-weight:600">${children}</h${level}>`
        }
        case "bulletList": return `<ul style="margin:0 0 8px;padding-left:20px;list-style:disc">${children}</ul>`
        case "orderedList": return `<ol style="margin:0 0 8px;padding-left:20px;list-style:decimal">${children}</ol>`
        case "listItem": return `<li style="margin:2px 0">${children}</li>`
        case "blockquote": return `<blockquote style="border-left:3px solid #ccc;padding-left:12px;margin:0 0 8px;color:#666;font-style:italic">${children}</blockquote>`
        case "horizontalRule": return `<hr style="border:none;border-top:1px solid #ddd;margin:12px 0"/>`
        default: return children
      }
    }

    return renderBlock(input)
  }

  const handlePrint = () => {
    window.print()
  }

  return (
    <RouteFocusModal>
      <PrintStyles />
      <RouteFocusModal.Header>
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-x-3">
            <Heading className="text-ui-fg-base">
              Stitching Sheet: {design.name}
            </Heading>
          </div>
          <Button
            variant="secondary"
            size="small"
            onClick={handlePrint}
            className="print:hidden"
          >
            <DocumentText className="mr-1.5" />
            Print
          </Button>
        </div>
      </RouteFocusModal.Header>

      <RouteFocusModal.Body className="flex flex-col gap-y-6 overflow-y-auto px-6 py-6 print:px-0 print:py-0 print:gap-y-4">
        {/* Print header — only visible when printing */}
        <div className="hidden print:block print:mb-2">
          <div className="flex items-center justify-between border-b border-ui-border-base pb-3">
            <div>
              <h1 className="text-xl font-bold">{design.name}</h1>
              <p className="text-sm text-ui-fg-subtle">
                Stitching &amp; Sampling Reference
              </p>
            </div>
            <div className="text-right text-sm text-ui-fg-subtle">
              <p>Design ID: {design.id}</p>
              <p>Printed: {new Date().toLocaleDateString()}</p>
            </div>
          </div>
        </div>

        {/* Quick reference strip */}
        <Container className="divide-y p-0 print:shadow-none print:border print:border-ui-border-base">
          <div className="flex items-center justify-between px-6 py-3">
            <Heading level="h2">Design Info</Heading>
            <div className="flex items-center gap-x-2">
              {design.priority && (
                <Badge color={priorityColor(design.priority)}>
                  {design.priority}
                </Badge>
              )}
              {design.status && (
                <StatusBadge color={statusColor(design.status)}>
                  {design.status.replace(/_/g, " ")}
                </StatusBadge>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 px-6 py-4">
            <div>
              <Text size="xsmall" className="text-ui-fg-muted uppercase tracking-wide">Type</Text>
              <Text size="small" weight="plus">{design.design_type || "-"}</Text>
            </div>
            <div>
              <Text size="xsmall" className="text-ui-fg-muted uppercase tracking-wide">Origin</Text>
              <Text size="small" weight="plus">{(design as any).origin_source || "-"}</Text>
            </div>
            <div>
              <Text size="xsmall" className="text-ui-fg-muted uppercase tracking-wide">Est. Cost</Text>
              <Text size="small" weight="plus">{design.estimated_cost ? `$${design.estimated_cost}` : "-"}</Text>
            </div>
            <div>
              <Text size="xsmall" className="text-ui-fg-muted uppercase tracking-wide">Target Date</Text>
              <Text size="small" weight="plus">
                {design.target_completion_date
                  ? new Date(design.target_completion_date).toLocaleDateString()
                  : "-"}
              </Text>
            </div>
            <div>
              <Text size="xsmall" className="text-ui-fg-muted uppercase tracking-wide">Colors</Text>
              <div className="flex items-center gap-1.5 mt-0.5">
                {design.colors?.length ? (
                  design.colors.map((color, i) => (
                    <div
                      key={i}
                      className="size-5 rounded-full border border-ui-border-base print:border-gray-400"
                      style={{ backgroundColor: color.hex_code }}
                      title={color.name}
                    />
                  ))
                ) : (
                  <Text size="small">-</Text>
                )}
              </div>
            </div>
            <div>
              <Text size="xsmall" className="text-ui-fg-muted uppercase tracking-wide">Created</Text>
              <Text size="small" weight="plus">
                {design.created_at ? new Date(design.created_at).toLocaleDateString() : "-"}
              </Text>
            </div>
            <div>
              <Text size="xsmall" className="text-ui-fg-muted uppercase tracking-wide">Updated</Text>
              <Text size="small" weight="plus">
                {design.updated_at ? new Date(design.updated_at).toLocaleDateString() : "-"}
              </Text>
            </div>
            {tags.length > 0 && (
              <div>
                <Text size="xsmall" className="text-ui-fg-muted uppercase tracking-wide">Tags</Text>
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {tags.map((tag, i) => (
                    <Badge key={i} size="2xsmall" color="grey">{tag}</Badge>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Description row */}
          {description && (
            <div className="px-6 py-4">
              <Text size="xsmall" className="text-ui-fg-muted uppercase tracking-wide mb-1">Description</Text>
              <Text size="small" className="whitespace-pre-line">{description}</Text>
            </div>
          )}

          {/* Thumbnail */}
          {design.thumbnail_url && (
            <div className="px-6 py-4">
              <Text size="xsmall" className="text-ui-fg-muted uppercase tracking-wide mb-2">Thumbnail</Text>
              <img
                src={design.thumbnail_url}
                alt={design.name || "Design thumbnail"}
                className="rounded-md border border-ui-border-base max-w-[200px] max-h-[200px] object-cover print:border-gray-300"
                crossOrigin="anonymous"
              />
            </div>
          )}
        </Container>

        {/* Moodboard — centered and prominent */}
        <Container className="p-0 print:shadow-none print:border print:border-ui-border-base">
          <div className="px-6 py-3">
            <Heading level="h2">Moodboard</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              Visual reference for stitching and sampling
            </Text>
          </div>
          <div className="px-6 pb-6">
            {hasMoodboard ? (
              <div className="rounded-lg border border-ui-border-base bg-ui-bg-subtle p-4 print:bg-white print:border-gray-300">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 print:grid-cols-2 print:gap-3">
                  {moodboard.elements
                    .filter(
                      (el: any) => el.type === "image" || el.type === "text"
                    )
                    .map((el: any, i: number) => {
                      if (el.type === "text") {
                        return (
                          <div
                            key={el.id || i}
                            className="rounded-md bg-ui-bg-base border border-ui-border-base p-3 flex items-center justify-center print:break-inside-avoid print:border-gray-300"
                          >
                            <Text
                              size="small"
                              className="text-center"
                            >
                              {el.text}
                            </Text>
                          </div>
                        )
                      }
                      // Resolve image URL from moodboard files map
                      const fileId = el.fileId
                      const file = fileId && moodboard.files?.[fileId]
                      const imageUrl = file?.dataURL || file?.url || el.url || el.src
                      if (imageUrl) {
                        return (
                          <div
                            key={el.id || i}
                            className="rounded-md border border-ui-border-base overflow-hidden print:break-inside-avoid print:border-gray-300"
                          >
                            <img
                              src={imageUrl}
                              alt=""
                              className="w-full h-auto object-contain print:max-h-[280px]"
                              crossOrigin="anonymous"
                            />
                          </div>
                        )
                      }
                      return null
                    })}
                </div>
                <Text className="text-ui-fg-muted mt-3 text-center" size="xsmall">
                  {moodboard.elements.length} element
                  {moodboard.elements.length !== 1 ? "s" : ""} on canvas
                </Text>
              </div>
            ) : (
              <div className="flex items-center justify-center py-8">
                <Text className="text-ui-fg-subtle">
                  No moodboard content
                </Text>
              </div>
            )}
          </div>
        </Container>

        {/* Design Photos from linked media folder + design media_files */}
        {allMediaFiles.length > 0 && (
          <Container className="p-0 print:shadow-none print:border print:border-ui-border-base">
            <div className="px-6 py-3">
              <Heading level="h2">Design Photos</Heading>
              <Text className="text-ui-fg-subtle" size="small">
                Reference images from the design media folder
              </Text>
            </div>
            <div className="px-6 pb-6">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 print:grid-cols-2 print:gap-3">
                {allMediaFiles
                  .filter((f: any) => f.file_type === "image" || f.mime_type?.startsWith("image/"))
                  .map((file: any) => {
                    const url = file.file_path || file.url
                    if (!url) return null
                    return (
                      <div
                        key={file.id}
                        className="rounded-md border border-ui-border-base overflow-hidden print:break-inside-avoid print:border-gray-300"
                      >
                        <img
                          src={url}
                          alt={file.alt_text || file.title || file.original_name || ""}
                          className="w-full h-auto object-contain print:max-h-[280px]"
                          crossOrigin="anonymous"
                        />
                        {(file.title || file.original_name) && (
                          <div className="px-2 py-1.5 bg-ui-bg-subtle print:bg-gray-50">
                            <Text size="xsmall" className="truncate text-ui-fg-subtle">
                              {file.title || file.original_name}
                            </Text>
                          </div>
                        )}
                      </div>
                    )
                  })}
              </div>
            </div>
          </Container>
        )}

        {/* Size Chart — the most critical section for stitching */}
        <Container className="p-0 print:shadow-none print:border print:border-ui-border-base print:break-inside-avoid">
          <div className="px-6 py-3">
            <Heading level="h2">Size Chart</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              Measurements for stitching and sampling
            </Text>
          </div>
          <div className="px-6 pb-6">
            {hasSizes && allMeasurementKeys.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-ui-border-base">
                      <th className="text-left py-2 px-3 font-medium text-ui-fg-subtle">
                        Measurement
                      </th>
                      {hasStructuredSizes
                        ? structuredSizeSets.map((sizeSet) => (
                            <th
                              key={sizeSet.id || sizeSet.size_label}
                              className="text-center py-2 px-3 font-semibold text-ui-fg-base min-w-[80px]"
                            >
                              {sizeSet.size_label}
                            </th>
                          ))
                        : Object.keys(customSizes).map((sizeName) => (
                            <th
                              key={sizeName}
                              className="text-center py-2 px-3 font-semibold text-ui-fg-base min-w-[80px]"
                            >
                              {sizeName}
                            </th>
                          ))}
                    </tr>
                  </thead>
                  <tbody>
                    {allMeasurementKeys.map((key, idx) => (
                      <tr
                        key={key}
                        className={
                          idx % 2 === 0
                            ? "bg-ui-bg-subtle print:bg-gray-50"
                            : ""
                        }
                      >
                        <td className="py-2 px-3 font-medium text-ui-fg-subtle border-b border-ui-border-base">
                          {key}
                        </td>
                        {hasStructuredSizes
                          ? structuredSizeSets.map((sizeSet) => (
                              <td
                                key={sizeSet.id || sizeSet.size_label}
                                className="text-center py-2 px-3 border-b border-ui-border-base"
                              >
                                {sizeSet.measurements?.[key] ?? "-"}
                              </td>
                            ))
                          : Object.entries(customSizes).map(
                              ([sizeName, measurements]: [string, any]) => (
                                <td
                                  key={sizeName}
                                  className="text-center py-2 px-3 border-b border-ui-border-base"
                                >
                                  {measurements?.[key] ?? "-"}
                                </td>
                              )
                            )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex items-center justify-center py-6">
                <Text className="text-ui-fg-subtle">
                  No sizes defined yet
                </Text>
              </div>
            )}
          </div>
        </Container>

        {/* Inventory / Materials */}
        <Container className="p-0 print:shadow-none print:border print:border-ui-border-base print:break-inside-avoid">
          <div className="px-6 py-3">
            <Heading level="h2">Materials &amp; Inventory</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              Items required for stitching
            </Text>
          </div>
          {inventoryLoading ? (
            <div className="px-6 pb-4">
              <Skeleton className="h-16 w-full" />
            </div>
          ) : !inventoryItems.length ? (
            <div className="flex items-center justify-center py-6 pb-6">
              <Text className="text-ui-fg-subtle">
                No inventory items linked
              </Text>
            </div>
          ) : (
            <div className="px-6 pb-6">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-ui-border-base">
                    <th className="text-left py-2 px-3 font-medium text-ui-fg-subtle">
                      Item
                    </th>
                    <th className="text-left py-2 px-3 font-medium text-ui-fg-subtle">
                      SKU
                    </th>
                    <th className="text-center py-2 px-3 font-medium text-ui-fg-subtle">
                      Planned Qty
                    </th>
                    <th className="text-center py-2 px-3 font-medium text-ui-fg-subtle">
                      Consumed
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {inventoryItems.map((item, idx) => {
                    const inv = (item.inventory_item || {}) as {
                      id?: string
                      title?: string
                      sku?: string
                    }
                    return (
                      <tr
                        key={item.inventory_item_id || inv.id || idx}
                        className={
                          idx % 2 === 0
                            ? "bg-ui-bg-subtle print:bg-gray-50"
                            : ""
                        }
                      >
                        <td className="py-2 px-3 font-medium border-b border-ui-border-base">
                          {inv.title ||
                            item.inventory_item_id ||
                            "Inventory Item"}
                        </td>
                        <td className="py-2 px-3 text-ui-fg-subtle border-b border-ui-border-base">
                          {inv.sku || "-"}
                        </td>
                        <td className="text-center py-2 px-3 border-b border-ui-border-base">
                          {item.planned_quantity ?? "-"}
                        </td>
                        <td className="text-center py-2 px-3 border-b border-ui-border-base">
                          {item.consumed_quantity ?? "-"}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Container>

        {/* Color Palette — detailed for stitching reference */}
        {design.colors && design.colors.length > 0 && (
          <Container className="p-0 print:shadow-none print:border print:border-ui-border-base print:break-inside-avoid">
            <div className="px-6 py-3">
              <Heading level="h2">Color Palette</Heading>
              <Text className="text-ui-fg-subtle" size="small">
                Color reference for fabric and thread selection
              </Text>
            </div>
            <div className="px-6 pb-6">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {design.colors.map((color, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 rounded-md border border-ui-border-base p-3 print:border-gray-300"
                  >
                    <div
                      className="size-10 rounded-md border border-ui-border-base shrink-0 print:border-gray-400"
                      style={{ backgroundColor: color.hex_code }}
                    />
                    <div className="min-w-0">
                      <Text size="small" weight="plus" className="truncate">
                        {color.name}
                      </Text>
                      <Text
                        size="xsmall"
                        className="text-ui-fg-subtle font-mono"
                      >
                        {color.hex_code}
                      </Text>
                      {color.usage_notes && (
                        <Text
                          size="xsmall"
                          className="text-ui-fg-muted mt-0.5 line-clamp-2"
                        >
                          {color.usage_notes}
                        </Text>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Container>
        )}

        {/* Specifications */}
        {specifications.length > 0 && (
          <Container className="p-0 print:shadow-none print:border print:border-ui-border-base print:break-inside-avoid">
            <div className="px-6 py-3">
              <Heading level="h2">Specifications</Heading>
              <Text className="text-ui-fg-subtle" size="small">
                Technical specifications for construction and finishing
              </Text>
            </div>
            <div className="px-6 pb-6">
              <div className="flex flex-col gap-4">
                {specifications.map((spec: any, idx: number) => (
                  <div
                    key={spec.id || idx}
                    className="rounded-md border border-ui-border-base p-4 print:border-gray-300"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <Text size="small" weight="plus">{spec.title}</Text>
                      <Badge size="2xsmall" color="blue">{spec.category}</Badge>
                      <Badge size="2xsmall" color={spec.status === "Approved" ? "green" : "grey"}>
                        {spec.status}
                      </Badge>
                      {spec.version && (
                        <Text size="xsmall" className="text-ui-fg-muted">v{spec.version}</Text>
                      )}
                    </div>
                    <Text size="small" className="whitespace-pre-line">{spec.details}</Text>
                    {spec.special_instructions && (
                      <div className="mt-2 pt-2 border-t border-ui-border-base">
                        <Text size="xsmall" className="text-ui-fg-muted uppercase tracking-wide">Special Instructions</Text>
                        <Text size="small" className="whitespace-pre-line mt-1">{spec.special_instructions}</Text>
                      </div>
                    )}
                    {spec.materials_required && Array.isArray(spec.materials_required) && spec.materials_required.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-ui-border-base">
                        <Text size="xsmall" className="text-ui-fg-muted uppercase tracking-wide">Materials Required</Text>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {spec.materials_required.map((m: any, i: number) => (
                            <Badge key={i} size="2xsmall" color="grey">{typeof m === "string" ? m : m.name || JSON.stringify(m)}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {spec.reviewer_notes && (
                      <div className="mt-2 pt-2 border-t border-ui-border-base">
                        <Text size="xsmall" className="text-ui-fg-muted uppercase tracking-wide">Reviewer Notes</Text>
                        <Text size="small" className="whitespace-pre-line mt-1 text-ui-fg-subtle italic">{spec.reviewer_notes}</Text>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </Container>
        )}

        {/* Inspiration Sources */}
        {inspirationSources.length > 0 && (
          <Container className="p-0 print:shadow-none print:border print:border-ui-border-base print:break-inside-avoid">
            <div className="px-6 py-3">
              <Heading level="h2">Inspiration Sources</Heading>
            </div>
            <div className="px-6 pb-6">
              <ul className="list-disc pl-5 space-y-1">
                {inspirationSources.map((source, i) => (
                  <li key={i}>
                    <Text size="small">
                      {typeof source === "string" && source.startsWith("http") ? (
                        <a href={source} className="text-ui-fg-interactive underline print:text-black print:no-underline" target="_blank" rel="noopener noreferrer">
                          {source}
                        </a>
                      ) : (
                        String(source)
                      )}
                    </Text>
                  </li>
                ))}
              </ul>
            </div>
          </Container>
        )}

        {/* Design Files */}
        {designFiles.length > 0 && (
          <Container className="p-0 print:shadow-none print:border print:border-ui-border-base print:break-inside-avoid">
            <div className="px-6 py-3">
              <Heading level="h2">Design Files</Heading>
            </div>
            <div className="px-6 pb-6">
              <ul className="list-disc pl-5 space-y-1">
                {designFiles.map((file, i) => (
                  <li key={i}>
                    <Text size="small">
                      {typeof file === "string" && file.startsWith("http") ? (
                        <a href={file} className="text-ui-fg-interactive underline print:text-black" target="_blank" rel="noopener noreferrer">
                          {file.split("/").pop() || file}
                        </a>
                      ) : (
                        String(file)
                      )}
                    </Text>
                  </li>
                ))}
              </ul>
            </div>
          </Container>
        )}

        {/* Designer Notes */}
        {design.designer_notes && (
          <Container className="p-0 print:shadow-none print:border print:border-ui-border-base print:break-inside-avoid">
            <div className="px-6 py-3">
              <Heading level="h2">Designer Notes</Heading>
            </div>
            <div className="px-6 pb-6">
              <div
                className="rounded-md border border-ui-border-base bg-ui-bg-subtle p-4 print:border-gray-300 text-sm leading-relaxed"
                dangerouslySetInnerHTML={{ __html: tipTapToHtml(design.designer_notes) }}
              />
            </div>
          </Container>
        )}

        {/* Feedback History */}
        {feedbackHistory.length > 0 && (
          <Container className="p-0 print:shadow-none print:border print:border-ui-border-base print:break-inside-avoid">
            <div className="px-6 py-3">
              <Heading level="h2">Feedback History</Heading>
              <Text className="text-ui-fg-subtle" size="small">
                Design review and revision history
              </Text>
            </div>
            <div className="px-6 pb-6">
              <div className="flex flex-col gap-3">
                {feedbackHistory.map((entry: any, idx: number) => (
                  <div
                    key={idx}
                    className="rounded-md border border-ui-border-base p-3 print:border-gray-300"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <Text size="small" weight="plus">
                        {entry.author || "Unknown"}
                      </Text>
                      {entry.date && (
                        <Text size="xsmall" className="text-ui-fg-muted">
                          {new Date(entry.date).toLocaleDateString()}
                        </Text>
                      )}
                    </div>
                    <Text size="small" className="whitespace-pre-line text-ui-fg-subtle">
                      {entry.feedback || entry.comment || entry.message || JSON.stringify(entry)}
                    </Text>
                  </div>
                ))}
              </div>
            </div>
          </Container>
        )}

        {/* Metadata */}
        {Object.keys(metadata).length > 0 && (
          <Container className="p-0 print:shadow-none print:border print:border-ui-border-base print:break-inside-avoid">
            <div className="px-6 py-3">
              <Heading level="h2">Additional Details</Heading>
            </div>
            <div className="px-6 pb-6">
              <div className="grid grid-cols-2 gap-3">
                {Object.entries(metadata)
                  .filter(([key]) => !key.startsWith("_"))
                  .map(([key, value]) => (
                    <div key={key}>
                      <Text size="xsmall" className="text-ui-fg-muted uppercase tracking-wide">{key.replace(/_/g, " ")}</Text>
                      <Text size="small" weight="plus">
                        {typeof value === "string" || typeof value === "number"
                          ? String(value)
                          : JSON.stringify(value)}
                      </Text>
                    </div>
                  ))}
              </div>
            </div>
          </Container>
        )}

        {/* Print footer */}
        <div className="hidden print:block print:mt-4 print:pt-3 print:border-t print:border-gray-300">
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>Jaal Yantra Textiles — Stitching &amp; Sampling Sheet</span>
            <span>Confidential — For internal use only</span>
          </div>
        </div>
      </RouteFocusModal.Body>
    </RouteFocusModal>
  )
}

export default DesignStitchingPrintPage

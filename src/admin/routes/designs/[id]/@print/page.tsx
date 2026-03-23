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

const DesignStitchingPrintPage = () => {
  const { id } = useParams<{ id: string }>()

  const { design, isLoading } = useDesign(id!, {
    fields: [
      "colors.*",
      "size_sets.*",
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

  const handlePrint = () => {
    window.print()
  }

  return (
    <RouteFocusModal>
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
              <Text
                size="xsmall"
                className="text-ui-fg-muted uppercase tracking-wide"
              >
                Type
              </Text>
              <Text size="small" weight="plus">
                {design.design_type || "-"}
              </Text>
            </div>
            <div>
              <Text
                size="xsmall"
                className="text-ui-fg-muted uppercase tracking-wide"
              >
                Est. Cost
              </Text>
              <Text size="small" weight="plus">
                {design.estimated_cost ? `$${design.estimated_cost}` : "-"}
              </Text>
            </div>
            <div>
              <Text
                size="xsmall"
                className="text-ui-fg-muted uppercase tracking-wide"
              >
                Target Date
              </Text>
              <Text size="small" weight="plus">
                {design.target_completion_date
                  ? new Date(
                      design.target_completion_date
                    ).toLocaleDateString()
                  : "-"}
              </Text>
            </div>
            <div>
              <Text
                size="xsmall"
                className="text-ui-fg-muted uppercase tracking-wide"
              >
                Colors
              </Text>
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
          </div>
        </Container>

        {/* Moodboard — centered and prominent */}
        <Container className="p-0 print:shadow-none print:border print:border-ui-border-base print:break-inside-avoid">
          <div className="px-6 py-3">
            <Heading level="h2">Moodboard</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              Visual reference for stitching and sampling
            </Text>
          </div>
          <div className="px-6 pb-6">
            {hasMoodboard ? (
              <div className="rounded-lg border border-ui-border-base bg-ui-bg-subtle p-4">
                <div className="flex flex-wrap justify-center gap-4">
                  {moodboard.elements
                    .filter(
                      (el: any) => el.type === "image" || el.type === "text"
                    )
                    .map((el: any, i: number) => {
                      if (el.type === "text") {
                        return (
                          <div
                            key={el.id || i}
                            className="rounded-md bg-ui-bg-base border border-ui-border-base p-3 flex items-center justify-center min-w-[120px] max-w-[200px]"
                          >
                            <Text
                              size="small"
                              className="text-center line-clamp-4"
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
                            className="rounded-md border border-ui-border-base overflow-hidden"
                            style={{
                              width: Math.min(
                                Math.max(el.width || 200, 120),
                                320
                              ),
                              height: Math.min(
                                Math.max(el.height || 200, 120),
                                320
                              ),
                            }}
                          >
                            <img
                              src={imageUrl}
                              alt=""
                              className="w-full h-full object-cover"
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
          <Container className="p-0 print:shadow-none print:border print:border-ui-border-base print:break-inside-avoid">
            <div className="px-6 py-3">
              <Heading level="h2">Design Photos</Heading>
              <Text className="text-ui-fg-subtle" size="small">
                Reference images from the design media folder
              </Text>
            </div>
            <div className="px-6 pb-6">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {allMediaFiles
                  .filter((f: any) => f.file_type === "image" || f.mime_type?.startsWith("image/"))
                  .map((file: any) => {
                    const url = file.file_path || file.url
                    if (!url) return null
                    return (
                      <div
                        key={file.id}
                        className="rounded-md border border-ui-border-base overflow-hidden print:border-gray-300"
                      >
                        <img
                          src={url}
                          alt={file.alt_text || file.title || file.original_name || ""}
                          className="w-full h-auto object-cover aspect-square"
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

        {/* Designer notes if present */}
        {design.designer_notes && (
          <Container className="p-0 print:shadow-none print:border print:border-ui-border-base print:break-inside-avoid">
            <div className="px-6 py-3">
              <Heading level="h2">Designer Notes</Heading>
            </div>
            <div className="px-6 pb-6">
              <div className="rounded-md border border-ui-border-base bg-ui-bg-subtle p-4 print:border-gray-300">
                <Text size="small" className="whitespace-pre-wrap">
                  {typeof design.designer_notes === "string" &&
                  design.designer_notes.startsWith("{")
                    ? (() => {
                        try {
                          const parsed = JSON.parse(design.designer_notes)
                          // Extract text from TipTap JSON
                          const extractText = (node: any): string => {
                            if (node.text) return node.text
                            if (node.content)
                              return node.content
                                .map(extractText)
                                .join("")
                            return ""
                          }
                          return extractText(parsed)
                        } catch {
                          return design.designer_notes
                        }
                      })()
                    : design.designer_notes}
                </Text>
              </div>
            </div>
          </Container>
        )}
      </RouteFocusModal.Body>
    </RouteFocusModal>
  )
}

export default DesignStitchingPrintPage

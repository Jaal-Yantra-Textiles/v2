import React from "react"
import { Button, Heading, Select, Text, Textarea, toast, Switch } from "@medusajs/ui"
import { RouteFocusModal } from "../modal/route-focus-modal"
import { FileUpload } from "../common/file-upload"
import { useUploadMedia } from "../../hooks/api/media-folders/use-upload-media"
import { useImageExtraction } from "../../hooks/api/ai"
import RecentExtractionsModal from "../../routes/inventory/import-from-image/recent-extractions/page"
import { useStockLocations } from "../../hooks/api/stock_location"

const allowedMimes = ["image/png", "image/jpeg", "image/webp", "image/gif"]

type ExtractionItem = {
  name?: string
  quantity?: number
  unit?: string
  sku?: string
  confidence?: number
  metadata?: Record<string, any>
}

type ExtractionResult = {
  entity_type: string
  items: ExtractionItem[]
  summary?: string
  verification?: { passed?: boolean; issues?: string[] }
}

export const ImportInventoryFromImage: React.FC = () => {
  const [fileUrl, setFileUrl] = React.useState<string | null>(null)
  const [remoteUrl, setRemoteUrl] = React.useState<string | null>(null)
  const [notes, setNotes] = React.useState<string>("")
  const [verify, setVerify] = React.useState<boolean>(true)
  const [isLoading, setIsLoading] = React.useState<boolean>(false)
  const [result, setResult] = React.useState<ExtractionResult | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [threadId] = React.useState<string>(() => (typeof crypto !== "undefined" && (crypto as any).randomUUID ? (crypto as any).randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`))
  const [stockLocationId, setStockLocationId] = React.useState<string>("")

  React.useEffect(() => {
    return () => {
      try { if (fileUrl) URL.revokeObjectURL(fileUrl) } catch {}
    }
  }, [fileUrl])

  const { mutateAsync: uploadMedia } = useUploadMedia()
  const { mutateAsync: extractImage } = useImageExtraction()
  const { stock_locations = [] } = useStockLocations()

  const handleUploaded = async (f: File, url: string) => {
    if (!allowedMimes.includes(f.type)) {
      toast.error(`Unsupported image type: ${f.type || "unknown"}. Allowed: ${allowedMimes.join(", ")}`)
      return
    }
    setFileUrl(url)
    // Upload via media API then store remote URL
    try {
      setIsLoading(true)
      const resp = await uploadMedia({ files: [f] })
      // Try to extract a usable URL from the result shape
      const r: any = resp?.result || {}
      const urlFromMediaFiles = r.mediaFiles?.[0]?.file_path || r.mediaFiles?.[0]?.url
      const urlFromUploaded = r.uploadedFiles?.[0]?.url
      const finalUrl = urlFromMediaFiles || urlFromUploaded || null
      if (!finalUrl) {
        toast.error("Upload succeeded but no URL was returned")
        setRemoteUrl(null)
      } else {
        setRemoteUrl(finalUrl)
      }
      setResult(null)
      setError(null)
    } catch (e: any) {
      const msg = e?.message || "Failed to upload image"
      setRemoteUrl(null)
      setError(msg)
      toast.error(msg)
    } finally {
      setIsLoading(false)
    }
  }

  const callExtraction = async (persist: boolean) => {
    if (!remoteUrl) {
      toast.error("Please upload an image first")
      return
    }
    if (persist && !stockLocationId) {
      toast.error("Please select a stock location")
      return
    }
    setIsLoading(true)
    setError(null)
    try {
      const json = await extractImage({
        image_url: remoteUrl,
        notes,
        verify: verify ? {} : undefined,
        persist,
        threadId,
        // Name the resource so memory can be queried later for recent image extractions
        resourceId: `image-extraction:inventory-extraction`,
        // Defaults for extraction + creation pipeline
        defaults: {
          notes,
          inventory: {
            stock_location_id: stockLocationId || undefined,
            incoming_from_extraction: true,
          },
        },
      })
      if (persist) {
        toast.success("Created inventory and raw materials from extraction")
        setResult((json as any).result?.extraction || null)
      } else {
        setResult((json as any).result || null)
      }
    } catch (e: any) {
      const msg = e?.message || "Unexpected error"
      setError(msg)
      toast.error(msg)
    } finally {
      setIsLoading(false)
    }
  }

  const clearedRetry = () => {
    setResult(null)
    // Keep image and notes so user can refine
    // Do NOT reset threadId so the agent retains context across retries
  }

  return (
    <>
      <RouteFocusModal.Header>
        <div className="flex w-full items-center justify-end pr-4">
          <RecentExtractionsModal
            onLoad={(extraction) => {
              setResult(extraction)
            }}
            resourceId="image-extraction:inventory-extraction"
          />
        </div>
      </RouteFocusModal.Header>

      <RouteFocusModal.Body className="flex flex-1 flex-col gap-y-4 overflow-y-auto p-4">
        <div className="grid grid-cols-1 gap-4">
          <div>
            <Text className="font-medium">Image</Text>
            <div className="mt-2">
              <FileUpload
                label="Upload image"
                hint="PNG, JPEG, WEBP, GIF"
                accept={allowedMimes.join(",")}
                multiple={false}
                preview={fileUrl || undefined}
                isLoading={isLoading}
                onUploaded={(files) => {
                  const first = files?.[0]
                  if (!first) return
                  handleUploaded(first.file, first.url)
                }}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Text className="font-medium">Verify result</Text>
              <div className="mt-2"><Switch checked={verify} onCheckedChange={setVerify} /></div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Text className="font-medium">Stock Location (for created inventory)</Text>
              <div className="mt-1">
                <Select value={stockLocationId} onValueChange={setStockLocationId}>
                  <Select.Trigger>
                    <Select.Value placeholder="Select stock location" />
                  </Select.Trigger>
                  <Select.Content>
                    {stock_locations.map((loc) => (
                      <Select.Item key={loc.id} value={loc.id}>
                        {loc.name}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select>
              </div>
              <Text size="small" className="text-ui-fg-subtle mt-1">Used when creating inventory levels (incoming quantity from extraction).</Text>
            </div>
          </div>

          <div>
            <Text className="font-medium">Notes (optional)</Text>
            <div className="mt-1">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any hints or constraints for extraction" />
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded bg-ui-bg-base border border-ui-border-base p-3">
            <Text className="text-ui-fg-error">{error}</Text>
          </div>
        )}

        {result && (
          <div className="rounded bg-ui-bg-base border border-ui-border-base p-3">
            <Heading level="h3">Preview</Heading>
            {result.summary && (
              <Text size="small" className="block mt-1 text-ui-fg-subtle">{result.summary}</Text>
            )}
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full border-separate border-spacing-0">
                <thead>
                  <tr className="text-left">
                    <th className="border-b border-ui-border-base pb-2 pr-4">#</th>
                    <th className="border-b border-ui-border-base pb-2 pr-4">Name</th>
                    <th className="border-b border-ui-border-base pb-2 pr-4">Quantity</th>
                    <th className="border-b border-ui-border-base pb-2 pr-4">Unit</th>
                    <th className="border-b border-ui-border-base pb-2 pr-4">SKU</th>
                    <th className="border-b border-ui-border-base pb-2 pr-4">Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {(result.items || []).map((it, idx) => (
                    <tr key={idx} className="align-top">
                      <td className="py-2 pr-4 text-ui-fg-subtle">{idx + 1}</td>
                      <td className="py-2 pr-4"><Text className="font-medium">{it.name || "Unnamed"}</Text></td>
                      <td className="py-2 pr-4">{it.quantity ?? "-"}</td>
                      <td className="py-2 pr-4">{it.unit || "-"}</td>
                      <td className="py-2 pr-4">{it.sku || "-"}</td>
                      <td className="py-2 pr-4">{typeof it.confidence === "number" ? `${Math.round((it.confidence || 0) * 100)}%` : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </RouteFocusModal.Body>

      <RouteFocusModal.Footer>
        <div className="flex items-center justify-end gap-x-2">
          <RouteFocusModal.Close asChild>
            <Button variant="secondary" type="button">Close</Button>
          </RouteFocusModal.Close>
          {!result && (
            <Button type="button" isLoading={isLoading} disabled={isLoading || !remoteUrl} onClick={() => callExtraction(false)}>
              Extract preview
            </Button>
          )}
          {result && (
            <>
              <Button variant="secondary" type="button" onClick={clearedRetry} disabled={isLoading}>Retry with notes</Button>
              <Button type="button" isLoading={isLoading} onClick={() => callExtraction(true)}>Create</Button>
            </>
          )}
        </div>
      </RouteFocusModal.Footer>
    </>
  )
}

export default ImportInventoryFromImage

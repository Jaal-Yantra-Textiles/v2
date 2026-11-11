import { Badge, Button, Drawer, Input, Label, Select, Text, Textarea, toast } from "@medusajs/ui"
import { useEffect, useMemo, useState } from "react"
import {
  DEFAULT_CARE_TEXT,
  resolveBrandConfig,
  useHangTagBrands,
  useHangTagSettings,
} from "../../hooks/api/hang-tag-settings"
import { getProductUrlFromHandle } from "../../lib/storefront-url"
import {
  defaultFabricText,
  generateHangTagPdf,
  HangTagData,
  HangTagOverrides,
} from "./generate-pdf"

/** One printed tag: the product's data plus the text set for this piece. */
export type ReviewTag = {
  key: string
  data: HangTagData
  /** Shown under the title, e.g. the order line's variant */
  variant_line?: string
  copies?: number
}

type Draft = Required<Pick<HangTagOverrides, "variant_line" | "story_text" | "fabric_text" | "care_text">> & {
  copies: number
}

const DEFAULT_BRAND = "__default__"

const buildQrUrl = (handle: string, params: { key: string; value: string }[]) => {
  const base = getProductUrlFromHandle(handle)
  const valid = params.filter((p) => p.key)
  if (!valid.length) return base
  return `${base}?${valid.map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`).join("&")}`
}

/**
 * Review step before printing hang tags (#2541). Pick the brand the tags
 * carry, check each tag's story, fabric and care text (they come from the
 * records, which can be incomplete), set copies, then build one PDF.
 */
export const HangTagReviewDrawer = ({
  open,
  onOpenChange,
  tags,
  title = "Review hang tags",
  defaultBrandId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  tags: ReviewTag[]
  title?: string
  defaultBrandId?: string
}) => {
  const { config: baseConfig } = useHangTagSettings()
  const { brands } = useHangTagBrands()
  const [brandId, setBrandId] = useState<string>(defaultBrandId ?? DEFAULT_BRAND)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [busy, setBusy] = useState(false)

  const brand = brands.find((b) => b.id === brandId) ?? null
  const cfg = useMemo(() => resolveBrandConfig(baseConfig, brand), [baseConfig, brand])
  const careDefault = cfg.care_text || DEFAULT_CARE_TEXT

  // Fresh drafts each time the drawer opens or the brand's care text changes.
  useEffect(() => {
    if (!open) return
    const next: Record<string, Draft> = {}
    for (const t of tags) {
      next[t.key] = {
        variant_line: t.variant_line ?? "",
        story_text: t.data.product.story?.text ?? "",
        fabric_text: defaultFabricText(t.data.product.story),
        care_text: careDefault,
        copies: t.copies ?? 1,
      }
    }
    setDrafts(next)
  }, [open, tags, careDefault])

  useEffect(() => {
    if (open && defaultBrandId) setBrandId(defaultBrandId)
  }, [open, defaultBrandId])

  const patch = (key: string, p: Partial<Draft>) =>
    setDrafts((d) => ({ ...d, [key]: { ...d[key], ...p } }))

  const total = tags.reduce((n, t) => n + (drafts[t.key]?.copies ?? 0), 0)

  const generate = async () => {
    setBusy(true)
    try {
      const { PDFDocument } = await import("pdf-lib")
      const { saveAs } = await import("file-saver")
      const merged = await PDFDocument.create()
      const params = cfg.qr_params ?? []
      let made = 0
      for (const t of tags) {
        const d = drafts[t.key]
        if (!d || d.copies < 1) continue
        const data = cfg.show_qr_code && params.length
          ? { ...t.data, product: { ...t.data.product, storefront_url: buildQrUrl(t.data.product.handle, params) } }
          : t.data
        const bytes = await generateHangTagPdf(data, cfg, d)
        const doc = await PDFDocument.load(bytes)
        for (let c = 0; c < d.copies; c++) {
          const pages = await merged.copyPages(doc, doc.getPageIndices())
          pages.forEach((p) => merged.addPage(p))
          made++
        }
      }
      if (!made) {
        toast.error("Nothing to print: every tag is set to 0 copies")
        return
      }
      const blob = new Blob([(await merged.save()) as BlobPart], { type: "application/pdf" })
      saveAs(blob, `hang-tags-${(brand?.config.brand_name ?? cfg.brand_name ?? "tags").toLowerCase().replace(/\W+/g, "-")}-${Date.now()}.pdf`)
      toast.success(`${made} hang tag(s) ready to print: front and back on consecutive pages`)
      onOpenChange(false)
    } catch (e: any) {
      console.error(e)
      toast.error(`Failed to generate hang tags: ${e?.message ?? "unknown error"}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <Drawer.Content className="max-w-2xl">
        <Drawer.Header>
          <Drawer.Title>{title}</Drawer.Title>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-y-6 overflow-y-auto p-6">
          <div className="flex flex-col gap-y-2">
            <Label size="small" weight="plus">Brand on the tag</Label>
            <Select value={brandId} onValueChange={setBrandId}>
              <Select.Trigger>
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                <Select.Item value={DEFAULT_BRAND}>{baseConfig.brand_name || "Our default"} (default)</Select.Item>
                {brands.map((b) => (
                  <Select.Item key={b.id} value={b.id}>
                    {b.config.brand_name || b.id}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
            <Text size="xsmall" className="text-ui-fg-subtle">
              White-label brands are set up in Settings → Hang Tag. Sections on this print:{" "}
              {[
                cfg.show_story && "story & fabric",
                cfg.show_care && "care",
                cfg.show_mrp && "blank MRP",
                cfg.show_qr_code && "QR code",
              ]
                .filter(Boolean)
                .join(", ") || "none of story / care / MRP"}
              .
            </Text>
          </div>

          {tags.map((t) => {
            const d = drafts[t.key]
            if (!d) return null
            const noStory = cfg.show_story && !t.data.product.story?.text
            return (
              <div key={t.key} className="flex flex-col gap-y-3 rounded-lg border p-4">
                <div className="flex items-center justify-between gap-x-2">
                  <Text weight="plus">{t.data.product.title}</Text>
                  <div className="flex items-center gap-x-2">
                    {noStory && <Badge size="2xsmall" color="orange">No story in records</Badge>}
                    <Label size="xsmall">Copies</Label>
                    <Input
                      type="number"
                      min={0}
                      className="w-16"
                      value={d.copies}
                      onChange={(e) => patch(t.key, { copies: Math.max(0, Number(e.target.value) || 0) })}
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-y-1">
                  <Label size="xsmall">Under the title (colour, fabric, size)</Label>
                  <Input value={d.variant_line} onChange={(e) => patch(t.key, { variant_line: e.target.value })} />
                </div>
                {cfg.show_story && (
                  <>
                    <div className="flex flex-col gap-y-1">
                      <Label size="xsmall">The story</Label>
                      <Textarea rows={4} value={d.story_text} onChange={(e) => patch(t.key, { story_text: e.target.value })} />
                      {(t.data.product.story?.makers.length ?? 0) > 0 && (
                        <Text size="xsmall" className="text-ui-fg-subtle">
                          From records:{" "}
                          {t.data.product.story!.makers
                            .map((m) => [m.name, m.lead, m.place].filter(Boolean).join(", "))
                            .join("; ")}
                        </Text>
                      )}
                    </div>
                    <div className="flex flex-col gap-y-1">
                      <Label size="xsmall">Fabric</Label>
                      <Input value={d.fabric_text} onChange={(e) => patch(t.key, { fabric_text: e.target.value })} />
                    </div>
                  </>
                )}
                {cfg.show_care && (
                  <div className="flex flex-col gap-y-1">
                    <Label size="xsmall">Care</Label>
                    <Textarea rows={3} value={d.care_text} onChange={(e) => patch(t.key, { care_text: e.target.value })} />
                  </div>
                )}
              </div>
            )
          })}
        </Drawer.Body>
        <Drawer.Footer>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={generate} isLoading={busy} disabled={!total}>
            Generate {total} tag{total === 1 ? "" : "s"}
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}

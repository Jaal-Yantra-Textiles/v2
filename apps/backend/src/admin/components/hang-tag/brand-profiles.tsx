import {
  Button,
  Container,
  Drawer,
  Heading,
  Input,
  Label,
  Switch,
  Text,
  Textarea,
  toast,
  usePrompt,
} from "@medusajs/ui"
import { useState } from "react"
import {
  DEFAULT_CARE_TEXT,
  HangTagBrand,
  HangTagConfig,
  useCreateHangTagBrand,
  useDeleteHangTagBrand,
  useHangTagBrands,
  useUpdateHangTagBrand,
} from "../../hooks/api/hang-tag-settings"
import ProductMediaModal from "../media/product-media-modal"

type BrandForm = Pick<
  HangTagConfig,
  | "brand_name"
  | "logo_url"
  | "show_brand_name"
  | "tagline"
  | "header_color"
  | "header_text_color"
  | "care_text"
  | "mrp_label"
  | "mrp_note"
  | "show_story"
  | "show_care"
  | "show_mrp"
  | "show_qr_code"
>

const EMPTY: BrandForm = {
  brand_name: "",
  logo_url: undefined,
  show_brand_name: true,
  tagline: "Made by hand in India",
  header_color: "#ffffff",
  header_text_color: "#111111",
  care_text: DEFAULT_CARE_TEXT,
  mrp_label: "MRP",
  mrp_note: "Inclusive of all taxes",
  show_story: true,
  show_care: true,
  show_mrp: true,
  show_qr_code: false,
}

const fromBrand = (b: HangTagBrand): BrandForm => {
  const out = { ...EMPTY }
  for (const k of Object.keys(EMPTY) as (keyof BrandForm)[]) {
    if (b.config[k] !== undefined) (out as any)[k] = b.config[k]
  }
  return out
}

const TOGGLES: Array<{ key: keyof BrandForm; label: string; hint: string }> = [
  { key: "show_story", label: "Maker story & fabric", hint: "Who made it and where, from production records" },
  { key: "show_care", label: "Care instructions", hint: "The care text below" },
  { key: "show_mrp", label: "Blank MRP line", hint: "For the brand to price by hand" },
  { key: "show_brand_name", label: "Brand name under the logo", hint: "For a logo with no wordmark" },
  { key: "show_qr_code", label: "QR code", hint: "Opens OUR storefront, so usually off for white-label" },
]

/**
 * White-label brand profiles (#2541): a partner or buyer whose name and logo
 * go on the tag instead of ours. Picked in the review step when printing.
 */
export const HangTagBrandProfiles = () => {
  const { brands, isLoading } = useHangTagBrands()
  const create = useCreateHangTagBrand()
  const update = useUpdateHangTagBrand()
  const remove = useDeleteHangTagBrand()
  const prompt = usePrompt()

  const [editing, setEditing] = useState<HangTagBrand | null>(null)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<BrandForm>(EMPTY)
  const [logoOpen, setLogoOpen] = useState(false)

  const start = (b: HangTagBrand | null) => {
    setEditing(b)
    setForm(b ? fromBrand(b) : EMPTY)
    setOpen(true)
  }
  const set = <K extends keyof BrandForm>(k: K, v: BrandForm[K]) => setForm((f) => ({ ...f, [k]: v }))

  const save = () => {
    if (!form.brand_name?.trim()) {
      toast.error("Give the brand a name")
      return
    }
    const config = { ...form, brand_name: form.brand_name.trim(), logo_url: form.logo_url || null } as any
    const done = {
      onSuccess: () => {
        toast.success(editing ? "Brand updated" : "Brand added")
        setOpen(false)
      },
      onError: (e: any) => toast.error(e?.message ?? "Failed to save the brand"),
    }
    if (editing) update.mutate({ id: editing.id, config }, done)
    else create.mutate(config, done)
  }

  const del = async (b: HangTagBrand) => {
    const ok = await prompt({
      title: `Delete ${b.config.brand_name ?? "this brand"}?`,
      description: "Tags already printed are not affected. You can add the brand again later.",
      confirmText: "Delete",
      cancelText: "Cancel",
    })
    if (!ok) return
    remove.mutate(b.id, {
      onSuccess: () => toast.success("Brand deleted"),
      onError: (e: any) => toast.error(e?.message ?? "Failed to delete"),
    })
  }

  return (
    <>
      <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <Heading level="h2">White-label brands</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              Partners or buyers whose name and logo go on the tag instead of ours. Pick one when printing tags from
              the QR page or an order.
            </Text>
          </div>
          <Button variant="secondary" size="small" onClick={() => start(null)}>
            Add brand
          </Button>
        </div>
        {isLoading ? (
          <div className="px-6 py-4">
            <Text size="small" className="text-ui-fg-subtle">Loading...</Text>
          </div>
        ) : !brands.length ? (
          <div className="px-6 py-4">
            <Text size="small" className="text-ui-fg-subtle">No white-label brands yet.</Text>
          </div>
        ) : (
          brands.map((b) => (
            <div key={b.id} className="flex items-center justify-between gap-x-3 px-6 py-3">
              <div className="flex min-w-0 items-center gap-x-3">
                {b.config.logo_url ? (
                  <img src={b.config.logo_url} alt="" className="h-8 w-8 rounded object-contain" />
                ) : (
                  <div className="bg-ui-bg-subtle h-8 w-8 rounded" />
                )}
                <div className="min-w-0">
                  <Text size="small" weight="plus" className="truncate">{b.config.brand_name}</Text>
                  <Text size="xsmall" className="text-ui-fg-subtle truncate">
                    {[
                      b.config.show_story && "story",
                      b.config.show_care && "care",
                      b.config.show_mrp && "MRP",
                      b.config.show_qr_code && "QR",
                    ]
                      .filter(Boolean)
                      .join(" · ") || "no extra sections"}
                  </Text>
                </div>
              </div>
              <div className="flex items-center gap-x-1">
                <Button size="small" variant="transparent" onClick={() => start(b)}>Edit</Button>
                <Button size="small" variant="transparent" onClick={() => del(b)}>Delete</Button>
              </div>
            </div>
          ))
        )}
      </Container>

      <Drawer open={open} onOpenChange={setOpen}>
        <Drawer.Content>
          <Drawer.Header>
            <Drawer.Title>{editing ? `Edit ${editing.config.brand_name}` : "Add white-label brand"}</Drawer.Title>
          </Drawer.Header>
          <Drawer.Body className="flex flex-col gap-y-5 overflow-y-auto p-6">
            <div className="flex flex-col gap-y-1">
              <Label size="small">Brand name</Label>
              <Input value={form.brand_name} onChange={(e) => set("brand_name", e.target.value)} placeholder="Oshen" />
            </div>
            <div className="flex flex-col gap-y-2">
              <Label size="small">Logo</Label>
              <div className="flex items-center gap-x-3">
                {form.logo_url ? (
                  <img src={form.logo_url} alt="" className="h-14 w-14 rounded border object-contain" />
                ) : (
                  <Text size="small" className="text-ui-fg-subtle">None</Text>
                )}
                <Button size="small" variant="secondary" onClick={() => setLogoOpen(true)}>
                  {form.logo_url ? "Change" : "Choose from media"}
                </Button>
                {form.logo_url && (
                  <Button size="small" variant="transparent" onClick={() => set("logo_url", undefined)}>
                    Remove
                  </Button>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-y-1">
              <Label size="small">Line at the foot of the front</Label>
              <Input value={form.tagline} onChange={(e) => set("tagline", e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-y-1">
                <Label size="small">Band colour</Label>
                <Input type="color" value={form.header_color} onChange={(e) => set("header_color", e.target.value)} />
              </div>
              <div className="flex flex-col gap-y-1">
                <Label size="small">Band text colour</Label>
                <Input type="color" value={form.header_text_color} onChange={(e) => set("header_text_color", e.target.value)} />
              </div>
            </div>
            <div className="flex flex-col gap-y-3">
              {TOGGLES.map((t) => (
                <div key={t.key} className="flex items-center justify-between gap-x-3">
                  <div>
                    <Text size="small" weight="plus">{t.label}</Text>
                    <Text size="xsmall" className="text-ui-fg-subtle">{t.hint}</Text>
                  </div>
                  <Switch checked={!!form[t.key]} onCheckedChange={(v) => set(t.key, v as any)} />
                </div>
              ))}
            </div>
            {form.show_care && (
              <div className="flex flex-col gap-y-1">
                <Label size="small">Care text</Label>
                <Textarea rows={4} value={form.care_text} onChange={(e) => set("care_text", e.target.value)} />
              </div>
            )}
            {form.show_mrp && (
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-y-1">
                  <Label size="small">Price label</Label>
                  <Input value={form.mrp_label} onChange={(e) => set("mrp_label", e.target.value)} />
                </div>
                <div className="flex flex-col gap-y-1">
                  <Label size="small">Note under it</Label>
                  <Input value={form.mrp_note} onChange={(e) => set("mrp_note", e.target.value)} />
                </div>
              </div>
            )}
          </Drawer.Body>
          <Drawer.Footer>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} isLoading={create.isPending || update.isPending}>Save</Button>
          </Drawer.Footer>
        </Drawer.Content>
      </Drawer>

      <ProductMediaModal
        open={logoOpen}
        onOpenChange={setLogoOpen}
        initialUrls={form.logo_url ? [form.logo_url] : []}
        onSave={(urls) => {
          if (urls[0]) set("logo_url", urls[0])
          setLogoOpen(false)
        }}
      />
    </>
  )
}

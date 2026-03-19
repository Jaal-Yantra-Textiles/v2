import { useState, useCallback, useRef, useEffect } from "react"
import {
  Button,
  Heading,
  Input,
  Label,
  Switch,
  Text,
  toast,
  Tooltip,
  IconButton,
  Badge,
} from "@medusajs/ui"
import { ArrowPath, Plus, Trash } from "@medusajs/icons"

import {
  RouteFocusModal,
} from "../../../components/modals"
import {
  useWebsiteTheme,
  useUpdateWebsiteTheme,
  WebsiteTheme,
} from "../../../hooks/api/content"
import { Skeleton } from "../../../components/common/skeleton"
import { ImageUploadField } from "../../../components/common/image-upload-field"
import { useStorefrontStatus } from "../../../hooks/api/storefront"

const SOCIAL_PLATFORMS = [
  "Facebook",
  "Instagram",
  "Twitter",
  "LinkedIn",
  "YouTube",
  "TikTok",
  "Pinterest",
]

type ThemeSection =
  | "colors"
  | "branding"
  | "hero"
  | "navigation"
  | "footer"
  | "home_sections"
  | "product_page"
  | "cart"
  | "typography"
  | "buttons"
  | null

export const SettingsTheme = () => {
  return (
    <RouteFocusModal prev="/content">
      <ThemeEditorInner />
    </RouteFocusModal>
  )
}

// --- Sample data matching Medusa Store API shapes ---

/** Mirrors StoreProduct with variants, options, images, calculated_price */
const SAMPLE_PRODUCT = {
  id: "prod_sample_01",
  title: "Heritage Cotton Saree",
  handle: "heritage-cotton-saree",
  subtitle: "Hand-woven luxury textile",
  description:
    "Crafted by master weavers using traditional techniques passed down through generations. This pure cotton saree features intricate border work and a rich pallu design.",
  thumbnail: null as string | null,
  status: "published" as const,
  material: "100% Cotton",
  origin_country: "IN",
  hs_code: "5208.51",
  collection: { id: "col_01", title: "Summer Collection" },
  type: { id: "ptyp_01", value: "Saree" },
  tags: [
    { id: "ptag_01", value: "handwoven" },
    { id: "ptag_02", value: "cotton" },
  ],
  categories: [{ id: "pcat_01", name: "Sarees" }],
  images: [
    { id: "img_01", url: "" },
    { id: "img_02", url: "" },
    { id: "img_03", url: "" },
  ],
  options: [
    {
      id: "opt_01",
      title: "Color",
      values: [
        { id: "optval_01", value: "Indigo" },
        { id: "optval_02", value: "Ivory" },
        { id: "optval_03", value: "Terracotta" },
      ],
    },
  ],
  variants: [
    {
      id: "var_01",
      title: "Indigo",
      sku: "HCS-IND-001",
      manage_inventory: true,
      calculated_price: {
        calculated_amount: 2499,
        original_amount: 2999,
        currency_code: "INR",
      },
      options: [{ id: "optval_01", value: "Indigo", option: { id: "opt_01", title: "Color" } }],
    },
    {
      id: "var_02",
      title: "Ivory",
      sku: "HCS-IVR-001",
      manage_inventory: true,
      calculated_price: {
        calculated_amount: 2499,
        original_amount: 2499,
        currency_code: "INR",
      },
      options: [{ id: "optval_02", value: "Ivory", option: { id: "opt_01", title: "Color" } }],
    },
  ],
}

/** Mirrors StoreCart with items, totals, shipping, region */
const SAMPLE_CART = {
  id: "cart_sample_01",
  currency_code: "INR",
  email: "customer@example.com",
  items: [
    {
      id: "item_01",
      title: "Heritage Cotton Saree",
      subtitle: "Indigo",
      thumbnail: null as string | null,
      quantity: 1,
      unit_price: 2499,
      total: 2499,
      subtotal: 2499,
      tax_total: 0,
      discount_total: 0,
      variant: { id: "var_01", title: "Indigo", sku: "HCS-IND-001" },
      product: { id: "prod_sample_01", title: "Heritage Cotton Saree", handle: "heritage-cotton-saree", thumbnail: null },
    },
    {
      id: "item_02",
      title: "Block Print Cushion Cover",
      subtitle: "Set of 2",
      thumbnail: null as string | null,
      quantity: 2,
      unit_price: 599,
      total: 1198,
      subtotal: 1198,
      tax_total: 0,
      discount_total: 0,
      variant: { id: "var_03", title: "Set of 2", sku: "BPC-S2-001" },
      product: { id: "prod_sample_02", title: "Block Print Cushion Cover", handle: "block-print-cushion", thumbnail: null },
    },
  ],
  item_total: 3697,
  item_subtotal: 3697,
  item_tax_total: 0,
  shipping_total: 99,
  shipping_subtotal: 99,
  shipping_tax_total: 0,
  discount_total: 500,
  total: 3296,
  subtotal: 3296,
  tax_total: 0,
  region: { id: "reg_01", name: "India", currency_code: "INR" },
  shipping_methods: [
    { id: "sm_01", name: "Standard Delivery", amount: 99 },
  ],
}

function formatSamplePrice(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 0,
  }).format(amount)
}

// Sections that live on the homepage — scroll to them via postMessage
const HOMEPAGE_SECTIONS = new Set<ThemeSection>([
  "branding",
  "colors",
  "hero",
  "navigation",
  "footer",
  "home_sections",
])

// Sections that only edit properties (no iframe navigation needed)
const PANEL_ONLY_SECTIONS = new Set<ThemeSection>([
  "product_page",
  "cart",
  "typography",
  "buttons",
])

const ThemeEditorInner = () => {
  const { theme, isPending } = useWebsiteTheme()
  const { mutateAsync: updateTheme, isPending: isSaving } =
    useUpdateWebsiteTheme()
  const { data: storefrontStatus } = useStorefrontStatus()

  const [form, setForm] = useState<WebsiteTheme>({})
  const [activeSection, setActiveSection] = useState<ThemeSection>("hero")
  const [iframeReady, setIframeReady] = useState(false)
  const [iframePath, setIframePath] = useState("/")
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  const domain = storefrontStatus?.domain

  useEffect(() => {
    if (theme) setForm(theme)
  }, [theme])

  // After iframe loads on a homepage, scroll to the active section
  useEffect(() => {
    if (!iframeReady || !activeSection || iframePath !== "/") return
    if (!HOMEPAGE_SECTIONS.has(activeSection)) return

    const scrollTarget =
      activeSection === "branding" || activeSection === "colors"
        ? "nav"
        : activeSection === "home_sections"
          ? "collections"
          : activeSection

    // Small delay to let the storefront render
    const timer = setTimeout(() => {
      iframeRef.current?.contentWindow?.postMessage(
        { type: "SCROLL_TO_SECTION", section: scrollTarget },
        "*"
      )
    }, 300)
    return () => clearTimeout(timer)
  }, [iframeReady, activeSection, iframePath])

  // Listen for messages from the storefront iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data
      if (!data || typeof data !== "object" || !("type" in data)) return
      if (data.type === "THEME_EDITOR_READY") setIframeReady(true)
      if (data.type === "THEME_SECTION_CLICKED") {
        const sectionMap: Record<string, ThemeSection> = {
          hero: "hero",
          nav: "branding",
          footer: "footer",
          product: "product_page",
          cart: "cart",
        }
        const mapped = sectionMap[data.section] || null
        if (mapped) {
          setActiveSection(mapped)
        }
      }
    }
    window.addEventListener("message", handleMessage)
    return () => window.removeEventListener("message", handleMessage)
  }, [])

  const sendPreview = useCallback(
    (section: string, data: Record<string, unknown>) => {
      if (!iframeReady || !iframeRef.current?.contentWindow) return
      iframeRef.current.contentWindow.postMessage(
        { type: "UPDATE_THEME_PREVIEW", section, data },
        "*"
      )
    },
    [iframeReady]
  )

  // Debounced auto-save
  const debouncedSave = useCallback(
    (newForm: WebsiteTheme) => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(async () => {
        try {
          await updateTheme(newForm)
        } catch {
          // silent - user can manually save
        }
      }, 1500)
    },
    [updateTheme]
  )

  const updateForm = useCallback(
    (section: keyof WebsiteTheme, data: Record<string, unknown>) => {
      const newForm = { ...form, [section]: { ...(form[section] as any), ...data } }
      setForm(newForm)
      sendPreview(section, { ...(form[section] as any), ...data })
      debouncedSave(newForm)
    },
    [form, sendPreview, debouncedSave]
  )

  const handleSave = async () => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    try {
      await updateTheme(form)
      toast.success("Theme saved")
    } catch (e: any) {
      toast.error("Could not save theme", {
        description: e?.message || "Something went wrong",
      })
    }
  }

  const handleRefresh = () => {
    setIframeReady(false)
    if (iframeRef.current) iframeRef.current.src = iframeRef.current.src
  }

  const baseUrl = domain
    ? `https://${domain}`
    : `http://localhost:8000`

  const previewUrl = `${baseUrl}${iframePath}${iframePath.includes("?") ? "&" : "?"}theme_editor=true`

  // Navigate the iframe when switching sections
  const handleSectionChange = useCallback(
    (section: ThemeSection) => {
      setActiveSection(section)
      if (!section) return

      // Panel-only sections — no iframe navigation
      if (PANEL_ONLY_SECTIONS.has(section)) return

      // Homepage sections: navigate to / if not there, then scroll
      if (HOMEPAGE_SECTIONS.has(section)) {
        if (iframePath !== "/") {
          setIframePath("/")
          setIframeReady(false)
        } else if (iframeReady) {
          const scrollTarget =
            section === "branding" || section === "colors"
              ? "nav"
              : section === "home_sections"
                ? "collections"
                : section
          iframeRef.current?.contentWindow?.postMessage(
            { type: "SCROLL_TO_SECTION", section: scrollTarget },
            "*"
          )
        }
      }
    },
    [iframePath, iframeReady]
  )

  if (isPending) {
    return (
      <>
        <RouteFocusModal.Header>
          <div className="flex items-center gap-x-3">
            <Skeleton className="h-6 w-28" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        </RouteFocusModal.Header>
        <RouteFocusModal.Body className="p-0 h-[calc(100vh-120px)]">
          <div className="flex h-full overflow-hidden">
            <div className="w-[180px] border-r border-ui-border-base bg-ui-bg-subtle p-3 space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full rounded-md" />
              ))}
            </div>
            <div className="flex-1 bg-ui-bg-subtle p-3">
              <Skeleton className="w-full h-full rounded-lg" />
            </div>
            <div className="w-[300px] border-l border-ui-border-base p-4 space-y-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="space-y-1.5">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-8 w-full rounded-md" />
                </div>
              ))}
            </div>
          </div>
        </RouteFocusModal.Body>
      </>
    )
  }

  return (
    <>
      <RouteFocusModal.Header>
        <div className="flex items-center gap-x-3">
          <RouteFocusModal.Title asChild>
            <Heading>Theme Editor</Heading>
          </RouteFocusModal.Title>
          <Badge color={iframeReady ? "green" : "orange"} size="2xsmall">
            {iframeReady ? "Connected" : "Loading..."}
          </Badge>
        </div>
        <div className="flex items-center gap-x-2">
          <Tooltip content="Refresh preview">
            <IconButton
              variant="transparent"
              size="small"
              onClick={handleRefresh}
            >
              <ArrowPath />
            </IconButton>
          </Tooltip>
          <Button size="small" onClick={handleSave} isLoading={isSaving}>
            Save
          </Button>
        </div>
      </RouteFocusModal.Header>

      <RouteFocusModal.Body className="p-0 h-[calc(100vh-120px)]">
        <div className="flex h-full overflow-hidden">
        {/* Section tabs */}
        <div className="w-[180px] border-r border-ui-border-base bg-ui-bg-subtle overflow-y-auto shrink-0">
          {([
            {
              group: "Design",
              items: [
                ["branding", "Branding"],
                ["colors", "Colors"],
                ["typography", "Typography"],
                ["buttons", "Buttons"],
              ] as const,
            },
            {
              group: "Layout",
              items: [
                ["hero", "Hero"],
                ["navigation", "Navigation"],
                ["footer", "Footer"],
                ["home_sections", "Home Layout"],
              ] as const,
            },
            {
              group: "Pages",
              items: [
                ["product_page", "Product Page"],
                ["cart", "Cart"],
              ] as const,
            },
          ]).map(({ group, items }) => (
            <div key={group} className="px-2 pb-2">
              <Text
                size="xsmall"
                className="text-ui-fg-muted uppercase font-semibold tracking-wide px-3 pb-1 pt-2"
              >
                {group}
              </Text>
              <div className="flex flex-col gap-y-0.5">
                {items.map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => handleSectionChange(key)}
                    className={`flex items-center px-3 py-1.5 rounded-md text-left text-sm transition-colors ${
                      activeSection === key
                        ? "bg-ui-bg-highlight border border-ui-border-strong"
                        : "hover:bg-ui-bg-base border border-transparent"
                    }`}
                  >
                    <Text size="small">{label}</Text>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Preview iframe */}
        <div className="flex-1 bg-ui-bg-subtle p-3">
          <div className="w-full h-full rounded-lg shadow-elevation-card-rest overflow-hidden bg-white">
            <iframe
              ref={iframeRef}
              src={previewUrl}
              className="w-full h-full border-0"
              sandbox="allow-scripts allow-same-origin allow-forms"
            />
          </div>
        </div>

        {/* Property panel */}
        <div className="w-[300px] border-l border-ui-border-base overflow-y-auto bg-ui-bg-base shrink-0">
          <div className="p-4">
            {activeSection === "branding" && (
              <BrandingPanel form={form} updateForm={updateForm} />
            )}
            {activeSection === "colors" && (
              <ColorsPanel form={form} updateForm={updateForm} />
            )}
            {activeSection === "hero" && (
              <HeroPanel form={form} updateForm={updateForm} setForm={setForm} sendPreview={sendPreview} debouncedSave={debouncedSave} />
            )}
            {activeSection === "navigation" && (
              <NavigationPanel form={form} setForm={setForm} debouncedSave={debouncedSave} />
            )}
            {activeSection === "footer" && (
              <FooterPanel form={form} updateForm={updateForm} setForm={setForm} debouncedSave={debouncedSave} />
            )}
            {activeSection === "home_sections" && (
              <HomeSectionsPanel form={form} updateForm={updateForm} setForm={setForm} debouncedSave={debouncedSave} />
            )}
            {activeSection === "typography" && (
              <TypographyPanel form={form} updateForm={updateForm} />
            )}
            {activeSection === "buttons" && (
              <ButtonsPanel form={form} updateForm={updateForm} />
            )}
            {activeSection === "product_page" && (
              <ProductPagePanel form={form} updateForm={updateForm} />
            )}
            {activeSection === "cart" && (
              <CartPanel form={form} updateForm={updateForm} />
            )}
            {!activeSection && (
              <div className="flex flex-col items-center justify-center h-full text-center py-12">
                <Text size="small" className="text-ui-fg-subtle">
                  Select a section to edit
                </Text>
              </div>
            )}
          </div>
        </div>
      </div>
    </RouteFocusModal.Body>
    </>
  )
}

// --- Section Panels ---

type PanelProps = {
  form: WebsiteTheme
  updateForm: (section: keyof WebsiteTheme, data: Record<string, unknown>) => void
}

function SectionHeading({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="mb-4">
      <Text className="font-semibold">{title}</Text>
      <Text size="xsmall" className="text-ui-fg-muted">
        {desc}
      </Text>
    </div>
  )
}

function BrandingPanel({ form, updateForm }: PanelProps) {
  return (
    <>
      <SectionHeading title="Branding" desc="Store identity and visual marks" />
      <div className="space-y-3">
        <FieldInput
          label="Store Name"
          value={form.branding?.store_name || ""}
          onChange={(v) => updateForm("branding", { ...form.branding, store_name: v })}
        />
        <FieldInput
          label="Tagline"
          value={form.branding?.tagline || ""}
          onChange={(v) => updateForm("branding", { ...form.branding, tagline: v })}
          placeholder="Quality textiles since 2020"
        />
        <ImageUploadField
          label="Logo"
          value={form.branding?.logo_url || ""}
          onChange={(v) => updateForm("branding", { ...form.branding, logo_url: v })}
          hint="Recommended: PNG or SVG, 200x60px"
          compact
        />
        <ImageUploadField
          label="Favicon"
          value={form.branding?.favicon_url || ""}
          onChange={(v) => updateForm("branding", { ...form.branding, favicon_url: v })}
          hint="ICO, PNG, or SVG. 32x32px"
          compact
        />
      </div>
    </>
  )
}

function ColorsPanel({ form, updateForm }: PanelProps) {
  return (
    <>
      <SectionHeading title="Colors" desc="Customize storefront colors" />
      <div className="space-y-3">
        {(
          [
            ["primary", "Primary"],
            ["secondary", "Secondary"],
            ["background", "Background"],
            ["text", "Text"],
            ["accent", "Accent"],
            ["muted", "Muted"],
            ["border", "Border"],
          ] as const
        ).map(([key, label]) => (
          <div key={key} className="space-y-1">
            <Label size="xsmall">{label}</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                className="h-7 w-7 cursor-pointer rounded border border-ui-border-base shrink-0"
                value={form.colors?.[key] || "#000000"}
                onChange={(e) =>
                  updateForm("colors", { ...form.colors, [key]: e.target.value })
                }
              />
              <Input
                size="small"
                placeholder="#000000"
                value={form.colors?.[key] || ""}
                onChange={(e) =>
                  updateForm("colors", { ...form.colors, [key]: e.target.value })
                }
              />
            </div>
          </div>
        ))}

        {/* Live swatch preview */}
        <div className="pt-3 border-t border-ui-border-base">
          <Label size="xsmall" className="mb-2 block">Preview</Label>
          <div
            className="rounded-lg p-3 border space-y-1.5"
            style={{ backgroundColor: form.colors?.background || "#ffffff" }}
          >
            <div
              className="text-sm font-semibold"
              style={{ color: form.colors?.text || "#000000" }}
            >
              Heading text
            </div>
            <div
              className="text-xs"
              style={{ color: form.colors?.muted || "#6b7280" }}
            >
              Muted description text
            </div>
            <div className="flex gap-2 pt-1">
              <div
                className="rounded px-2 py-1 text-xs text-white"
                style={{ backgroundColor: form.colors?.primary || "#000000" }}
              >
                Primary
              </div>
              <div
                className="rounded px-2 py-1 text-xs"
                style={{
                  backgroundColor: form.colors?.accent || "#f3f4f6",
                  color: form.colors?.text || "#000000",
                }}
              >
                Accent
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

const FONT_OPTIONS = [
  "Inter", "System UI", "Roboto", "Open Sans", "Lato", "Poppins",
  "Montserrat", "Playfair Display", "Merriweather", "DM Sans",
  "Space Grotesk", "Outfit", "Plus Jakarta Sans",
]

function TypographyPanel({ form, updateForm }: PanelProps) {
  const typo = form.typography || {}

  return (
    <>
      <SectionHeading title="Typography" desc="Fonts and text sizing" />
      <div className="space-y-3">
        <div className="space-y-1">
          <Label size="xsmall">Body Font</Label>
          <select
            className="w-full h-8 rounded-md border border-ui-border-base bg-ui-bg-field px-2 text-sm"
            value={typo.font_family || "Inter"}
            onChange={(e) =>
              updateForm("typography", { ...typo, font_family: e.target.value })
            }
          >
            {FONT_OPTIONS.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <Label size="xsmall">Heading Font</Label>
          <select
            className="w-full h-8 rounded-md border border-ui-border-base bg-ui-bg-field px-2 text-sm"
            value={typo.heading_font_family || "Inter"}
            onChange={(e) =>
              updateForm("typography", { ...typo, heading_font_family: e.target.value })
            }
          >
            {FONT_OPTIONS.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <Label size="xsmall">Base Font Size</Label>
          <div className="grid grid-cols-4 gap-1">
            {["14px", "15px", "16px", "18px"].map((v) => (
              <button
                key={v}
                className={`px-2 py-1 text-xs rounded border ${
                  (typo.base_font_size || "16px") === v
                    ? "border-ui-fg-interactive bg-ui-bg-interactive text-ui-fg-on-color"
                    : "border-ui-border-base text-ui-fg-subtle"
                }`}
                onClick={() => updateForm("typography", { ...typo, base_font_size: v })}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1">
          <Label size="xsmall">Heading Weight</Label>
          <div className="grid grid-cols-3 gap-1">
            {(["500", "600", "700"] as const).map((v) => (
              <button
                key={v}
                className={`px-2 py-1 text-xs rounded border ${
                  (typo.heading_weight || "600") === v
                    ? "border-ui-fg-interactive bg-ui-bg-interactive text-ui-fg-on-color"
                    : "border-ui-border-base text-ui-fg-subtle"
                }`}
                onClick={() => updateForm("typography", { ...typo, heading_weight: v })}
              >
                {v === "500" ? "Medium" : v === "600" ? "Semi" : "Bold"}
              </button>
            ))}
          </div>
        </div>

        {/* Preview */}
        <div className="pt-3 border-t border-ui-border-base">
          <Label size="xsmall" className="mb-2 block">Preview</Label>
          <div className="rounded-lg border p-3 bg-ui-bg-subtle space-y-1">
            <div
              style={{
                fontFamily: typo.heading_font_family || "Inter",
                fontWeight: Number(typo.heading_weight || 600),
                fontSize: "18px",
              }}
            >
              Heading Text
            </div>
            <div
              style={{
                fontFamily: typo.font_family || "Inter",
                fontSize: typo.base_font_size || "16px",
              }}
              className="text-ui-fg-subtle"
            >
              Body text preview with your selected font settings.
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

function ButtonsPanel({ form, updateForm }: PanelProps) {
  const btn = form.buttons || {}
  const colors = form.colors || {}

  return (
    <>
      <SectionHeading title="Buttons" desc="Button style across the store" />
      <div className="space-y-3">
        <div className="space-y-1">
          <Label size="xsmall">Border Radius</Label>
          <div className="grid grid-cols-4 gap-1">
            {(["0px", "4px", "8px", "9999px"] as const).map((v) => (
              <button
                key={v}
                className={`px-2 py-1 text-xs rounded border ${
                  (btn.border_radius || "8px") === v
                    ? "border-ui-fg-interactive bg-ui-bg-interactive text-ui-fg-on-color"
                    : "border-ui-border-base text-ui-fg-subtle"
                }`}
                onClick={() => updateForm("buttons", { ...btn, border_radius: v })}
              >
                {v === "0px" ? "Sharp" : v === "4px" ? "Subtle" : v === "8px" ? "Round" : "Pill"}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1">
          <Label size="xsmall">Primary Style</Label>
          <div className="grid grid-cols-2 gap-1">
            {(["filled", "outline"] as const).map((v) => (
              <button
                key={v}
                className={`px-2 py-1 text-xs rounded border ${
                  (btn.primary_style || "filled") === v
                    ? "border-ui-fg-interactive bg-ui-bg-interactive text-ui-fg-on-color"
                    : "border-ui-border-base text-ui-fg-subtle"
                }`}
                onClick={() => updateForm("buttons", { ...btn, primary_style: v })}
              >
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Preview */}
        <div className="pt-3 border-t border-ui-border-base">
          <Label size="xsmall" className="mb-2 block">Preview</Label>
          <div className="flex gap-2">
            <button
              className="px-4 py-2 text-sm transition-colors"
              style={{
                borderRadius: btn.border_radius || "8px",
                ...(btn.primary_style === "outline"
                  ? {
                      backgroundColor: "transparent",
                      border: `2px solid ${colors.primary || "#000"}`,
                      color: colors.primary || "#000",
                    }
                  : {
                      backgroundColor: colors.primary || "#000",
                      color: "#fff",
                      border: "2px solid transparent",
                    }),
              }}
            >
              Add to Cart
            </button>
            <button
              className="px-4 py-2 text-sm border-2"
              style={{
                borderRadius: btn.border_radius || "8px",
                borderColor: colors.border || "#e5e7eb",
                color: colors.text || "#000",
                backgroundColor: "transparent",
              }}
            >
              Secondary
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

function HeroPanel({
  form,
  updateForm,
  setForm,
  sendPreview,
  debouncedSave,
}: PanelProps & {
  setForm: (f: WebsiteTheme) => void
  sendPreview: (s: string, d: Record<string, unknown>) => void
  debouncedSave: (f: WebsiteTheme) => void
}) {
  return (
    <>
      <SectionHeading title="Hero" desc="Homepage hero section" />
      <div className="space-y-3">
        {/* Layout */}
        <div className="space-y-1">
          <Label size="xsmall">Layout</Label>
          <div className="grid grid-cols-4 gap-1">
            {(["center", "left", "right", "split"] as const).map((v) => (
              <button
                key={v}
                className={`px-2 py-1 text-xs rounded border ${
                  (form.hero?.layout || "center") === v
                    ? "border-ui-fg-interactive bg-ui-bg-interactive text-ui-fg-on-color"
                    : "border-ui-border-base text-ui-fg-subtle"
                }`}
                onClick={() => updateForm("hero", { ...form.hero, layout: v })}
              >
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <FieldInput
          label="Badge Text"
          value={form.hero?.badge_text || ""}
          onChange={(v) => updateForm("hero", { ...form.hero, badge_text: v })}
        />
        <FieldInput
          label="Title"
          value={form.hero?.title || ""}
          onChange={(v) => updateForm("hero", { ...form.hero, title: v })}
        />
        <FieldInput
          label="Subtitle"
          value={form.hero?.subtitle || ""}
          onChange={(v) => updateForm("hero", { ...form.hero, subtitle: v })}
        />
        <div className="space-y-1">
          <Label size="xsmall">Description</Label>
          <textarea
            className="w-full rounded-md border border-ui-border-base bg-ui-bg-field px-2 py-1.5 text-sm min-h-[60px] resize-y"
            value={form.hero?.description || ""}
            onChange={(e) =>
              updateForm("hero", { ...form.hero, description: e.target.value })
            }
          />
        </div>
        <ImageUploadField
          label="Background Image"
          value={form.hero?.background_image_url || ""}
          onChange={(v) =>
            updateForm("hero", { ...form.hero, background_image_url: v })
          }
          hint="Recommended: 1920x1080px or larger"
        />
        <div className="space-y-1">
          <Label size="xsmall">
            Overlay ({form.hero?.overlay_opacity ?? 0}%)
          </Label>
          <input
            type="range"
            min={0}
            max={100}
            value={form.hero?.overlay_opacity ?? 0}
            onChange={(e) =>
              updateForm("hero", {
                ...form.hero,
                overlay_opacity: Number(e.target.value),
              })
            }
            className="w-full"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <FieldInput
            label="CTA Text"
            value={form.hero?.cta_text || ""}
            onChange={(v) => updateForm("hero", { ...form.hero, cta_text: v })}
          />
          <FieldInput
            label="CTA Link"
            value={form.hero?.cta_link || ""}
            onChange={(v) => updateForm("hero", { ...form.hero, cta_link: v })}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <FieldInput
            label="2nd CTA"
            value={form.hero?.secondary_cta_text || ""}
            onChange={(v) =>
              updateForm("hero", { ...form.hero, secondary_cta_text: v })
            }
          />
          <FieldInput
            label="2nd Link"
            value={form.hero?.secondary_cta_link || ""}
            onChange={(v) =>
              updateForm("hero", { ...form.hero, secondary_cta_link: v })
            }
          />
        </div>

        {/* Features */}
        <div className="space-y-2 pt-2 border-t border-ui-border-base">
          <div className="flex items-center justify-between">
            <Label size="xsmall">Features</Label>
            <button
              className="text-xs text-ui-fg-interactive hover:underline"
              onClick={() => {
                const newForm = {
                  ...form,
                  hero: {
                    ...form.hero,
                    features: [
                      ...(form.hero?.features || []),
                      { title: "", description: "" },
                    ],
                  },
                }
                setForm(newForm)
                debouncedSave(newForm)
              }}
            >
              + Add
            </button>
          </div>
          {(form.hero?.features || []).map((feat, i) => (
            <div
              key={i}
              className="p-2 rounded border border-ui-border-base bg-ui-bg-subtle space-y-1"
            >
              <div className="flex gap-1">
                <Input
                  size="small"
                  placeholder="Icon"
                  className="w-12"
                  value={feat.icon || ""}
                  onChange={(e) => {
                    const features = [...(form.hero?.features || [])]
                    features[i] = { ...features[i], icon: e.target.value }
                    const newForm = { ...form, hero: { ...form.hero, features } }
                    setForm(newForm)
                    debouncedSave(newForm)
                  }}
                />
                <Input
                  size="small"
                  placeholder="Title"
                  className="flex-1"
                  value={feat.title}
                  onChange={(e) => {
                    const features = [...(form.hero?.features || [])]
                    features[i] = { ...features[i], title: e.target.value }
                    const newForm = { ...form, hero: { ...form.hero, features } }
                    setForm(newForm)
                    debouncedSave(newForm)
                  }}
                />
                <button
                  className="text-ui-fg-muted hover:text-ui-fg-error"
                  onClick={() => {
                    const features = (form.hero?.features || []).filter(
                      (_, idx) => idx !== i
                    )
                    const newForm = { ...form, hero: { ...form.hero, features } }
                    setForm(newForm)
                    debouncedSave(newForm)
                  }}
                >
                  <Trash className="w-3.5 h-3.5" />
                </button>
              </div>
              <Input
                size="small"
                placeholder="Description"
                value={feat.description || ""}
                onChange={(e) => {
                  const features = [...(form.hero?.features || [])]
                  features[i] = { ...features[i], description: e.target.value }
                  const newForm = { ...form, hero: { ...form.hero, features } }
                  setForm(newForm)
                  debouncedSave(newForm)
                }}
              />
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

function NavigationPanel({
  form,
  setForm,
  debouncedSave,
}: {
  form: WebsiteTheme
  setForm: (f: WebsiteTheme) => void
  debouncedSave: (f: WebsiteTheme) => void
}) {
  const nav = form.navigation || {}

  return (
    <>
      <SectionHeading title="Navigation" desc="Header bar and menu links" />
      <div className="space-y-3">
        <div className="space-y-1">
          <Label size="xsmall">Style</Label>
          <div className="grid grid-cols-3 gap-1">
            {(["solid", "transparent", "bordered"] as const).map((v) => (
              <button
                key={v}
                className={`px-2 py-1 text-xs rounded border ${
                  (nav.style || "solid") === v
                    ? "border-ui-fg-interactive bg-ui-bg-interactive text-ui-fg-on-color"
                    : "border-ui-border-base text-ui-fg-subtle"
                }`}
                onClick={() => {
                  const newForm = {
                    ...form,
                    navigation: { ...nav, style: v },
                  }
                  setForm(newForm)
                  debouncedSave(newForm)
                }}
              >
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <Label size="xsmall">Sticky Header</Label>
          <Switch
            checked={nav.sticky ?? true}
            onCheckedChange={(checked) => {
              const newForm = {
                ...form,
                navigation: { ...nav, sticky: checked },
              }
              setForm(newForm)
              debouncedSave(newForm)
            }}
          />
        </div>

        <div className="flex items-center justify-between">
          <Label size="xsmall">Show Search</Label>
          <Switch
            checked={nav.show_search ?? true}
            onCheckedChange={(checked) => {
              const newForm = {
                ...form,
                navigation: { ...nav, show_search: checked },
              }
              setForm(newForm)
              debouncedSave(newForm)
            }}
          />
        </div>

        <div className="flex items-center justify-between">
          <Label size="xsmall">Show Cart Icon</Label>
          <Switch
            checked={nav.show_cart_icon ?? true}
            onCheckedChange={(checked) => {
              const newForm = {
                ...form,
                navigation: { ...nav, show_cart_icon: checked },
              }
              setForm(newForm)
              debouncedSave(newForm)
            }}
          />
        </div>

        <div className="flex items-center justify-between">
          <Label size="xsmall">Show Account Link</Label>
          <Switch
            checked={nav.show_account_link ?? true}
            onCheckedChange={(checked) => {
              const newForm = {
                ...form,
                navigation: { ...nav, show_account_link: checked },
              }
              setForm(newForm)
              debouncedSave(newForm)
            }}
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label size="xsmall">Links</Label>
            <button
              className="text-xs text-ui-fg-interactive hover:underline"
              onClick={() => {
                const newForm = {
                  ...form,
                  navigation: {
                    ...form.navigation,
                    links: [
                      ...(form.navigation?.links || []),
                      { label: "", href: "" },
                    ],
                  },
                }
                setForm(newForm)
                debouncedSave(newForm)
              }}
            >
              + Add
            </button>
          </div>
          {(form.navigation?.links || []).map((link, i) => (
            <div key={i} className="flex items-center gap-1">
              <Input
                size="small"
                placeholder="Label"
                value={link.label}
                onChange={(e) => {
                  const links = [...(form.navigation?.links || [])]
                  links[i] = { ...links[i], label: e.target.value }
                  const newForm = {
                    ...form,
                    navigation: { ...form.navigation, links },
                  }
                  setForm(newForm)
                  debouncedSave(newForm)
                }}
              />
              <Input
                size="small"
                placeholder="/path"
                value={link.href}
                onChange={(e) => {
                  const links = [...(form.navigation?.links || [])]
                  links[i] = { ...links[i], href: e.target.value }
                  const newForm = {
                    ...form,
                    navigation: { ...form.navigation, links },
                  }
                  setForm(newForm)
                  debouncedSave(newForm)
                }}
              />
              <button
                className="text-ui-fg-muted hover:text-ui-fg-error shrink-0"
                onClick={() => {
                  const links = (form.navigation?.links || []).filter(
                    (_, idx) => idx !== i
                  )
                  const newForm = {
                    ...form,
                    navigation: { ...form.navigation, links },
                  }
                  setForm(newForm)
                  debouncedSave(newForm)
                }}
              >
                <Trash className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

function FooterPanel({
  form,
  updateForm,
  setForm,
  debouncedSave,
}: PanelProps & {
  setForm: (f: WebsiteTheme) => void
  debouncedSave: (f: WebsiteTheme) => void
}) {
  return (
    <>
      <SectionHeading title="Footer" desc="Footer content and social links" />
      <div className="space-y-3">
        <FieldInput
          label="Footer Text"
          value={form.footer?.text || ""}
          onChange={(v) => updateForm("footer", { ...form.footer, text: v })}
        />
        <FieldInput
          label="Copyright Text"
          value={form.footer?.copyright_text || ""}
          onChange={(v) =>
            updateForm("footer", { ...form.footer, copyright_text: v })
          }
          placeholder="© 2026 Your Store. All rights reserved."
        />

        <div className="flex items-center justify-between">
          <Label size="xsmall">Newsletter Signup</Label>
          <Switch
            checked={form.footer?.show_newsletter === true}
            onCheckedChange={(checked) => {
              const newForm = {
                ...form,
                footer: { ...form.footer, show_newsletter: checked },
              }
              setForm(newForm)
              debouncedSave(newForm)
            }}
          />
        </div>
        {form.footer?.show_newsletter && (
          <>
            <FieldInput
              label="Newsletter Heading"
              value={form.footer?.newsletter_heading || ""}
              onChange={(v) =>
                updateForm("footer", { ...form.footer, newsletter_heading: v })
              }
              placeholder="Stay in the loop"
            />
            <FieldInput
              label="Newsletter Description"
              value={form.footer?.newsletter_description || ""}
              onChange={(v) =>
                updateForm("footer", {
                  ...form.footer,
                  newsletter_description: v,
                })
              }
              placeholder="Subscribe for updates and exclusive offers."
            />
          </>
        )}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label size="xsmall">Social Links</Label>
            <button
              className="text-xs text-ui-fg-interactive hover:underline"
              onClick={() => {
                const newForm = {
                  ...form,
                  footer: {
                    ...form.footer,
                    social_links: [
                      ...(form.footer?.social_links || []),
                      { platform: "Facebook", url: "" },
                    ],
                  },
                }
                setForm(newForm)
                debouncedSave(newForm)
              }}
            >
              + Add
            </button>
          </div>
          {(form.footer?.social_links || []).map((sl, i) => (
            <div key={i} className="flex items-center gap-1">
              <select
                className="h-7 rounded border border-ui-border-base bg-ui-bg-field px-1 text-xs w-[90px] shrink-0"
                value={sl.platform}
                onChange={(e) => {
                  const social_links = [...(form.footer?.social_links || [])]
                  social_links[i] = {
                    ...social_links[i],
                    platform: e.target.value,
                  }
                  const newForm = {
                    ...form,
                    footer: { ...form.footer, social_links },
                  }
                  setForm(newForm)
                  debouncedSave(newForm)
                }}
              >
                {SOCIAL_PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <Input
                size="small"
                placeholder="https://..."
                className="flex-1"
                value={sl.url}
                onChange={(e) => {
                  const social_links = [...(form.footer?.social_links || [])]
                  social_links[i] = { ...social_links[i], url: e.target.value }
                  const newForm = {
                    ...form,
                    footer: { ...form.footer, social_links },
                  }
                  setForm(newForm)
                  debouncedSave(newForm)
                }}
              />
              <button
                className="text-ui-fg-muted hover:text-ui-fg-error shrink-0"
                onClick={() => {
                  const social_links = (form.footer?.social_links || []).filter(
                    (_, idx) => idx !== i
                  )
                  const newForm = {
                    ...form,
                    footer: { ...form.footer, social_links },
                  }
                  setForm(newForm)
                  debouncedSave(newForm)
                }}
              >
                <Trash className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

function HomeSectionsPanel({
  form,
  updateForm,
  setForm,
  debouncedSave,
}: PanelProps & {
  setForm: (f: WebsiteTheme) => void
  debouncedSave: (f: WebsiteTheme) => void
}) {
  const hs = form.home_sections || {}

  return (
    <>
      <SectionHeading title="Home Layout" desc="Configure homepage sections" />
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label size="xsmall">Show Collections</Label>
          <Switch
            checked={hs.show_featured_collections !== false}
            onCheckedChange={(v) =>
              updateForm("home_sections", { ...hs, show_featured_collections: v })
            }
          />
        </div>
        <FieldInput
          label="Collection Heading"
          value={hs.collection_heading || ""}
          onChange={(v) =>
            updateForm("home_sections", { ...hs, collection_heading: v })
          }
          placeholder="Featured Collections"
        />
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label size="xsmall">Max Collections</Label>
            <Input
              size="small"
              type="number"
              min={1}
              max={10}
              value={hs.featured_collection_count || 3}
              onChange={(e) =>
                updateForm("home_sections", {
                  ...hs,
                  featured_collection_count: Number(e.target.value),
                })
              }
            />
          </div>
          <div className="space-y-1">
            <Label size="xsmall">Products per</Label>
            <Input
              size="small"
              type="number"
              min={1}
              max={12}
              value={hs.products_per_collection || 3}
              onChange={(e) =>
                updateForm("home_sections", {
                  ...hs,
                  products_per_collection: Number(e.target.value),
                })
              }
            />
          </div>
        </div>
        <FieldInput
          label="Sample Product Name"
          value={hs.empty_state_product_name || ""}
          onChange={(v) =>
            updateForm("home_sections", { ...hs, empty_state_product_name: v })
          }
          placeholder="Shown when no products exist"
        />

        <div className="pt-2 border-t border-ui-border-base" />

        <div className="flex items-center justify-between">
          <Label size="xsmall">Show Categories</Label>
          <Switch
            checked={hs.show_categories === true}
            onCheckedChange={(v) =>
              updateForm("home_sections", { ...hs, show_categories: v })
            }
          />
        </div>
        <FieldInput
          label="Category Heading"
          value={hs.category_heading || ""}
          onChange={(v) =>
            updateForm("home_sections", { ...hs, category_heading: v })
          }
          placeholder="Shop by Category"
        />

        <div className="pt-2 border-t border-ui-border-base" />

        <div className="space-y-1">
          <Label size="xsmall">Sections Order</Label>
          <Text size="xsmall" className="text-ui-fg-muted">
            Drag to reorder (comma-separated)
          </Text>
          <Input
            size="small"
            placeholder="hero, collections, categories"
            value={(hs.sections_order || ["hero", "collections", "categories"]).join(", ")}
            onChange={(e) => {
              const order = e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter((s) =>
                  ["hero", "collections", "categories"].includes(s)
                ) as Array<"hero" | "collections" | "categories">
              updateForm("home_sections", { ...hs, sections_order: order })
            }}
          />
        </div>
      </div>
    </>
  )
}

function ProductPagePanel({ form, updateForm }: PanelProps) {
  const pp = form.product_page || {}
  const colors = form.colors || {}
  const btn = form.buttons || {}

  return (
    <>
      <SectionHeading title="Product Page" desc="Customize product detail pages" />
      <div className="space-y-3">
        <div className="space-y-1">
          <Label size="xsmall">Image Layout</Label>
          <div className="grid grid-cols-3 gap-1">
            {(["gallery", "single", "grid"] as const).map((v) => (
              <button
                key={v}
                className={`px-2 py-1 text-xs rounded border ${
                  (pp.image_layout || "gallery") === v
                    ? "border-ui-fg-interactive bg-ui-bg-interactive text-ui-fg-on-color"
                    : "border-ui-border-base text-ui-fg-subtle"
                }`}
                onClick={() => updateForm("product_page", { ...pp, image_layout: v })}
              >
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1">
          <Label size="xsmall">Gallery Position</Label>
          <div className="grid grid-cols-2 gap-1">
            {(["left", "right"] as const).map((v) => (
              <button
                key={v}
                className={`px-2 py-1 text-xs rounded border ${
                  (pp.gallery_position || "left") === v
                    ? "border-ui-fg-interactive bg-ui-bg-interactive text-ui-fg-on-color"
                    : "border-ui-border-base text-ui-fg-subtle"
                }`}
                onClick={() => updateForm("product_page", { ...pp, gallery_position: v })}
              >
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1">
          <Label size="xsmall">Description Layout</Label>
          <div className="grid grid-cols-3 gap-1">
            {(["tabs", "accordion", "stacked"] as const).map((v) => (
              <button
                key={v}
                className={`px-2 py-1 text-xs rounded border ${
                  (pp.description_layout || "tabs") === v
                    ? "border-ui-fg-interactive bg-ui-bg-interactive text-ui-fg-on-color"
                    : "border-ui-border-base text-ui-fg-subtle"
                }`}
                onClick={() => updateForm("product_page", { ...pp, description_layout: v })}
              >
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <FieldInput
          label="Add to Cart Text"
          value={pp.cta_text || ""}
          onChange={(v) => updateForm("product_page", { ...pp, cta_text: v })}
          placeholder="Add to cart"
        />

        <div className="flex items-center justify-between">
          <Label size="xsmall">Show Breadcrumbs</Label>
          <Switch
            checked={pp.show_breadcrumbs !== false}
            onCheckedChange={(v) =>
              updateForm("product_page", { ...pp, show_breadcrumbs: v })
            }
          />
        </div>
        <div className="flex items-center justify-between">
          <Label size="xsmall">Show SKU</Label>
          <Switch
            checked={pp.show_sku === true}
            onCheckedChange={(v) =>
              updateForm("product_page", { ...pp, show_sku: v })
            }
          />
        </div>
        <div className="flex items-center justify-between">
          <Label size="xsmall">Show Stock Status</Label>
          <Switch
            checked={pp.show_stock_status === true}
            onCheckedChange={(v) =>
              updateForm("product_page", { ...pp, show_stock_status: v })
            }
          />
        </div>
        <div className="flex items-center justify-between">
          <Label size="xsmall">Show Tabs</Label>
          <Switch
            checked={pp.show_tabs !== false}
            onCheckedChange={(v) =>
              updateForm("product_page", { ...pp, show_tabs: v })
            }
          />
        </div>
        <div className="flex items-center justify-between">
          <Label size="xsmall">Show Related Products</Label>
          <Switch
            checked={pp.show_related_products !== false}
            onCheckedChange={(v) =>
              updateForm("product_page", { ...pp, show_related_products: v })
            }
          />
        </div>
        {pp.show_related_products !== false && (
          <FieldInput
            label="Related Heading"
            value={pp.related_heading || ""}
            onChange={(v) =>
              updateForm("product_page", { ...pp, related_heading: v })
            }
            placeholder="You may also like"
          />
        )}

        {/* Inline preview using Medusa StoreProduct shape */}
        <div className="pt-3 border-t border-ui-border-base">
          <Label size="xsmall" className="mb-2 block">Preview</Label>
          <div
            className="rounded-lg border overflow-hidden text-xs"
            style={{ backgroundColor: colors.background || "#fff" }}
          >
            {pp.show_breadcrumbs !== false && (
              <div
                className="px-3 py-1.5 text-[10px]"
                style={{ color: colors.muted || "#9ca3af", borderBottom: `1px solid ${colors.border || "#e5e7eb"}` }}
              >
                Home / {SAMPLE_PRODUCT.categories[0].name} / {SAMPLE_PRODUCT.title}
              </div>
            )}
            <div
              className={`flex gap-2 p-3 ${
                pp.gallery_position === "right" ? "flex-row-reverse" : ""
              }`}
            >
              {/* Image area */}
              <div className="w-1/2 space-y-1">
                <div
                  className="aspect-square rounded flex items-center justify-center"
                  style={{ backgroundColor: colors.muted ? `${colors.muted}22` : "#f9fafb", border: `1px solid ${colors.border || "#e5e7eb"}` }}
                >
                  <Text size="xsmall" className="text-ui-fg-muted">
                    {pp.image_layout === "grid" ? "2×2" : pp.image_layout === "single" ? "1:1" : "Gallery"}
                  </Text>
                </div>
                {pp.image_layout === "gallery" && (
                  <div className="flex gap-0.5">
                    {SAMPLE_PRODUCT.images.map((img) => (
                      <div
                        key={img.id}
                        className="w-1/3 aspect-square rounded"
                        style={{ backgroundColor: colors.muted ? `${colors.muted}22` : "#f3f4f6", border: `1px solid ${colors.border || "#e5e7eb"}` }}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Product info */}
              <div className="w-1/2 space-y-1 py-0.5">
                {SAMPLE_PRODUCT.type && (
                  <div
                    className="text-[9px] uppercase tracking-wide"
                    style={{ color: colors.muted || "#9ca3af" }}
                  >
                    {SAMPLE_PRODUCT.type.value}
                  </div>
                )}
                <div
                  className="font-semibold text-[11px] leading-tight"
                  style={{ color: colors.text || "#000" }}
                >
                  {pp.sample_product_name || SAMPLE_PRODUCT.title}
                </div>
                <div className="flex items-center gap-1">
                  <span
                    className="text-[11px] font-medium"
                    style={{ color: colors.primary || "#000" }}
                  >
                    {pp.sample_product_price || formatSamplePrice(
                      SAMPLE_PRODUCT.variants[0].calculated_price.calculated_amount,
                      SAMPLE_PRODUCT.variants[0].calculated_price.currency_code
                    )}
                  </span>
                  {SAMPLE_PRODUCT.variants[0].calculated_price.original_amount !==
                    SAMPLE_PRODUCT.variants[0].calculated_price.calculated_amount && (
                    <span
                      className="text-[9px] line-through"
                      style={{ color: colors.muted || "#9ca3af" }}
                    >
                      {formatSamplePrice(
                        SAMPLE_PRODUCT.variants[0].calculated_price.original_amount,
                        SAMPLE_PRODUCT.variants[0].calculated_price.currency_code
                      )}
                    </span>
                  )}
                </div>

                {pp.show_sku && (
                  <div className="text-[9px]" style={{ color: colors.muted || "#9ca3af" }}>
                    SKU: {SAMPLE_PRODUCT.variants[0].sku}
                  </div>
                )}
                {pp.show_stock_status && (
                  <div className="text-[9px] text-green-600">In stock</div>
                )}

                {/* Option selector */}
                <div className="pt-1">
                  <div className="text-[9px] mb-0.5" style={{ color: colors.muted || "#9ca3af" }}>
                    {SAMPLE_PRODUCT.options[0].title}
                  </div>
                  <div className="flex gap-0.5">
                    {SAMPLE_PRODUCT.options[0].values.map((v, i) => (
                      <div
                        key={v.id}
                        className="px-1.5 py-0.5 rounded text-[8px]"
                        style={i === 0 ? {
                          backgroundColor: colors.primary || "#000",
                          color: "#fff",
                        } : {
                          border: `1px solid ${colors.border || "#e5e7eb"}`,
                          color: colors.text || "#000",
                        }}
                      >
                        {v.value}
                      </div>
                    ))}
                  </div>
                </div>

                <button
                  className="w-full px-2 py-1 text-[10px] mt-1.5"
                  style={{
                    borderRadius: btn.border_radius || "8px",
                    ...(btn.primary_style === "outline"
                      ? {
                          backgroundColor: "transparent",
                          border: `1.5px solid ${colors.primary || "#000"}`,
                          color: colors.primary || "#000",
                        }
                      : {
                          backgroundColor: colors.primary || "#000",
                          color: "#fff",
                          border: "1.5px solid transparent",
                        }),
                  }}
                >
                  {pp.cta_text || "Add to cart"}
                </button>

                {/* Description layout */}
                <div
                  className="pt-1.5 mt-1 text-[9px]"
                  style={{ borderTop: `1px solid ${colors.border || "#e5e7eb"}`, color: colors.muted || "#9ca3af" }}
                >
                  {pp.description_layout === "accordion" ? (
                    <div className="space-y-0.5">
                      <div className="flex justify-between"><span>Description</span><span>+</span></div>
                      <div className="flex justify-between"><span>Material</span><span>+</span></div>
                    </div>
                  ) : pp.description_layout === "stacked" ? (
                    <div>{SAMPLE_PRODUCT.description?.slice(0, 60)}...</div>
                  ) : (
                    <div className="flex gap-2">
                      <span style={{ color: colors.primary || "#000" }}>Description</span>
                      <span>Details</span>
                      <span>Shipping</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {pp.show_related_products !== false && (
              <div
                className="px-3 py-2"
                style={{ borderTop: `1px solid ${colors.border || "#e5e7eb"}` }}
              >
                <div className="text-[10px] font-medium mb-1" style={{ color: colors.text || "#000" }}>
                  {pp.related_heading || "You may also like"}
                </div>
                <div className="flex gap-1">
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="w-1/3 aspect-square rounded"
                      style={{ backgroundColor: colors.muted ? `${colors.muted}22` : "#f3f4f6", border: `1px solid ${colors.border || "#e5e7eb"}` }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

function CartPanel({ form, updateForm }: PanelProps) {
  const c = form.cart || {}
  const colors = form.colors || {}
  const btn = form.buttons || {}

  return (
    <>
      <SectionHeading title="Cart" desc="Customize the cart and checkout flow" />
      <div className="space-y-3">
        <FieldInput
          label="Heading"
          value={c.heading || ""}
          onChange={(v) => updateForm("cart", { ...c, heading: v })}
          placeholder="Shopping Cart"
        />
        <FieldInput
          label="Checkout Button Text"
          value={c.checkout_button_text || ""}
          onChange={(v) => updateForm("cart", { ...c, checkout_button_text: v })}
          placeholder="Go to checkout"
        />

        <div className="flex items-center justify-between">
          <Label size="xsmall">Show Order Summary</Label>
          <Switch
            checked={c.show_order_summary !== false}
            onCheckedChange={(v) =>
              updateForm("cart", { ...c, show_order_summary: v })
            }
          />
        </div>

        <div className="flex items-center justify-between">
          <Label size="xsmall">Show Sign-in Prompt</Label>
          <Switch
            checked={c.show_sign_in_prompt !== false}
            onCheckedChange={(v) =>
              updateForm("cart", { ...c, show_sign_in_prompt: v })
            }
          />
        </div>

        <div className="flex items-center justify-between">
          <Label size="xsmall">Free Shipping Bar</Label>
          <Switch
            checked={c.show_free_shipping_bar === true}
            onCheckedChange={(v) =>
              updateForm("cart", { ...c, show_free_shipping_bar: v })
            }
          />
        </div>

        {c.show_free_shipping_bar && (
          <FieldInput
            label="Free Shipping Threshold"
            value={c.free_shipping_threshold || ""}
            onChange={(v) =>
              updateForm("cart", { ...c, free_shipping_threshold: v })
            }
            placeholder="$50"
          />
        )}

        <div className="pt-2 border-t border-ui-border-base" />
        <Text size="xsmall" className="text-ui-fg-muted font-semibold">
          Empty Cart
        </Text>

        <FieldInput
          label="Message"
          value={c.empty_message || ""}
          onChange={(v) => updateForm("cart", { ...c, empty_message: v })}
          placeholder="Your cart is empty"
        />
        <div className="grid grid-cols-2 gap-2">
          <FieldInput
            label="CTA Text"
            value={c.empty_cta_text || ""}
            onChange={(v) => updateForm("cart", { ...c, empty_cta_text: v })}
            placeholder="Continue shopping"
          />
          <FieldInput
            label="CTA Link"
            value={c.empty_cta_link || ""}
            onChange={(v) => updateForm("cart", { ...c, empty_cta_link: v })}
            placeholder="/store"
          />
        </div>

        {/* Inline preview using Medusa StoreCart shape */}
        <div className="pt-3 border-t border-ui-border-base">
          <Label size="xsmall" className="mb-2 block">Preview</Label>
          <div
            className="rounded-lg border overflow-hidden text-xs"
            style={{ backgroundColor: colors.background || "#fff" }}
          >
            <div
              className="px-3 py-2 font-semibold text-[11px] border-b"
              style={{
                color: colors.text || "#000",
                borderColor: colors.border || "#e5e7eb",
              }}
            >
              {c.heading || "Shopping Cart"}
              <span
                className="ml-1 font-normal"
                style={{ color: colors.muted || "#9ca3af" }}
              >
                ({SAMPLE_CART.items.length} items)
              </span>
            </div>

            {c.show_free_shipping_bar && (
              <div className="px-3 pt-2">
                <div className="flex justify-between text-[9px] mb-0.5">
                  <span style={{ color: colors.muted || "#9ca3af" }}>
                    {formatSamplePrice(SAMPLE_CART.subtotal, SAMPLE_CART.currency_code)} of{" "}
                    {c.free_shipping_threshold || formatSamplePrice(5000, SAMPLE_CART.currency_code)}
                  </span>
                  <span style={{ color: colors.primary || "#000" }}>Free shipping</span>
                </div>
                <div
                  className="rounded-full h-1.5 overflow-hidden"
                  style={{ backgroundColor: colors.muted ? `${colors.muted}33` : "#e5e7eb" }}
                >
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: "66%",
                      backgroundColor: colors.primary || "#000",
                    }}
                  />
                </div>
              </div>
            )}

            {/* Cart items from sample data */}
            {SAMPLE_CART.items.map((item) => (
              <div
                key={item.id}
                className="flex gap-2 px-3 py-2 border-b"
                style={{ borderColor: colors.border || "#e5e7eb" }}
              >
                <div
                  className="w-9 h-9 rounded shrink-0 flex items-center justify-center"
                  style={{ backgroundColor: colors.muted ? `${colors.muted}22` : "#f3f4f6", border: `1px solid ${colors.border || "#e5e7eb"}` }}
                >
                  <Text size="xsmall" className="text-ui-fg-muted text-[8px]">IMG</Text>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="truncate" style={{ color: colors.text || "#000" }}>
                    {item.title}
                  </div>
                  <div className="flex items-center gap-1" style={{ color: colors.muted || "#9ca3af" }}>
                    <span>{item.subtitle}</span>
                    <span>·</span>
                    <span>Qty: {item.quantity}</span>
                  </div>
                </div>
                <div
                  className="font-medium shrink-0"
                  style={{ color: colors.text || "#000" }}
                >
                  {formatSamplePrice(item.total, SAMPLE_CART.currency_code)}
                </div>
              </div>
            ))}

            {c.show_order_summary !== false && (
              <div className="px-3 py-2 space-y-0.5">
                <div className="flex justify-between" style={{ color: colors.muted || "#9ca3af" }}>
                  <span>Subtotal</span>
                  <span>{formatSamplePrice(SAMPLE_CART.item_subtotal, SAMPLE_CART.currency_code)}</span>
                </div>
                <div className="flex justify-between" style={{ color: colors.muted || "#9ca3af" }}>
                  <span>Shipping</span>
                  <span>{formatSamplePrice(SAMPLE_CART.shipping_total, SAMPLE_CART.currency_code)}</span>
                </div>
                {SAMPLE_CART.discount_total > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>Discount</span>
                    <span>-{formatSamplePrice(SAMPLE_CART.discount_total, SAMPLE_CART.currency_code)}</span>
                  </div>
                )}
                <div
                  className="flex justify-between font-semibold pt-1"
                  style={{ color: colors.text || "#000", borderTop: `1px solid ${colors.border || "#e5e7eb"}` }}
                >
                  <span>Total</span>
                  <span>{formatSamplePrice(SAMPLE_CART.total, SAMPLE_CART.currency_code)}</span>
                </div>
              </div>
            )}

            {c.show_sign_in_prompt !== false && (
              <div
                className="mx-3 mb-2 px-2 py-1.5 rounded text-[9px] text-center"
                style={{ backgroundColor: colors.accent || "#f3f4f6", color: colors.text || "#000" }}
              >
                Sign in to save your cart
              </div>
            )}

            <div className="px-3 pb-2 pt-1">
              <button
                className="w-full px-2 py-1.5 text-[10px]"
                style={{
                  borderRadius: btn.border_radius || "8px",
                  ...(btn.primary_style === "outline"
                    ? {
                        backgroundColor: "transparent",
                        border: `1.5px solid ${colors.primary || "#000"}`,
                        color: colors.primary || "#000",
                      }
                    : {
                        backgroundColor: colors.primary || "#000",
                        color: "#fff",
                        border: "1.5px solid transparent",
                      }),
                }}
              >
                {c.checkout_button_text || "Go to checkout"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

// --- Shared ---

function FieldInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div className="space-y-1">
      <Label size="xsmall">{label}</Label>
      <Input
        size="small"
        placeholder={placeholder || label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

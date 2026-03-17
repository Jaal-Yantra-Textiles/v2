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
  | null

export const SettingsTheme = () => {
  return (
    <RouteFocusModal prev="/content">
      <ThemeEditorInner />
    </RouteFocusModal>
  )
}

const ThemeEditorInner = () => {
  const { theme, isPending } = useWebsiteTheme()
  const { mutateAsync: updateTheme, isPending: isSaving } =
    useUpdateWebsiteTheme()
  const { data: storefrontStatus } = useStorefrontStatus()

  const [form, setForm] = useState<WebsiteTheme>({})
  const [activeSection, setActiveSection] = useState<ThemeSection>("hero")
  const [iframeReady, setIframeReady] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  const domain = storefrontStatus?.domain

  useEffect(() => {
    if (theme) setForm(theme)
  }, [theme])

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
        }
        setActiveSection(sectionMap[data.section] || null)
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

  const previewUrl = domain
    ? `https://${domain}/?theme_editor=true`
    : `http://localhost:8000/?theme_editor=true`

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
          <div className="px-3 py-3">
            <Text
              size="xsmall"
              className="text-ui-fg-muted uppercase font-semibold tracking-wide"
            >
              Sections
            </Text>
          </div>
          <div className="flex flex-col gap-y-0.5 px-2 pb-3">
            {(
              [
                ["branding", "Branding"],
                ["colors", "Colors"],
                ["hero", "Hero"],
                ["navigation", "Navigation"],
                ["footer", "Footer"],
              ["home_sections", "Home Layout"],
              ["product_page", "Product Page"],
              ["cart", "Cart"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setActiveSection(key)}
                className={`flex items-center px-3 py-2 rounded-md text-left text-sm transition-colors ${
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
      <SectionHeading title="Branding" desc="Store name, logo, and favicon" />
      <div className="space-y-3">
        <FieldInput
          label="Store Name"
          value={form.branding?.store_name || ""}
          onChange={(v) => updateForm("branding", { ...form.branding, store_name: v })}
        />
        <FieldInput
          label="Logo URL"
          value={form.branding?.logo_url || ""}
          onChange={(v) => updateForm("branding", { ...form.branding, logo_url: v })}
        />
        <FieldInput
          label="Favicon URL"
          value={form.branding?.favicon_url || ""}
          onChange={(v) => updateForm("branding", { ...form.branding, favicon_url: v })}
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
            ["background", "Background"],
            ["text", "Text"],
            ["accent", "Accent"],
          ] as const
        ).map(([key, label]) => (
          <div key={key} className="space-y-1">
            <Label size="xsmall">{label}</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                className="h-7 w-7 cursor-pointer rounded border border-ui-border-base"
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
        <FieldInput
          label="Background Image URL"
          value={form.hero?.background_image_url || ""}
          onChange={(v) =>
            updateForm("hero", { ...form.hero, background_image_url: v })
          }
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
  return (
    <>
      <SectionHeading title="Navigation" desc="Menu links" />
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label size="xsmall">Show Account Link</Label>
          <Switch
            checked={form.navigation?.show_account_link ?? true}
            onCheckedChange={(checked) => {
              const newForm = {
                ...form,
                navigation: { ...form.navigation, show_account_link: checked },
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
      <SectionHeading title="Footer" desc="Footer text and social links" />
      <div className="space-y-3">
        <FieldInput
          label="Footer Text"
          value={form.footer?.text || ""}
          onChange={(v) => updateForm("footer", { ...form.footer, text: v })}
        />
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

  return (
    <>
      <SectionHeading title="Product Page" desc="Customize product pages" />
      <div className="space-y-3">
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
        <FieldInput
          label="Related Heading"
          value={pp.related_heading || ""}
          onChange={(v) =>
            updateForm("product_page", { ...pp, related_heading: v })
          }
          placeholder="Related products"
        />
        <FieldInput
          label="Add to Cart Text"
          value={pp.cta_text || ""}
          onChange={(v) =>
            updateForm("product_page", { ...pp, cta_text: v })
          }
          placeholder="Add to cart"
        />

        <div className="pt-2 border-t border-ui-border-base" />

        <Text size="xsmall" className="text-ui-fg-muted font-semibold">
          Preview Fallbacks
        </Text>
        <FieldInput
          label="Sample Product Name"
          value={pp.sample_product_name || ""}
          onChange={(v) =>
            updateForm("product_page", { ...pp, sample_product_name: v })
          }
          placeholder="Sample Product"
        />
        <FieldInput
          label="Sample Price"
          value={pp.sample_product_price || ""}
          onChange={(v) =>
            updateForm("product_page", { ...pp, sample_product_price: v })
          }
          placeholder="$0.00"
        />
      </div>
    </>
  )
}

function CartPanel({ form, updateForm }: PanelProps) {
  const c = form.cart || {}

  return (
    <>
      <SectionHeading title="Cart" desc="Customize the cart page" />
      <div className="space-y-3">
        <FieldInput
          label="Heading"
          value={c.heading || ""}
          onChange={(v) => updateForm("cart", { ...c, heading: v })}
          placeholder="Cart"
        />
        <FieldInput
          label="Empty Cart Message"
          value={c.empty_message || ""}
          onChange={(v) => updateForm("cart", { ...c, empty_message: v })}
          placeholder="You don't have anything in your cart..."
        />
        <div className="grid grid-cols-2 gap-2">
          <FieldInput
            label="Empty CTA Text"
            value={c.empty_cta_text || ""}
            onChange={(v) => updateForm("cart", { ...c, empty_cta_text: v })}
            placeholder="Explore products"
          />
          <FieldInput
            label="Empty CTA Link"
            value={c.empty_cta_link || ""}
            onChange={(v) => updateForm("cart", { ...c, empty_cta_link: v })}
            placeholder="/store"
          />
        </div>
        <FieldInput
          label="Checkout Button Text"
          value={c.checkout_button_text || ""}
          onChange={(v) =>
            updateForm("cart", { ...c, checkout_button_text: v })
          }
          placeholder="Go to checkout"
        />
        <div className="flex items-center justify-between">
          <Label size="xsmall">Show Sign-in Prompt</Label>
          <Switch
            checked={c.show_sign_in_prompt !== false}
            onCheckedChange={(v) =>
              updateForm("cart", { ...c, show_sign_in_prompt: v })
            }
          />
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

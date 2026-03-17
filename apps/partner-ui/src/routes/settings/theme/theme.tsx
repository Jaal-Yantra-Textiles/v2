import {
  Button,
  Container,
  Heading,
  Input,
  Label,
  Switch,
  Text,
  toast,
} from "@medusajs/ui"
import { Plus, Trash } from "@medusajs/icons"
import { useEffect, useState } from "react"

import { SingleColumnPage } from "../../../components/layout/pages"
import {
  useWebsiteTheme,
  useUpdateWebsiteTheme,
  WebsiteTheme,
} from "../../../hooks/api/content"

const SOCIAL_PLATFORMS = [
  "Facebook",
  "Instagram",
  "Twitter",
  "LinkedIn",
  "YouTube",
  "TikTok",
  "Pinterest",
]

export const SettingsTheme = () => {
  const { theme, isPending } = useWebsiteTheme()
  const { mutateAsync: updateTheme, isPending: isSaving } =
    useUpdateWebsiteTheme()

  const [form, setForm] = useState<WebsiteTheme>({})

  useEffect(() => {
    if (theme) {
      setForm(theme)
    }
  }, [theme])

  const handleSave = async () => {
    try {
      await updateTheme(form)
      toast.success("Theme saved")
    } catch (e: any) {
      toast.error("Could not save theme", {
        description: e?.message || "Something went wrong",
      })
    }
  }

  if (isPending) {
    return (
      <SingleColumnPage widgets={{ before: [], after: [] }} hasOutlet={false}>
        <Container className="divide-y p-0">
          <div className="px-6 py-4">
            <Heading>Theme</Heading>
            <Text size="small" className="text-ui-fg-subtle mt-1">
              Loading...
            </Text>
          </div>
        </Container>
      </SingleColumnPage>
    )
  }

  return (
    <SingleColumnPage widgets={{ before: [], after: [] }} hasOutlet={false}>
      {/* Branding */}
      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading level="h2">Branding</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Store name, logo, and favicon
          </Text>
        </div>
        <div className="px-6 py-4 space-y-4">
          <div className="space-y-1.5">
            <Label size="small">Store Name</Label>
            <Input
              size="small"
              placeholder="My Store"
              value={form.branding?.store_name || ""}
              onChange={(e) =>
                setForm({
                  ...form,
                  branding: { ...form.branding, store_name: e.target.value },
                })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label size="small">Logo URL</Label>
            <Input
              size="small"
              placeholder="https://example.com/logo.png"
              value={form.branding?.logo_url || ""}
              onChange={(e) =>
                setForm({
                  ...form,
                  branding: { ...form.branding, logo_url: e.target.value },
                })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label size="small">Favicon URL</Label>
            <Input
              size="small"
              placeholder="https://example.com/favicon.ico"
              value={form.branding?.favicon_url || ""}
              onChange={(e) =>
                setForm({
                  ...form,
                  branding: { ...form.branding, favicon_url: e.target.value },
                })
              }
            />
          </div>
        </div>
      </Container>

      {/* Colors */}
      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading level="h2">Colors</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Customize your storefront colors
          </Text>
        </div>
        <div className="px-6 py-4 grid grid-cols-2 gap-4">
          {(
            [
              ["primary", "Primary"],
              ["background", "Background"],
              ["text", "Text"],
              ["accent", "Accent"],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="space-y-1.5">
              <Label size="small">{label}</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  className="h-8 w-8 cursor-pointer rounded border border-ui-border-base"
                  value={form.colors?.[key] || "#000000"}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      colors: { ...form.colors, [key]: e.target.value },
                    })
                  }
                />
                <Input
                  size="small"
                  placeholder="#000000"
                  value={form.colors?.[key] || ""}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      colors: { ...form.colors, [key]: e.target.value },
                    })
                  }
                />
              </div>
            </div>
          ))}
        </div>
      </Container>

      {/* Hero */}
      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading level="h2">Hero</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Customize the homepage hero section
          </Text>
        </div>
        <div className="px-6 py-4 space-y-4">
          <div className="space-y-1.5">
            <Label size="small">Title</Label>
            <Input
              size="small"
              placeholder="Welcome to our store"
              value={form.hero?.title || ""}
              onChange={(e) =>
                setForm({
                  ...form,
                  hero: { ...form.hero, title: e.target.value },
                })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label size="small">Subtitle</Label>
            <Input
              size="small"
              placeholder="Discover amazing products"
              value={form.hero?.subtitle || ""}
              onChange={(e) =>
                setForm({
                  ...form,
                  hero: { ...form.hero, subtitle: e.target.value },
                })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label size="small">Background Image URL</Label>
            <Input
              size="small"
              placeholder="https://example.com/hero.jpg"
              value={form.hero?.background_image_url || ""}
              onChange={(e) =>
                setForm({
                  ...form,
                  hero: {
                    ...form.hero,
                    background_image_url: e.target.value,
                  },
                })
              }
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label size="small">CTA Text</Label>
              <Input
                size="small"
                placeholder="Shop Now"
                value={form.hero?.cta_text || ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    hero: { ...form.hero, cta_text: e.target.value },
                  })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label size="small">CTA Link</Label>
              <Input
                size="small"
                placeholder="/store"
                value={form.hero?.cta_link || ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    hero: { ...form.hero, cta_link: e.target.value },
                  })
                }
              />
            </div>
          </div>
        </div>
      </Container>

      {/* Navigation */}
      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading level="h2">Navigation</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Menu links and account link visibility
          </Text>
        </div>
        <div className="px-6 py-4 space-y-4">
          <div className="flex items-center justify-between">
            <Label size="small">Show Account Link</Label>
            <Switch
              checked={form.navigation?.show_account_link ?? true}
              onCheckedChange={(checked) =>
                setForm({
                  ...form,
                  navigation: {
                    ...form.navigation,
                    show_account_link: checked,
                  },
                })
              }
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label size="small">Menu Links</Label>
              <Button
                variant="secondary"
                size="small"
                onClick={() =>
                  setForm({
                    ...form,
                    navigation: {
                      ...form.navigation,
                      links: [
                        ...(form.navigation?.links || []),
                        { label: "", href: "" },
                      ],
                    },
                  })
                }
              >
                <Plus className="mr-1" />
                Add Link
              </Button>
            </div>
            {(form.navigation?.links || []).map((link, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  size="small"
                  placeholder="Label"
                  value={link.label}
                  onChange={(e) => {
                    const links = [...(form.navigation?.links || [])]
                    links[i] = { ...links[i], label: e.target.value }
                    setForm({
                      ...form,
                      navigation: { ...form.navigation, links },
                    })
                  }}
                />
                <Input
                  size="small"
                  placeholder="/path"
                  value={link.href}
                  onChange={(e) => {
                    const links = [...(form.navigation?.links || [])]
                    links[i] = { ...links[i], href: e.target.value }
                    setForm({
                      ...form,
                      navigation: { ...form.navigation, links },
                    })
                  }}
                />
                <Button
                  variant="transparent"
                  size="small"
                  onClick={() => {
                    const links = (form.navigation?.links || []).filter(
                      (_, idx) => idx !== i
                    )
                    setForm({
                      ...form,
                      navigation: { ...form.navigation, links },
                    })
                  }}
                >
                  <Trash />
                </Button>
              </div>
            ))}
          </div>
        </div>
      </Container>

      {/* Footer */}
      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading level="h2">Footer</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Footer text and social media links
          </Text>
        </div>
        <div className="px-6 py-4 space-y-4">
          <div className="space-y-1.5">
            <Label size="small">Footer Text</Label>
            <Input
              size="small"
              placeholder="All rights reserved."
              value={form.footer?.text || ""}
              onChange={(e) =>
                setForm({
                  ...form,
                  footer: { ...form.footer, text: e.target.value },
                })
              }
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label size="small">Social Links</Label>
              <Button
                variant="secondary"
                size="small"
                onClick={() =>
                  setForm({
                    ...form,
                    footer: {
                      ...form.footer,
                      social_links: [
                        ...(form.footer?.social_links || []),
                        { platform: "Facebook", url: "" },
                      ],
                    },
                  })
                }
              >
                <Plus className="mr-1" />
                Add Social Link
              </Button>
            </div>
            {(form.footer?.social_links || []).map((sl, i) => (
              <div key={i} className="flex items-center gap-2">
                <select
                  className="h-8 rounded-md border border-ui-border-base bg-ui-bg-field px-2 text-sm"
                  value={sl.platform}
                  onChange={(e) => {
                    const social_links = [
                      ...(form.footer?.social_links || []),
                    ]
                    social_links[i] = {
                      ...social_links[i],
                      platform: e.target.value,
                    }
                    setForm({
                      ...form,
                      footer: { ...form.footer, social_links },
                    })
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
                    const social_links = [
                      ...(form.footer?.social_links || []),
                    ]
                    social_links[i] = {
                      ...social_links[i],
                      url: e.target.value,
                    }
                    setForm({
                      ...form,
                      footer: { ...form.footer, social_links },
                    })
                  }}
                />
                <Button
                  variant="transparent"
                  size="small"
                  onClick={() => {
                    const social_links = (
                      form.footer?.social_links || []
                    ).filter((_, idx) => idx !== i)
                    setForm({
                      ...form,
                      footer: { ...form.footer, social_links },
                    })
                  }}
                >
                  <Trash />
                </Button>
              </div>
            ))}
          </div>
        </div>
      </Container>

      {/* Save */}
      <div className="flex justify-end">
        <Button onClick={handleSave} isLoading={isSaving}>
          Save Theme
        </Button>
      </div>
    </SingleColumnPage>
  )
}

import { useState, useEffect, useCallback } from "react"
import { Button, Heading, Text, Badge, toast, Input, Select } from "@medusajs/ui"
import { ArrowPath, Plus, Trash } from "@medusajs/icons"
import { sdk } from "../../lib/config"

interface WhatsAppTemplate {
  id: string
  name: string
  status: string
  category: string
  language: string
  components?: any[]
  quality_score?: any
}

interface WhatsAppConfig {
  configured: boolean
  waba_id: string | null
  phone_number_id: string | null
  phone_info: any
  waba_info: any
  template_count: number
  initiation_template: string | null
  initiation_template_lang: string | null
}

const STATUS_COLORS: Record<string, "green" | "orange" | "red" | "grey"> = {
  APPROVED: "green",
  PENDING: "orange",
  REJECTED: "red",
  DISABLED: "grey",
  PAUSED: "grey",
}

const CATEGORY_COLORS: Record<string, "blue" | "purple" | "orange"> = {
  UTILITY: "blue",
  MARKETING: "purple",
  AUTHENTICATION: "orange",
}

export const WhatsAppTemplatesSection = () => {
  const [config, setConfig] = useState<WhatsAppConfig | null>(null)
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [wabaIdInput, setWabaIdInput] = useState("")
  const [savingConfig, setSavingConfig] = useState(false)

  // Create template form
  const [newName, setNewName] = useState("")
  const [newCategory, setNewCategory] = useState<string>("UTILITY")
  const [newLanguage, setNewLanguage] = useState("en")
  const [newBody, setNewBody] = useState("")
  const [newFooter, setNewFooter] = useState("")
  const [creating, setCreating] = useState(false)

  const loadConfig = useCallback(async () => {
    try {
      const resp: any = await sdk.client.fetch("/admin/social-platforms/whatsapp/config", { method: "GET" })
      setConfig(resp)
      setWabaIdInput(resp.waba_id || "")
    } catch (e: any) {
      console.error("Failed to load WhatsApp config:", e.message)
    }
  }, [])

  const loadTemplates = useCallback(async () => {
    setLoading(true)
    try {
      const resp: any = await sdk.client.fetch("/admin/social-platforms/whatsapp/templates", { method: "GET" })
      setTemplates(resp.templates || [])
    } catch (e: any) {
      // May fail if WABA not configured
      setTemplates([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadConfig()
    loadTemplates()
  }, [])

  const handleSync = async () => {
    setSyncing(true)
    try {
      const resp: any = await sdk.client.fetch("/admin/social-platforms/whatsapp/templates/sync", { method: "POST" })
      toast.success(`Synced ${resp.synced} templates from Meta`)
      setTemplates(resp.templates || [])
      loadConfig()
    } catch (e: any) {
      toast.error(e.message || "Failed to sync templates")
    } finally {
      setSyncing(false)
    }
  }

  const handleSaveWabaId = async () => {
    if (!wabaIdInput.trim()) return
    setSavingConfig(true)
    try {
      await sdk.client.fetch("/admin/social-platforms/whatsapp/config", {
        method: "POST",
        body: { waba_id: wabaIdInput.trim() },
      })
      toast.success("WABA ID saved")
      loadConfig()
    } catch (e: any) {
      toast.error(e.message || "Failed to save")
    } finally {
      setSavingConfig(false)
    }
  }

  const handleSetDefault = async (templateName: string, lang: string) => {
    try {
      await sdk.client.fetch("/admin/social-platforms/whatsapp/config", {
        method: "POST",
        body: { initiation_template: templateName, initiation_template_lang: lang },
      })
      toast.success(`Default template set to "${templateName}"`)
      loadConfig()
    } catch (e: any) {
      toast.error(e.message || "Failed to set default")
    }
  }

  const handleDelete = async (name: string) => {
    if (!confirm(`Delete template "${name}"? This cannot be undone.`)) return
    try {
      await sdk.client.fetch(`/admin/social-platforms/whatsapp/templates/delete?name=${name}`, { method: "DELETE" })
      toast.success(`Template "${name}" deleted`)
      loadTemplates()
    } catch (e: any) {
      toast.error(e.message || "Failed to delete")
    }
  }

  const handleCreate = async () => {
    if (!newName || !newBody) {
      toast.error("Name and body are required")
      return
    }

    setCreating(true)
    try {
      // Extract variable examples from body text ({{1}}, {{2}}, etc.)
      const varMatches = newBody.match(/\{\{\d+\}\}/g) || []
      const exampleValues = varMatches.map((_, i) => `Example ${i + 1}`)

      const components: any[] = [
        {
          type: "BODY",
          text: newBody,
          ...(varMatches.length > 0 ? { example: { body_text: [exampleValues] } } : {}),
        },
      ]

      if (newFooter.trim()) {
        components.push({ type: "FOOTER", text: newFooter.trim() })
      }

      const resp: any = await sdk.client.fetch("/admin/social-platforms/whatsapp/templates", {
        method: "POST",
        body: {
          name: newName.toLowerCase().replace(/[^a-z0-9_]/g, "_"),
          category: newCategory,
          language: newLanguage,
          components,
        },
      })

      toast.success(`Template "${resp.template.name}" created (${resp.template.status})`)
      setShowCreate(false)
      setNewName("")
      setNewBody("")
      setNewFooter("")
      loadTemplates()
    } catch (e: any) {
      toast.error(e.message || "Failed to create template")
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* WABA Configuration */}
      <div className="rounded-lg border border-ui-border-base p-4">
        <Heading level="h3" className="mb-2">WhatsApp Business Account</Heading>
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <Text size="xsmall" className="mb-1 text-ui-fg-muted font-medium">WABA ID</Text>
            <Input
              size="small"
              value={wabaIdInput}
              onChange={(e) => setWabaIdInput(e.target.value)}
              placeholder="e.g. 1331897429001126"
            />
          </div>
          <Button
            size="small"
            variant="secondary"
            onClick={handleSaveWabaId}
            isLoading={savingConfig}
            disabled={!wabaIdInput.trim() || wabaIdInput === config?.waba_id}
          >
            Save
          </Button>
        </div>
        {config?.waba_info && (
          <div className="mt-2 flex items-center gap-3">
            <Text size="xsmall" className="text-ui-fg-muted">
              Account: <span className="text-ui-fg-base font-medium">{config.waba_info.name}</span>
            </Text>
            {config.phone_info && (
              <Text size="xsmall" className="text-ui-fg-muted">
                Phone: <span className="text-ui-fg-base font-medium">{config.phone_info.display_phone_number}</span>
                {" "}({config.phone_info.verified_name})
              </Text>
            )}
            {config.phone_info?.quality_rating && (
              <Badge color={config.phone_info.quality_rating === "GREEN" ? "green" : "orange"} size="2xsmall">
                Quality: {config.phone_info.quality_rating}
              </Badge>
            )}
          </div>
        )}
      </div>

      {/* Templates */}
      <div className="rounded-lg border border-ui-border-base">
        <div className="flex items-center justify-between px-4 py-3 border-b border-ui-border-base">
          <div>
            <Heading level="h3">Message Templates</Heading>
            <Text size="xsmall" className="text-ui-fg-muted">
              {templates.length} template{templates.length !== 1 ? "s" : ""}
              {config?.initiation_template && ` · Default: ${config.initiation_template}`}
            </Text>
          </div>
          <div className="flex items-center gap-2">
            <Button size="small" variant="secondary" onClick={handleSync} isLoading={syncing}>
              <ArrowPath className="mr-1" />
              Sync
            </Button>
            <Button size="small" variant="secondary" onClick={() => setShowCreate(!showCreate)}>
              <Plus className="mr-1" />
              Create
            </Button>
          </div>
        </div>

        {/* Create form */}
        {showCreate && (
          <div className="px-4 py-3 border-b border-ui-border-base bg-ui-bg-subtle space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Text size="xsmall" className="mb-1 text-ui-fg-muted font-medium">Name</Text>
                <Input
                  size="small"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. order_update"
                />
              </div>
              <div>
                <Text size="xsmall" className="mb-1 text-ui-fg-muted font-medium">Category</Text>
                <Select value={newCategory} onValueChange={setNewCategory}>
                  <Select.Trigger><Select.Value /></Select.Trigger>
                  <Select.Content>
                    <Select.Item value="UTILITY">Utility</Select.Item>
                    <Select.Item value="MARKETING">Marketing</Select.Item>
                    <Select.Item value="AUTHENTICATION">Authentication</Select.Item>
                  </Select.Content>
                </Select>
              </div>
              <div>
                <Text size="xsmall" className="mb-1 text-ui-fg-muted font-medium">Language</Text>
                <Select value={newLanguage} onValueChange={setNewLanguage}>
                  <Select.Trigger><Select.Value /></Select.Trigger>
                  <Select.Content>
                    <Select.Item value="en">English</Select.Item>
                    <Select.Item value="en_US">English (US)</Select.Item>
                    <Select.Item value="hi">Hindi</Select.Item>
                    <Select.Item value="es">Spanish</Select.Item>
                    <Select.Item value="fr">French</Select.Item>
                  </Select.Content>
                </Select>
              </div>
            </div>
            <div>
              <Text size="xsmall" className="mb-1 text-ui-fg-muted font-medium">
                Body <span className="text-ui-fg-disabled">(use {"{{1}}"}, {"{{2}}"} for variables)</span>
              </Text>
              <textarea
                value={newBody}
                onChange={(e) => setNewBody(e.target.value)}
                placeholder="Hello {{1}}! Your order {{2}} is ready for pickup."
                rows={3}
                className="w-full rounded-lg border border-ui-border-base bg-ui-bg-field px-3 py-2 text-sm"
              />
            </div>
            <div>
              <Text size="xsmall" className="mb-1 text-ui-fg-muted font-medium">Footer (optional)</Text>
              <Input
                size="small"
                value={newFooter}
                onChange={(e) => setNewFooter(e.target.value)}
                placeholder="e.g. JYT Commerce"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button size="small" variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button size="small" variant="primary" onClick={handleCreate} isLoading={creating}>Create Template</Button>
            </div>
          </div>
        )}

        {/* Template list */}
        {loading ? (
          <div className="px-4 py-8 text-center text-ui-fg-muted text-sm">Loading templates...</div>
        ) : templates.length === 0 ? (
          <div className="px-4 py-8 text-center text-ui-fg-muted text-sm">
            {config?.waba_id ? "No templates found. Click Sync to fetch from Meta." : "Set WABA ID above to manage templates."}
          </div>
        ) : (
          <div className="divide-y divide-ui-border-base">
            {templates.map((t) => {
              const isDefault = config?.initiation_template === t.name
              const bodyComponent = t.components?.find((c: any) => c.type === "BODY")
              const footerComponent = t.components?.find((c: any) => c.type === "FOOTER")

              return (
                <div key={t.id} className="px-4 py-3 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <Text className="font-medium">{t.name}</Text>
                      <Badge color={STATUS_COLORS[t.status] || "grey"} size="2xsmall">{t.status}</Badge>
                      <Badge color={CATEGORY_COLORS[t.category] || "grey"} size="2xsmall">{t.category}</Badge>
                      <Badge size="2xsmall">{t.language}</Badge>
                      {isDefault && <Badge color="green" size="2xsmall">Default</Badge>}
                    </div>
                    {bodyComponent?.text && (
                      <Text size="small" className="text-ui-fg-muted line-clamp-2">{bodyComponent.text}</Text>
                    )}
                    {footerComponent?.text && (
                      <Text size="xsmall" className="text-ui-fg-disabled mt-0.5">{footerComponent.text}</Text>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {t.status === "APPROVED" && !isDefault && (
                      <Button
                        size="small"
                        variant="secondary"
                        onClick={() => handleSetDefault(t.name, t.language)}
                      >
                        Set Default
                      </Button>
                    )}
                    <Button
                      size="small"
                      variant="transparent"
                      onClick={() => handleDelete(t.name)}
                      className="text-ui-fg-muted hover:text-red-500"
                    >
                      <Trash />
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

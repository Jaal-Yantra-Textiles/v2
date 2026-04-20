import {
  Drawer,
  Button,
  Input,
  Label,
  Select,
  Text,
  Textarea,
  toast,
  Heading,
} from "@medusajs/ui"
import { useState, useEffect, useMemo } from "react"
import {
  StatsPanel,
  StatsPanelType,
  useCreatePanel,
  useUpdatePanel,
  useStatsOperations,
  usePreviewPanel,
} from "../../hooks/api/stats"
import { PanelRenderer } from "./panel-renderer"

const PANEL_TYPES: StatsPanelType[] = [
  "metric",
  "list",
  "table",
  "bar",
  "line",
  "area",
  "label",
]

type PanelEditorProps = {
  dashboardId: string
  panel?: StatsPanel
  open: boolean
  onOpenChange: (open: boolean) => void
}

function safeParseJSON(text: string): { value?: any; error?: string } {
  const trimmed = text.trim()
  if (!trimmed) return { value: {} }
  try {
    return { value: JSON.parse(trimmed) }
  } catch (e: any) {
    return { error: e.message }
  }
}

export function PanelEditorDrawer({ dashboardId, panel, open, onOpenChange }: PanelEditorProps) {
  const isEdit = !!panel
  const { data: opsData } = useStatsOperations()
  const createPanel = useCreatePanel(dashboardId)
  const updatePanel = useUpdatePanel(dashboardId, panel?.id ?? "")
  const preview = usePreviewPanel()

  const [name, setName] = useState("")
  const [type, setType] = useState<StatsPanelType>("metric")
  const [operationType, setOperationType] = useState("aggregate_data")
  const [optionsText, setOptionsText] = useState("{}")
  const [displayText, setDisplayText] = useState("{}")
  const [cacheTtl, setCacheTtl] = useState<string>("")
  const [width, setWidth] = useState(4)
  const [height, setHeight] = useState(3)
  const [previewResult, setPreviewResult] = useState<any>(undefined)

  useEffect(() => {
    if (open) {
      setName(panel?.name ?? "")
      setType((panel?.type as StatsPanelType) ?? "metric")
      setOperationType(panel?.operation_type ?? "aggregate_data")
      setOptionsText(JSON.stringify(panel?.operation_options ?? {}, null, 2))
      setDisplayText(JSON.stringify(panel?.display ?? {}, null, 2))
      setCacheTtl(panel?.cache_ttl_seconds?.toString() ?? "")
      setWidth(panel?.width ?? 4)
      setHeight(panel?.height ?? 3)
      setPreviewResult(undefined)
    }
  }, [open, panel])

  const options = useMemo(() => safeParseJSON(optionsText), [optionsText])
  const display = useMemo(() => safeParseJSON(displayText), [displayText])
  const formValid = !!name && !options.error && !display.error

  const selectedOp = opsData?.operations.find((o) => o.type === operationType)

  const handleOperationChange = (value: string) => {
    setOperationType(value)
    const op = opsData?.operations.find((o) => o.type === value)
    if (op && optionsText === "{}") {
      setOptionsText(JSON.stringify(op.defaultOptions ?? {}, null, 2))
    }
  }

  const handlePreview = async () => {
    if (options.error) {
      toast.error(`Invalid options JSON: ${options.error}`)
      return
    }
    try {
      const result = await preview.mutateAsync({
        operation_type: operationType,
        operation_options: options.value,
        display: display.value,
      })
      setPreviewResult(result)
      if (result.error) {
        toast.error(`Preview: ${result.error}`)
      } else {
        toast.success("Preview OK")
      }
    } catch (e: any) {
      toast.error(`Preview failed: ${e.message}`)
    }
  }

  const handleSave = async () => {
    if (!formValid) {
      toast.error("Fix form errors before saving")
      return
    }
    const payload = {
      name,
      type,
      operation_type: operationType,
      operation_options: options.value,
      display: display.value,
      cache_ttl_seconds: cacheTtl ? parseInt(cacheTtl, 10) : null,
      width,
      height,
    }
    try {
      if (isEdit) {
        await updatePanel.mutateAsync(payload as any)
        toast.success("Panel updated")
      } else {
        await createPanel.mutateAsync(payload as any)
        toast.success("Panel created")
      }
      onOpenChange(false)
    } catch (e: any) {
      toast.error(`Save failed: ${e.message}`)
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <Drawer.Content className="flex flex-col !max-w-[720px]">
        <Drawer.Header>
          <Drawer.Title>{isEdit ? "Edit Panel" : "New Panel"}</Drawer.Title>
        </Drawer.Header>
        <Drawer.Body className="overflow-y-auto flex-1 space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label size="small">Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Total Partners" />
            </div>
            <div>
              <Label size="small">Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as StatsPanelType)}>
                <Select.Trigger>
                  <Select.Value />
                </Select.Trigger>
                <Select.Content>
                  {PANEL_TYPES.map((t) => (
                    <Select.Item key={t} value={t}>
                      {t}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label size="small">Width (1-12)</Label>
              <Input
                type="number"
                min={1}
                max={12}
                value={width}
                onChange={(e) => setWidth(parseInt(e.target.value, 10) || 1)}
              />
            </div>
            <div>
              <Label size="small">Height (1-12)</Label>
              <Input
                type="number"
                min={1}
                max={12}
                value={height}
                onChange={(e) => setHeight(parseInt(e.target.value, 10) || 1)}
              />
            </div>
            <div>
              <Label size="small">Cache TTL (seconds)</Label>
              <Input
                type="number"
                min={0}
                value={cacheTtl}
                placeholder="no cache"
                onChange={(e) => setCacheTtl(e.target.value)}
              />
            </div>
          </div>

          <div>
            <Label size="small">Data source (operation)</Label>
            <Select value={operationType} onValueChange={handleOperationChange}>
              <Select.Trigger>
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                {(opsData?.operations ?? []).map((op) => (
                  <Select.Item key={op.type} value={op.type}>
                    {op.name} ({op.type})
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
            {selectedOp && (
              <Text size="xsmall" className="text-ui-fg-muted mt-1">
                {selectedOp.description}
              </Text>
            )}
          </div>

          <div>
            <div className="flex justify-between items-center">
              <Label size="small">operation_options (JSON)</Label>
              {options.error && (
                <Text size="xsmall" className="text-ui-fg-error">
                  {options.error}
                </Text>
              )}
            </div>
            <Textarea
              rows={10}
              className="font-mono text-xs"
              value={optionsText}
              onChange={(e) => setOptionsText(e.target.value)}
            />
            <Text size="xsmall" className="text-ui-fg-muted mt-1">
              Validated against the operation's schema server-side.
            </Text>
          </div>

          <div>
            <div className="flex justify-between items-center">
              <Label size="small">display (JSON)</Label>
              {display.error && (
                <Text size="xsmall" className="text-ui-fg-error">
                  {display.error}
                </Text>
              )}
            </div>
            <Textarea
              rows={5}
              className="font-mono text-xs"
              value={displayText}
              onChange={(e) => setDisplayText(e.target.value)}
            />
            <Text size="xsmall" className="text-ui-fg-muted mt-1">
              Controls how the result renders. E.g. {`{ "label": "Active partners", "prefix": "$" }`}
            </Text>
          </div>

          {previewResult && (
            <div className="border rounded-lg overflow-hidden bg-ui-bg-subtle">
              <Heading level="h3" className="px-4 py-2 border-b text-sm">
                Preview
              </Heading>
              <PanelRenderer
                panel={{ name, type, display: display.value ?? {} } as any}
                result={previewResult}
              />
            </div>
          )}
        </Drawer.Body>
        <Drawer.Footer>
          <div className="flex justify-between w-full gap-2">
            <Button variant="secondary" onClick={handlePreview} isLoading={preview.isPending}>
              Preview
            </Button>
            <div className="flex gap-2">
              <Drawer.Close asChild>
                <Button variant="secondary">Cancel</Button>
              </Drawer.Close>
              <Button
                onClick={handleSave}
                disabled={!formValid}
                isLoading={createPanel.isPending || updatePanel.isPending}
              >
                {isEdit ? "Update" : "Create"}
              </Button>
            </div>
          </div>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}

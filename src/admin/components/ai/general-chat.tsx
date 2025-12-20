import React from "react"
import { Button, Heading, Input, Text, Textarea, Select } from "@medusajs/ui"
import { Spinner } from "@medusajs/icons"
import { RouteFocusModal } from "../modal/route-focus-modal"
import { StackedFocusModal } from "../modal/stacked-modal/stacked-focused-modal"
import {
  useChatThread,
  useChatThreads,
  useCreateChatThread,
  useGeneralChat,
  useGeneralChatStream,
} from "../../hooks/api/ai"
import { useAdminApiExecutor, useRemoteAdminApiCatalog, AdminEndpoint } from "../../hooks/api/admin-catalog"
import { sdk } from "../../lib/config"
import { SuspendedWorkflowSelector } from "./chat/suspended-workflow-selector"
import { InlineTip } from "../common/inline-tip"
import { DataTableRoot } from "../table/data-table-root"
import { ColumnDef, getCoreRowModel, useReactTable } from "@tanstack/react-table"

export type ChatMessage = {
  role: "user" | "assistant"
  content: string
  kind?: "text" | "planned" | "executed" | "summary"
  data?: any
}

export type GeneralChatProps = {
  entity?: string
  entityId?: string
}

const bubbleClass = (role: ChatMessage["role"]) =>
  role === "user"
    ? "ml-auto bg-ui-bg-base border border-ui-border-base"
    : "mr-auto bg-ui-bg-subtle"

const escapeHtml = (input: string) =>
  String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;")

const renderInlineMarkdown = (escaped: string) => {
  // escaped is already HTML-escaped; safe to inject tags below
  let s = escaped
  // inline code
  s = s.replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 rounded bg-ui-bg-base text-xs">$1</code>')
  // bold
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold">$1</strong>')
  // italic (avoid matching bold)
  s = s.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em class="italic">$2</em>')
  // links
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a class="underline" href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
  return s
}

const renderMarkdownToHtml = (md: string) => {
  const src = String(md || "")
  const lines = src.split(/\r?\n/)

  let out = ""
  let inCode = false
  let codeBuffer: string[] = []
  let listType: "ul" | "ol" | null = null

  const closeList = () => {
    if (!listType) return
    out += listType === "ul" ? "</ul>" : "</ol>"
    listType = null
  }

  const flushCode = () => {
    const code = escapeHtml(codeBuffer.join("\n"))
    out += `<pre class="mt-2 mb-2 overflow-auto rounded bg-ui-bg-base p-2 text-xs"><code>${code}</code></pre>`
    codeBuffer = []
  }

  for (const rawLine of lines) {
    const line = String(rawLine)

    // Code fences
    if (line.trim().startsWith("```")) {
      if (!inCode) {
        closeList()
        inCode = true
      } else {
        inCode = false
        flushCode()
      }
      continue
    }

    if (inCode) {
      codeBuffer.push(line)
      continue
    }

    // Horizontal rule
    if (/^\s*---\s*$/.test(line)) {
      closeList()
      out += '<hr class="my-3 border-ui-border-base" />'
      continue
    }

    // Headings
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      closeList()
      const level = Math.min(6, h[1].length)
      const text = renderInlineMarkdown(escapeHtml(h[2] || ""))
      const cls =
        level === 1
          ? "text-lg font-semibold mt-2"
          : level === 2
            ? "text-base font-semibold mt-2"
            : "text-sm font-semibold mt-2"
      out += `<h${level} class="${cls}">${text}</h${level}>`
      continue
    }

    // Unordered list
    const ul = line.match(/^\s*[-*]\s+(.*)$/)
    if (ul) {
      const item = renderInlineMarkdown(escapeHtml(ul[1] || ""))
      if (listType !== "ul") {
        closeList()
        listType = "ul"
        out += '<ul class="mt-2 mb-2 list-disc pl-5 space-y-1">'
      }
      out += `<li>${item}</li>`
      continue
    }

    // Ordered list
    const ol = line.match(/^\s*(\d+)\.\s+(.*)$/)
    if (ol) {
      const item = renderInlineMarkdown(escapeHtml(ol[2] || ""))
      if (listType !== "ol") {
        closeList()
        listType = "ol"
        out += '<ol class="mt-2 mb-2 list-decimal pl-5 space-y-1">'
      }
      out += `<li>${item}</li>`
      continue
    }

    // Blank line => break paragraph/list
    if (!line.trim()) {
      closeList()
      out += '<div class="h-2"></div>'
      continue
    }

    closeList()
    out += `<p class="text-sm leading-6">${renderInlineMarkdown(escapeHtml(line))}</p>`
  }

  if (inCode && codeBuffer.length) {
    inCode = false
    flushCode()
  }
  closeList()

  return out
}

const MarkdownMessage: React.FC<{ value: string }> = ({ value }) => {
  const html = React.useMemo(() => renderMarkdownToHtml(value), [value])
  return <div className="break-words" dangerouslySetInnerHTML={{ __html: html }} />
}

const AdminApiModal: React.FC<{
  catalog: AdminEndpoint[]
  catalogSource: string
  apiSearch: string
  setApiSearch: (v: string) => void
  selectedEndpointId: string
  setSelectedEndpointId: (v: string) => void
  selected?: AdminEndpoint
  pathParamsJson: string
  setPathParamsJson: (v: string) => void
  queryJson: string
  setQueryJson: (v: string) => void
  bodyJson: string
  setBodyJson: (v: string) => void
  showJson: boolean
  setShowJson: (v: boolean) => void
  onRun: () => Promise<void>
  isRunning: boolean
}> = ({
  catalog,
  catalogSource,
  apiSearch,
  setApiSearch,
  selectedEndpointId,
  setSelectedEndpointId,
  selected,
  pathParamsJson,
  setPathParamsJson,
  queryJson,
  setQueryJson,
  bodyJson,
  setBodyJson,
  showJson,
  setShowJson,
  onRun,
  isRunning,
}) => {
    return (
      <StackedFocusModal id="admin-api-modal">
        <StackedFocusModal.Trigger asChild>
          <Button size="small" variant="secondary" type="button">APIs</Button>
        </StackedFocusModal.Trigger>
        <StackedFocusModal.Content className="flex flex-col">
          <StackedFocusModal.Header>
            <StackedFocusModal.Title>Admin API Catalog ({catalogSource})</StackedFocusModal.Title>
          </StackedFocusModal.Header>
          <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[70vh] overflow-y-auto">
            <div>
              <div className="mb-2 flex items-center gap-2">
                <div className="w-64">
                  <Input placeholder="Search endpoints" value={apiSearch} onChange={(e) => setApiSearch(e.target.value)} />
                </div>
              </div>
              <div className="mb-2">
                <Select value={selectedEndpointId} onValueChange={setSelectedEndpointId}>
                  <Select.Trigger>
                    <Select.Value placeholder="Select an endpoint…" />
                  </Select.Trigger>
                  <Select.Content>
                    {catalog.map((ep) => (
                      <Select.Item key={ep.id} value={ep.id}>
                        {ep.method} {ep.path} · {ep.summary}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select>
              </div>
              {selected && (
                <div className="text-xs text-ui-fg-subtle space-y-1">
                  <div><b>Method:</b> {selected.method}</div>
                  <div><b>Path:</b> {selected.path}</div>
                  <div><b>Tags:</b> {(selected.tags || []).join(", ")}</div>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <div>
                <Text className="text-ui-fg-subtle text-small">Path Params</Text>
                <Textarea rows={4} value={pathParamsJson} onChange={(e) => setPathParamsJson(e.target.value)} />
              </div>
              <div>
                <Text className="text-ui-fg-subtle text-small">Query</Text>
                <Textarea rows={4} value={queryJson} onChange={(e) => setQueryJson(e.target.value)} />
              </div>
              <div>
                <Text className="text-ui-fg-subtle text-small">Body</Text>
                <Textarea rows={6} value={bodyJson} onChange={(e) => setBodyJson(e.target.value)} />
              </div>
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-ui-fg-subtle text-small">
                  <input type="checkbox" checked={showJson} onChange={(e) => setShowJson(e.target.checked)} />
                  See JSON
                </label>
                <Button
                  size="small"
                  type="button"
                  disabled={!selected || isRunning}
                  isLoading={isRunning}
                  onClick={onRun}
                >
                  Run API
                </Button>
              </div>
            </div>
          </div>
          <StackedFocusModal.Footer>
            <div className="flex w-full items-center justify-end gap-x-2">
              <StackedFocusModal.Close asChild>
                <Button variant="secondary">Close</Button>
              </StackedFocusModal.Close>
            </div>
          </StackedFocusModal.Footer>
        </StackedFocusModal.Content>
      </StackedFocusModal>
    )
  }

// Use Medusa UI Spinner as typing indicator during streaming

export const GeneralChat: React.FC<GeneralChatProps> = ({ entity, entityId }) => {
  const [messages, setMessages] = React.useState<ChatMessage[]>([])
  const [input, setInput] = React.useState("")
  const [isResuming, setIsResuming] = React.useState<boolean>(false)
  const [resumeStep, setResumeStep] = React.useState<string | undefined>(undefined)

  // HITL: Suspended workflow state
  const [suspendedWorkflow, setSuspendedWorkflow] = React.useState<{
    runId: string
    reason: string
    options: Array<{ id: string; display: string }>
    actions?: Array<{ id: string; label: string }>
    totalCount?: number
  } | null>(null)

  const createLocalId = React.useCallback(() => {
    return typeof crypto !== "undefined" && (crypto as any).randomUUID
      ? (crypto as any).randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  }, [])

  const [activeResourceId, setActiveResourceId] = React.useState<string>(
    entity ? `ai:general-chat:${entity}` : "ai:general-chat"
  )
  const [activeThreadId, setActiveThreadId] = React.useState<string | null>(null)
  const [threadPickerResource, setThreadPickerResource] = React.useState<string>(
    entity ? `ai:general-chat:${entity}` : "ai:general-chat"
  )
  const [availableThreads, setAvailableThreads] = React.useState<any[]>([])
  const [selectedThreadId, setSelectedThreadId] = React.useState<string>("")

  const [useStreaming, setUseStreaming] = React.useState<boolean>(true)
  const [autoRunTools, setAutoRunTools] = React.useState<boolean>(false)
  const [debugLogs, setDebugLogs] = React.useState<boolean>(false)
  const [apiSearch, setApiSearch] = React.useState<string>("")
  const [catalog, setCatalog] = React.useState<AdminEndpoint[]>([])
  const [selectedEndpointId, setSelectedEndpointId] = React.useState<string>("")
  const [pathParamsJson, setPathParamsJson] = React.useState<string>("{}")
  const [queryJson, setQueryJson] = React.useState<string>("{}")
  const [bodyJson, setBodyJson] = React.useState<string>("{}")
  const [catalogSource, setCatalogSource] = React.useState<string>("static")
  const executedPlannedRef = React.useRef<Set<string>>(new Set())
  const executedRequestsRef = React.useRef<Set<string>>(new Set())
  const inFlightRequestsRef = React.useRef<Set<string>>(new Set())

  // Planned actions for non-streaming responses
  const [manualPlanned, setManualPlanned] = React.useState<any[]>([])

  const bottomRef = React.useRef<HTMLDivElement>(null)

  // Results are shown inline as chat messages now; no separate preview panel
  const [showJson, setShowJson] = React.useState<boolean>(false) // still used by AdminApiModal
  // Keep the last executed API JSON so the workflow can summarize it on the next turn
  const [lastExecutedResponse, setLastExecutedResponse] = React.useState<any>(undefined)

  // Lightweight client-side heuristic summarizer to ensure summaries are shown even if the model/provider fails
  const summarizeDataHeuristic = React.useCallback((data: any): string => {
    try {
      if (data == null) return "No data to summarize."
      if (Array.isArray(data)) {
        const n = data.length
        const sample = data.slice(0, 3)
        const keys = sample[0] ? Object.keys(sample[0]).slice(0, 6) : []
        const preview = sample.map((it: any, i: number) => {
          const id = it?.id || it?._id || it?.sku || it?.title || it?.name || `#${i + 1}`
          return typeof id === "string" ? id : JSON.stringify(it).slice(0, 120)
        })
        return [
          `Items: ${n}`,
          keys.length ? `Top keys: ${keys.join(", ")}` : undefined,
          preview.length ? `Examples: ${preview.join(", ")}` : undefined,
        ].filter(Boolean).join("\n")
      }
      if (typeof data === "object") {
        const keys = Object.keys(data)
        const lines: string[] = []
        lines.push(`Object with ${keys.length} keys`)
        const top = keys.slice(0, 8)
        lines.push(`Top keys: ${top.join(", ")}`)
        for (const k of top) {
          const v = (data as any)[k]
          if (Array.isArray(v)) lines.push(`${k}: ${v.length} items`)
        }
        return lines.join("\n")
      }
      return String(data)
    } catch {
      return "(unable to summarize data)"
    }
  }, [])

  const chat = useGeneralChat()
  const stream = useGeneralChatStream()
  const apiExec = useAdminApiExecutor()
  const threadsApi = useChatThreads()
  const threadApi = useChatThread()
  const createThreadApi = useCreateChatThread()

  // Auto-scroll to bottom
  React.useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [messages, stream.state.activeStep, suspendedWorkflow])

  const canSend = input.trim().length > 0 && !chat.isPending && !stream.state.isStreaming

  // Sync stream suspended state to local state
  React.useEffect(() => {
    if (stream.state.suspended) {
      setSuspendedWorkflow(stream.state.suspended)
    }
  }, [stream.state.suspended])

  const handleResumeWorkflow = async (selectedId: string, type: "option" | "action" = "option") => {
    if (!suspendedWorkflow) return

    // The stream closes on suspend (no 'end' event), so clear its UI state before resuming via POST
    try {
      stream.stop()
    } catch { }

    setSuspendedWorkflow(null) // Hide immediately

    // Add optimistic user message for selection
    const selectionLabel = type === "action"
      ? suspendedWorkflow.actions?.find(a => a.id === selectedId)?.label
      : suspendedWorkflow.options.find(o => o.id === selectedId)?.display

    if (selectionLabel) {
      setMessages(m => [...m, { role: "user", content: `Selected: ${selectionLabel}` }])
    }

    try {
      setIsResuming(true)
      setResumeStep("Resuming workflow...")

      const resp = await fetch(`/admin/ai/workflows/${suspendedWorkflow.runId}/resume`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          step: "confirm-selection",
          resumeData: {
            selectedId: type === "option" ? selectedId : "",
            action: type === "action" ? selectedId : undefined,
            confirmed: true,
          },
        }),
      })

      const response = (await resp.json()) as any

      // Add result to chat
      if (response.status === "completed") {
        setMessages(m => [...m, {
          role: "assistant",
          kind: "summary",
          content: typeof response.reply === "string" && response.reply.trim().length
            ? response.reply
            : summarizeDataHeuristic(response.result),
          data: { response: response.result, tip: response.tip },
        }, {
          role: "assistant",
          content: "What would you like to do next?\n- Load more orders for this customer\n- Fetch orders for another customer\n- View details of a specific order",
        }])
      } else if (response.status === "suspended") {
        // Handle re-suspension (e.g., multi-turn)
        setSuspendedWorkflow({
          runId: response.runId,
          reason: response.suspendPayload.reason,
          options: response.suspendPayload.options,
          actions: response.suspendPayload.actions,
          totalCount: response.suspendPayload.totalCount,
        })
      }
    } catch (error: any) {
      console.error("Resume failed:", error)
      setMessages(m => [...m, {
        role: "assistant",
        content: `Failed to resume workflow: ${error?.message || "Unknown error"}`
      }])
    } finally {
      setIsResuming(false)
      setResumeStep(undefined)
    }
  }

  const uiMessageToText = React.useCallback((content: any): string => {
    // ... existing uiMessageToText implementation
    if (typeof content === "string") return content
    if (content == null) return ""
    // Mastra uiMessages often come as array parts or structured objects
    if (Array.isArray(content)) {
      const parts = content
        .map((p) => {
          if (typeof p === "string") return p
          if (p && typeof p === "object") {
            if (typeof (p as any).text === "string") return (p as any).text
            if (typeof (p as any).content === "string") return (p as any).content
          }
          return ""
        })
        .filter(Boolean)
      if (parts.length) return parts.join("")
    }
    if (typeof content === "object") {
      if (typeof (content as any).text === "string") return (content as any).text
      if (typeof (content as any).content === "string") return (content as any).content
    }
    try {
      return JSON.stringify(content, null, 2)
    } catch {
      return String(content)
    }
  }, [])

  const hydrateFromThread = React.useCallback(
    async (threadId: string, resourceId?: string) => {
      const rid = resourceId || threadPickerResource
      const resp = await threadApi.mutateAsync({ threadId, resourceId: rid, page: 0, perPage: 200 })
      const ui = Array.isArray((resp as any)?.uiMessages) ? (resp as any).uiMessages : []
      const mapped: ChatMessage[] = ui
        .map((m: any) => {
          const role = m?.role === "user" || m?.role === "assistant" ? m.role : undefined
          if (!role) return null
          return {
            role,
            content: uiMessageToText(m?.content),
          } as ChatMessage
        })
        .filter(Boolean) as ChatMessage[]

      setActiveResourceId(String((resp as any)?.thread?.resourceId || rid))
      setActiveThreadId(threadId)
      setMessages(mapped)
      setInput("")
      // Clear planned actions from previous thread in UI
      setManualPlanned([])
      executedPlannedRef.current.clear()
    },
    [threadApi, threadPickerResource, uiMessageToText]
  )

  const loadThreads = React.useCallback(async () => {
    const rid = threadPickerResource.trim()
    if (!rid) return
    const resp = await threadsApi.mutateAsync({ resourceId: rid, page: 0, perPage: 50 })
    const threads = Array.isArray((resp as any)?.threads) ? (resp as any).threads : []
    setAvailableThreads(threads)
    if (!selectedThreadId && threads.length) {
      setSelectedThreadId(String(threads[0]?.id || ""))
    }
  }, [threadsApi, threadPickerResource, selectedThreadId])

  const startNewChat = React.useCallback(async () => {
    const rid = threadPickerResource.trim() || "ai:general-chat"
    // Prefer server-side thread creation when memory is available
    let tid: string | null = null
    try {
      const created = await createThreadApi.mutateAsync({ resourceId: rid })
      tid = String((created as any)?.thread?.id || "")
    } catch {
      tid = createLocalId()
    }
    setActiveResourceId(rid)
    setActiveThreadId(tid || createLocalId())
    setMessages([])
    setInput("")
    setManualPlanned([])
    executedPlannedRef.current.clear()
  }, [createThreadApi, createLocalId, threadPickerResource])

  // Fetch remote OpenAPI-backed catalog with fallback
  React.useEffect(() => {
    ; (async () => {
      const { items, source } = await useRemoteAdminApiCatalog(apiSearch)
      setCatalog(items)
      setCatalogSource(source)
    })()
  }, [apiSearch])

  const selected = React.useMemo(() => catalog.find((c) => c.id === selectedEndpointId), [catalog, selectedEndpointId])

  const stableStringify = React.useCallback((value: any): string => {
    try {
      const seen = new WeakSet()
      const sort = (v: any): any => {
        if (v === null || v === undefined) return v
        if (typeof v !== "object") return v
        if (seen.has(v)) return "[Circular]"
        seen.add(v)
        if (Array.isArray(v)) return v.map(sort)
        const out: Record<string, any> = {}
        for (const k of Object.keys(v).sort()) {
          out[k] = sort(v[k])
        }
        return out
      }
      return JSON.stringify(sort(value))
    } catch {
      try {
        return JSON.stringify(value)
      } catch {
        return String(value)
      }
    }
  }, [])

  const makeRequestKey = React.useCallback((req: any) => {
    const method = String(req?.method || req?.openapi?.method || "").toUpperCase()
    const path = String(req?.path || req?.openapi?.path || "")
    const body = req?.body ?? req?.openapi?.body
    const query = req?.query
    const pathParams = req?.pathParams
    return `${method}:${path}:${stableStringify({ pathParams, query, body })}`
  }, [stableStringify])

  const extractListPreview = React.useCallback((payload: any): { key: string; rows: any[]; count?: number } | null => {
    try {
      if (!payload || typeof payload !== "object") return null
      const obj = payload as Record<string, any>
      const ignore = new Set(["count", "offset", "limit", "take", "skip", "page", "pageSize", "total", "items", "data"])
      const entries = Object.entries(obj)
      const arrEntry = entries.find(([k, v]) => !ignore.has(k) && Array.isArray(v))
      if (arrEntry) {
        const [key, rows] = arrEntry
        return { key, rows: rows as any[], count: typeof obj.count === "number" ? obj.count : undefined }
      }
      // Fallback: if payload itself is an array
      if (Array.isArray(payload)) return { key: "items", rows: payload as any[] }
      return null
    } catch {
      return null
    }
  }, [])

  const buildPreviewColumns = React.useCallback((rows: any[]): ColumnDef<any, any>[] => {
    const first = rows?.find((r) => r && typeof r === "object" && !Array.isArray(r)) || {}
    const keys = Object.keys(first)
    const preferred = ["title", "name", "handle", "sku", "status", "id", "created_at", "updated_at"]
    const chosen: string[] = []
    for (const k of preferred) {
      if (keys.includes(k) && !chosen.includes(k)) chosen.push(k)
      if (chosen.length >= 6) break
    }
    for (const k of keys) {
      if (!chosen.includes(k)) chosen.push(k)
      if (chosen.length >= 6) break
    }
    return chosen.map((k) => ({
      accessorKey: k,
      header: k.replace(/_/g, " "),
      cell: ({ getValue }) => {
        const v = getValue() as any
        if (v == null) return ""
        if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v)
        return JSON.stringify(v)
      },
    }))
  }, [])

  const PreviewTable: React.FC<{ data: any; title: string }> = ({ data, title }) => {
    const preview = extractListPreview(data)
    if (!preview?.rows?.length) return null
    const rows = preview.rows.slice(0, 10)
    const columns = buildPreviewColumns(rows)
    const table = useReactTable({
      data: rows,
      columns,
      getCoreRowModel: getCoreRowModel(),
      initialState: { pagination: { pageIndex: 0, pageSize: rows.length } },
    })

    return (
      <div className="mt-3 border border-ui-border-base rounded-lg overflow-hidden">
        <div className="px-3 py-2 border-b border-ui-border-base">
          <Text className="text-ui-fg-subtle text-small">{title}</Text>
        </div>
        <div className="max-h-[260px] overflow-auto">
          <DataTableRoot
            table={table as any}
            columns={columns as any}
            count={preview.count ?? preview.rows.length}
            pagination={false}
            noHeader={false}
            layout="fit"
          />
        </div>
      </div>
    )
  }

  function buildBodySkeleton(schema: any): any {
    if (!schema) return {}
    // Handle refs minimally (leave as empty object)
    if (schema.$ref) return {}
    const type = schema.type
    if (type === "object") {
      const required: string[] = Array.isArray(schema.required) ? schema.required : []
      const props = schema.properties || {}
      const out: Record<string, any> = {}
      for (const k of required) {
        const p = props?.[k] || {}
        if (p.type === "array") out[k] = []
        else if (p.type === "object") out[k] = {}
        else if (p.type === "number" || p.type === "integer") out[k] = 0
        else if (p.type === "boolean") out[k] = false
        else out[k] = ""
      }
      return out
    }
    if (type === "array") return []
    if (type === "number" || type === "integer") return 0
    if (type === "boolean") return false
    return ""
  }

  // Validate a planned request against the loaded catalog, normalize path if needed, and run
  const validateAndRun = (tool: string, reqLike: any) => {
    const method = ((reqLike?.openapi?.method || reqLike?.method || "") as string).toUpperCase()
    const path = (reqLike?.openapi?.path || reqLike?.path || "") as string
    if (!method || !path) return
    const findMatch = (m: string, pth: string) =>
      catalog.find((ep) => ep.method.toUpperCase() === m.toUpperCase() && ep.path === pth)

    let match = findMatch(method, path)
    let correctedPath = path
    if (!match) {
      const withAdmin = path.startsWith("/admin") ? path : `/admin${path.startsWith("/") ? "" : "/"}${path}`
      const hyphenated = withAdmin.replace(/_/g, "-")
      const tryMatch = findMatch(method, hyphenated)
      if (tryMatch) {
        match = tryMatch
        correctedPath = hyphenated
        try {
          console.log("[AI][planned] auto-corrected path", { from: path, to: correctedPath })
        } catch { }
        setMessages((m) => [
          ...m,
          { role: "assistant", content: `Adjusted endpoint to ${method} ${correctedPath} (normalized)` },
        ])
      }
    }
    if (!match) {
      try { console.warn("[AI][planned] No catalog match", { method, path }) } catch { }
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: `Unknown API path from tool: ${method} ${path}. Please select a valid endpoint from the APIs panel.`,
        },
      ])
      return
    }
    try {
      console.log("[AI][planned] click →", { tool, method, path: correctedPath, body: reqLike?.body, args: (reqLike as any)?.args })
    } catch { }
    runPlanned(tool, { method, path: correctedPath, body: reqLike?.body })
  }

  // No preview table builder needed

  // When endpoint changes, prefill required inputs
  React.useEffect(() => {
    if (!selected) return
    // path params
    const pp: Record<string, string> = {}
    for (const name of selected.pathParams || []) {
      pp[name] = ""
    }
    setPathParamsJson(JSON.stringify(pp, null, 2))
    // query required
    const qq: Record<string, any> = {}
    for (const prm of selected.queryParamsSchema || []) {
      if (prm.required) qq[prm.name] = ""
    }
    setQueryJson(JSON.stringify(qq, null, 2))
    // body required
    const body = buildBodySkeleton(selected.requestBodySchema)
    setBodyJson(JSON.stringify(body, null, 2))
  }, [selected])

  const runPlanned = async (tool: string, req: { method: string; path: string; body?: any }) => {
    const key = makeRequestKey(req)
    if (executedRequestsRef.current.has(key) || inFlightRequestsRef.current.has(key)) {
      return
    }
    inFlightRequestsRef.current.add(key)
    try {
      const method = (req.method || "POST").toUpperCase()
      const init: any = { method }
      if (!(method === "GET" || method === "DELETE") && req.body !== undefined) {
        // Pass through plain object; SDK will handle JSON
        init.body = req.body
      }
      // Debug: log outgoing planned request
      try {
        console.log("[AI][runPlanned] →", {
          tool,
          method,
          path: req.path,
          body: init.body,
        })
      } catch { }
      const res = await sdk.client.fetch(req.path, init)
      const json = res as any
      const ok = true
      setLastExecutedResponse(json)
      executedRequestsRef.current.add(key)
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          kind: ok ? "executed" : "text",
          content: ok
            ? ""
            : `Failed to execute ${tool}. ${json?.message || ""}`,
          data: ok ? { tool, request: { method, path: req.path, body: init.body } } : undefined,
        },
        // Immediate local summary so the user doesn't have to wait for the model step
        {
          role: "assistant",
          kind: "summary",
          content: summarizeDataHeuristic(json),
          data: { tool, request: { method, path: req.path, body: init.body }, response: json },
        },
      ])
    } catch (e: any) {
      setMessages(() => [
        { role: "assistant", content: `Error executing ${tool}: ${e?.message || e}` },
      ])
    } finally {
      inFlightRequestsRef.current.delete(key)
    }
  }

  // Auto-run planned actions when enabled; avoid duplicate executions across updates
  React.useEffect(() => {
    if (!autoRunTools) return
    const planned = stream.state.actions?.planned || []
    for (const p of planned) {
      const key = makeRequestKey(p.request)
      if (executedPlannedRef.current.has(key)) continue
      executedPlannedRef.current.add(key)
      runPlanned(p.tool, p.request as any)
    }
  }, [autoRunTools, stream.state.actions?.planned, makeRequestKey])

  // NOTE: Previously we auto-opened the API panel when a planned request arrived.
  // Per UX request, we now keep it hidden unless explicitly toggled by the user.

  const handleRunApi = async () => {
    if (!selected) return
    const tool = "admin_api_manual"
    try {
      const pathParams = JSON.parse(pathParamsJson || "{}")
      const query = JSON.parse(queryJson || "{}")
      const body = JSON.parse(bodyJson || "{}")
      const key = makeRequestKey({ method: selected.method, path: selected.path, pathParams, query, body })
      if (executedRequestsRef.current.has(key) || inFlightRequestsRef.current.has(key)) {
        return
      }
      inFlightRequestsRef.current.add(key)
      // Debug: log outgoing Admin API request
      try {
        console.log("[AI][handleRunApi] →", {
          method: selected.method,
          path: selected.path,
          pathParams,
          query,
          body,
        })
      } catch { }
      const resp = await apiExec.mutateAsync({
        method: selected.method as any,
        path: selected.path,
        pathParams,
        query,
        body,
      })
      setLastExecutedResponse(resp)
      executedRequestsRef.current.add(key)
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          kind: "executed",
          content: "",
          data: { tool, request: { method: selected.method, path: selected.path, pathParams, query, body } },
        },
        {
          role: "assistant",
          kind: "summary",
          content: summarizeDataHeuristic(resp),
          data: { tool, request: { method: selected.method, path: selected.path, pathParams, query, body }, response: resp },
        },
      ])
    } catch (e: any) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `API error: ${e?.message || e}` },
      ])
    } finally {
      try {
        const pathParams = JSON.parse(pathParamsJson || "{}")
        const query = JSON.parse(queryJson || "{}")
        const body = JSON.parse(bodyJson || "{}")
        const key = makeRequestKey({ method: selected.method, path: selected.path, pathParams, query, body })
        inFlightRequestsRef.current.delete(key)
      } catch { }
    }
  }

  const send = async () => {
    if (!canSend) return
    const content = input.trim()
    setInput("")
    // Ensure a thread exists; if this is the first message, start a new chat
    const threadId = activeThreadId || createLocalId()
    const resourceId =
      activeResourceId ||
      threadPickerResource ||
      (entity ? `ai:general-chat:${entity}` : "ai:general-chat")

    if (!activeThreadId) {
      setActiveThreadId(threadId)
    }
    if (!activeResourceId) {
      setActiveResourceId(resourceId)
    }

    setMessages((m) => [...m, { role: "user", content }])

    const basePayload = {
      message: content,
      threadId,
      resourceId,
      context: {
        entity: entity || undefined,
        entity_id: entityId || undefined,
        ui: "admin",
        debug: debugLogs,
        api_context: {
          source: catalogSource,
          selectedEndpointId: selectedEndpointId || undefined,
          // Avoid sending potentially huge JSON during streaming which can cause provider stream errors
          executed_response: useStreaming ? undefined : lastExecutedResponse,
        },
      },
    }

    if (useStreaming) {
      // Start SSE and update assistant bubble live
      // Create a placeholder assistant message collecting chunks
      setMessages((m) => [...m, { role: "assistant", content: "" }])

      stream.start(basePayload)
      // clear any manually captured planned actions
      if (manualPlanned.length) setManualPlanned([])
      // Clear after handing it off so we don't duplicate summaries on subsequent turns
      if (lastExecutedResponse !== undefined) setLastExecutedResponse(undefined)

      // Observe changes to stream chunks and update message content
    } else {
      try {
        const resp = await chat.mutateAsync(basePayload as any)
        const reply = resp?.result?.reply || ""
        const nextThreadId = (resp as any)?.result?.threadId
        const nextResourceId = (resp as any)?.result?.resourceId
        if (nextThreadId && typeof nextThreadId === "string") setActiveThreadId(nextThreadId)
        if (nextResourceId && typeof nextResourceId === "string") setActiveResourceId(nextResourceId)
        setMessages((m) => [...m, { role: "assistant", content: reply }])
        // Extract planned actions from non-streaming response
        const acts = Array.isArray((resp as any)?.result?.activations) ? (resp as any).result.activations : []
        const planned = acts
          .filter((a: any) => a?.result?.status === "planned" && a?.result?.request)
          .map((a: any) => ({
            tool: a.name,
            request: a.result.request,
            secondary: (a.result as any)?.secondary,
            next: (a.result as any)?.next,
          }))
        setManualPlanned(planned)
        if (lastExecutedResponse !== undefined) setLastExecutedResponse(undefined)
      } catch (e: any) {
        setMessages((m) => [...m, { role: "assistant", content: e?.message || "Unexpected error" }])
      }
    }
  }

  // Keep assistant last message in sync with stream chunks
  React.useEffect(() => {
    if (!stream.state.isStreaming && stream.state.chunks.length === 0) return

    setMessages((m) => {
      // Find last assistant bubble (we appended an empty one before starting)
      const lastIdx = [...m].reverse().findIndex((mm) => mm.role === "assistant")
      if (lastIdx === -1) return m
      const idx = m.length - 1 - lastIdx
      const joined = stream.state.chunks.join("")
      const next = [...m]
      next[idx] = { ...next[idx], content: joined }
      return next
    })
  }, [stream.state.chunks, stream.state.isStreaming])

  // When stream ends and no summary is emitted, do nothing; content already in chunks
  // If stream errors, append an error note
  React.useEffect(() => {
    if (stream.state.error) {
      const err = String(stream.state.error || "")
      const label = err.includes("Failed after 3 attempts") ? "System error" : "Error"
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `${label}: ${err}` },
      ])
    }
  }, [stream.state.error])

  return (
    <>
      <RouteFocusModal.Header>
        <div className="flex w-full items-center justify-between pr-4">
          <Heading level="h2">General Chat {entity ? `· ${entity}` : ""}</Heading>
          <div className="flex items-center justify-end gap-x-2">
            <label className="flex items-center gap-2 text-ui-fg-subtle text-small">
              <input
                type="checkbox"
                checked={useStreaming}
                onChange={(e) => {
                  if (stream.state.isStreaming) return
                  setUseStreaming(e.target.checked)
                }}
              />
              Stream
            </label>
            <label className="flex items-center gap-2 text-ui-fg-subtle text-small">
              <input
                type="checkbox"
                checked={autoRunTools}
                onChange={(e) => setAutoRunTools(e.target.checked)}
              />
              Auto-run tools
            </label>
            <label className="flex items-center gap-2 text-ui-fg-subtle text-small">
              <input
                type="checkbox"
                checked={debugLogs}
                onChange={(e) => {
                  if (stream.state.isStreaming) return
                  setDebugLogs(e.target.checked)
                }}
              />
              Debug
            </label>
            <AdminApiModal
              catalog={catalog}
              catalogSource={catalogSource}
              apiSearch={apiSearch}
              setApiSearch={setApiSearch}
              selectedEndpointId={selectedEndpointId}
              setSelectedEndpointId={setSelectedEndpointId}
              selected={selected}
              pathParamsJson={pathParamsJson}
              setPathParamsJson={setPathParamsJson}
              queryJson={queryJson}
              setQueryJson={setQueryJson}
              bodyJson={bodyJson}
              setBodyJson={setBodyJson}
              showJson={showJson}
              setShowJson={setShowJson}
              onRun={handleRunApi}
              isRunning={apiExec.isPending}
            />
          </div>
        </div>
      </RouteFocusModal.Header>

      <RouteFocusModal.Body className="flex h-full flex-col overflow-hidden">
        {/* Scrollable content: either thread picker or messages */}
        {!activeThreadId && messages.length === 0 ? (
          <div className="flex-1 flex items-center justify-center px-4 py-8">
            <div className="w-full max-w-[640px] border border-ui-border-base rounded-lg p-4 bg-ui-bg-base">
              <Heading level="h2">Start a chat</Heading>
              <Text className="text-ui-fg-subtle text-small mt-1">
                Select a previous thread (by resource) or create a new chat.
              </Text>

              <div className="mt-4 grid grid-cols-1 gap-3">
                <div>
                  <Text className="text-ui-fg-subtle text-small">Resource ID</Text>
                  <Input
                    value={threadPickerResource}
                    onChange={(e) => setThreadPickerResource(e.target.value)}
                    placeholder="ai:general-chat or ai:general-chat:design"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    type="button"
                    isLoading={threadsApi.isPending}
                    onClick={loadThreads}
                  >
                    Load chats
                  </Button>
                  <Button
                    type="button"
                    isLoading={createThreadApi.isPending}
                    onClick={startNewChat}
                  >
                    New chat
                  </Button>
                </div>

                {availableThreads.length ? (
                  <div className="mt-2">
                    <Text className="text-ui-fg-subtle text-small mb-1">Existing threads</Text>
                    <Select value={selectedThreadId} onValueChange={setSelectedThreadId}>
                      <Select.Trigger>
                        <Select.Value placeholder="Select a thread…" />
                      </Select.Trigger>
                      <Select.Content>
                        {availableThreads.map((t: any) => (
                          <Select.Item key={String(t.id)} value={String(t.id)}>
                            {t.title ? `${t.title} · ` : ""}{String(t.id)}
                          </Select.Item>
                        ))}
                      </Select.Content>
                    </Select>
                    <div className="mt-2">
                      <Button
                        variant="secondary"
                        type="button"
                        isLoading={threadApi.isPending}
                        disabled={!selectedThreadId}
                        onClick={() => hydrateFromThread(selectedThreadId, threadPickerResource)}
                      >
                        Open selected
                      </Button>
                    </div>
                  </div>
                ) : null}

                <InlineTip label="Tip">
                  You can also just type a message below and hit Send — a new thread will be created automatically.
                </InlineTip>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <div className="w-full max-w-[920px] mx-auto">
              <div className="flex flex-col gap-y-3">
                {messages.map((m, i) => (
                  <div key={i} className={`max-w-[80%] rounded-md px-3 py-2 ${bubbleClass(m.role)}`}>
                    <Text className="text-ui-fg-subtle text-small block mb-1">{m.role === "user" ? "You" : "Assistant"}</Text>
                    <div className="whitespace-pre-wrap break-words">
                      {m.role === "assistant" && m.kind === "executed" ? (
                        <div>
                          <InlineTip label="Executed">
                            <div className="space-y-2">
                              <div>
                                {`Tool: ${String(m.data?.tool || "")} · Action executed (${String(m.data?.request?.method || "").toUpperCase()} ${String(m.data?.request?.path || "")}). Use "View JSON" to see the full result.`}
                              </div>
                              <pre className="text-xs whitespace-pre-wrap break-words bg-ui-bg-subtle p-2 rounded">{JSON.stringify(m.data?.request ?? {}, null, 2)}</pre>
                            </div>
                          </InlineTip>
                        </div>
                      ) : m.role === "assistant" && m.kind === "summary" ? (
                        <div>
                          <InlineTip label="Summary of latest API result">
                            <span className="whitespace-pre-wrap">
                              {typeof (m as any)?.data?.tip === "string" && (m as any).data.tip.trim().length
                                ? (m as any).data.tip
                                : "Orders fetched"}
                            </span>
                          </InlineTip>
                          <div className="mt-2">
                            <MarkdownMessage value={m.content} />
                          </div>
                        </div>
                      ) : (
                        m.role === "assistant" ? <MarkdownMessage value={m.content} /> : m.content
                      )}
                      {stream.state.isStreaming && i === messages.length - 1 && m.role === "assistant" && !m.content ? (
                        <Spinner className="inline-block ml-1 align-middle" />
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>

              {(stream.state.actions?.planned?.length ||
                manualPlanned.length ||
                (Array.isArray(stream.state.actions?.activations) &&
                  stream.state.actions.activations.some((a: any) => a?.result?.status === "executed" && a?.result?.request))) ? (
                <div className="mt-4 border border-dashed border-ui-border-base rounded-md p-3 bg-ui-bg-base">
                  <Text className="text-ui-fg-subtle text-small block mb-2">Planned actions</Text>
                  <div className="flex flex-wrap gap-2">
                    {(stream.state.actions?.planned?.length ? stream.state.actions.planned : manualPlanned).map((p: any, idx: number) => (
                      <Button
                        key={`${p.tool}-${idx}`}
                        variant="secondary"
                        size="small"
                        type="button"
                        onClick={() => validateAndRun(p.tool, (p as any).request)}
                        disabled={
                          stream.state.isStreaming ||
                          !((p as any)?.request?.openapi?.method || (p as any)?.request?.method) ||
                          !((p as any)?.request?.openapi?.path || (p as any)?.request?.path)
                        }
                      >
                        Run {(p as any)?.request?.openapi?.method?.toUpperCase() || (p as any)?.request?.method?.toUpperCase() || "ACTION"} {(p as any)?.request?.openapi?.path || (p as any)?.request?.path || ""}
                      </Button>
                    ))}
                  </div>

                  {Array.isArray(stream.state.actions?.activations) && stream.state.actions.activations.some((a: any) => a?.result?.status === "executed" && a?.result?.request) ? (
                    <div className="mt-3">
                      <Text className="text-ui-fg-subtle text-small block mb-2">Executed actions</Text>
                      <div className="flex flex-wrap gap-2">
                        {stream.state.actions.activations
                          .filter((a: any) => a?.result?.status === "executed" && a?.result?.request)
                          .map((a: any, idx: number) => (
                            <Button
                              key={`exec-${idx}`}
                              variant="transparent"
                              type="button"
                              onClick={() => validateAndRun(a?.name || "admin_api_request", a?.result?.request)}
                            >
                              {String(a?.result?.request?.method || a?.result?.request?.openapi?.method || "GET").toUpperCase()} {a?.result?.request?.path || a?.result?.request?.openapi?.path}
                            </Button>
                          ))}
                      </div>
                    </div>
                  ) : null}

                  {/* Secondary actions if present on planned entries */}
                  {(stream.state.actions?.planned || manualPlanned).some((p: any) => p.secondary) ? (
                    <div className="mt-3">
                      <Text className="text-ui-fg-subtle text-small block mb-2">Secondary actions</Text>
                      <div className="flex flex-wrap gap-2">
                        {(stream.state.actions?.planned || manualPlanned).flatMap((p: any, i: number) =>
                          p.secondary ? (
                            <Button
                              key={`secondary-${p.tool}-${i}`}
                              variant="secondary"
                              size="small"
                              type="button"
                              onClick={() => validateAndRun(p.tool, p.secondary)}
                              disabled={stream.state.isStreaming}
                            >
                              Run {p.tool} (secondary)
                            </Button>
                          ) : []
                        )}
                      </div>
                    </div>
                  ) : null}

                  {/* Next steps if provided (planner sequences) */}
                  {(stream.state.actions?.planned || manualPlanned).some((p: any) => Array.isArray(p.next) && p.next.length) ? (
                    <div className="mt-3">
                      <Text className="text-ui-fg-subtle text-small block mb-2">Next steps</Text>
                      <div className="flex flex-wrap gap-2">
                        {(stream.state.actions?.planned || manualPlanned).flatMap((p: any, i: number) =>
                          Array.isArray(p.next) ?
                            p.next.map((n: any, j: number) => (
                              <Button
                                key={`next-${p.tool}-${i}-${j}`}
                                variant="secondary"
                                size="small"
                                type="button"
                                onClick={() => validateAndRun(p.tool, n)}
                                disabled={stream.state.isStreaming}
                              >
                                Next: {(n?.openapi?.method || n?.method || "").toUpperCase()} {n?.openapi?.path || n?.path || ""}
                              </Button>
                            )) : []
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}


              {/* Suspended Workflow UI */}
              {suspendedWorkflow && (
                <div className="flex w-full mb-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div className="mr-auto w-full max-w-[85%]">
                    <SuspendedWorkflowSelector
                      reason={suspendedWorkflow.reason}
                      options={suspendedWorkflow.options}
                      actions={suspendedWorkflow.actions}
                      onSelect={handleResumeWorkflow}
                    />
                  </div>
                </div>
              )}

              {/* Typing Indicator */}
              {(chat.isPending || stream.state.isStreaming || stream.state.activeStep || isResuming) && (
                <div className={`flex w-full mb-6 ${bubbleClass("assistant")}`}>
                  <div className="flex items-center gap-2 px-4 py-3 rounded-2xl rounded-tl-none bg-ui-bg-subtle text-ui-fg-subtle">
                    <Spinner className="animate-spin" />
                    <span className="text-small">
                      {resumeStep || stream.state.activeStep || "Thinking..."}
                    </span>
                  </div>
                </div>
              )}

              <div ref={bottomRef} />
            </div>
          </div>
        )}

        <div className="p-4">
          <div className="flex justify-center">
            <div
              className={
                "group w-full max-w-[620px] transition-all duration-300 ease-out " +
                "focus-within:max-w-[920px] focus-within:shadow-lg focus-within:ring-2 focus-within:ring-ui-tag-neutral-icon focus-within:scale-[1.01] " +
                "rounded-2xl border border-ui-border-base bg-ui-bg-base shadow-sm"
              }
            >
              <div className="p-3">
                <Textarea
                  rows={1}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Type your message..."
                  disabled={chat.isPending || stream.state.isStreaming}
                  className={
                    "resize-none border-none bg-transparent p-0 outline-none focus:outline-none focus:ring-0 " +
                    "min-h-[44px] group-focus-within:min-h-[92px] transition-all duration-300 ease-out"
                  }
                />

                <div className="mt-2 flex items-center justify-end gap-2">
                  {!activeThreadId && !messages.length && (
                    <Button
                      variant="secondary"
                      type="button"
                      isLoading={createThreadApi.isPending}
                      onClick={startNewChat}
                      size="small"
                    >
                      New chat
                    </Button>
                  )}
                  {stream.state.isStreaming && (
                    <Button variant="secondary" type="button" onClick={() => stream.stop()} size="small">Stop</Button>
                  )}
                  <Button type="button" isLoading={chat.isPending} disabled={!canSend} onClick={send} size="small">Send</Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </RouteFocusModal.Body >

      <RouteFocusModal.Footer>
        <div className="flex items-center justify-end gap-x-2">
          {/* View last JSON result modal trigger */}
          <StackedFocusModal id="last-json-modal">
            <StackedFocusModal.Trigger asChild>
              <Button size="small" variant="secondary" type="button" disabled={lastExecutedResponse === undefined}>View JSON</Button>
            </StackedFocusModal.Trigger>
            <StackedFocusModal.Content className="flex flex-col">
              <StackedFocusModal.Header>
                <StackedFocusModal.Title>Last API Result</StackedFocusModal.Title>
              </StackedFocusModal.Header>
              <div className="p-3 max-h-[70vh] overflow-y-auto">
                <pre className="text-xs whitespace-pre-wrap break-words bg-ui-bg-subtle p-3 rounded">{JSON.stringify(lastExecutedResponse ?? {}, null, 2)}</pre>
              </div>
              <StackedFocusModal.Footer>
                <div className="flex w-full items-center justify-end gap-x-2">
                  <StackedFocusModal.Close asChild>
                    <Button variant="secondary">Close</Button>
                  </StackedFocusModal.Close>
                </div>
              </StackedFocusModal.Footer>
            </StackedFocusModal.Content>
          </StackedFocusModal>
          <RouteFocusModal.Close asChild>
            <Button variant="secondary" type="button">Close</Button>
          </RouteFocusModal.Close>
        </div>
      </RouteFocusModal.Footer>
    </>
  )
}

export default GeneralChat

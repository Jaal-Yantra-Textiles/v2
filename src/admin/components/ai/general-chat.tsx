import React from "react"
import { Button, Heading, Input, Text, Textarea, Select } from "@medusajs/ui"
import { RouteFocusModal } from "../modal/route-focus-modal"
import { StackedFocusModal } from "../modal/stacked-modal/stacked-focused-modal"
import { useGeneralChat, useGeneralChatStream } from "../../hooks/api/ai"
import { useAdminApiExecutor, useRemoteAdminApiCatalog, AdminEndpoint } from "../../hooks/api/admin-catalog"
import { sdk } from "../../lib/config"

export type ChatMessage = {
  role: "user" | "assistant"
  content: string
}

export type GeneralChatProps = {
  entity?: string
  entityId?: string
}

const bubbleClass = (role: ChatMessage["role"]) =>
  role === "user"
    ? "ml-auto bg-ui-bg-base border border-ui-border-base"
    : "mr-auto bg-ui-bg-subtle"

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

export const GeneralChat: React.FC<GeneralChatProps> = ({ entity, entityId }) => {
  const [messages, setMessages] = React.useState<ChatMessage[]>([])
  const [input, setInput] = React.useState("")
  const [threadId] = React.useState<string>(() => (typeof crypto !== "undefined" && (crypto as any).randomUUID ? (crypto as any).randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`))
  const [useStreaming, setUseStreaming] = React.useState<boolean>(true)
  const [autoRunTools, setAutoRunTools] = React.useState<boolean>(false)
  const [apiSearch, setApiSearch] = React.useState<string>("")
  const [catalog, setCatalog] = React.useState<AdminEndpoint[]>([])
  const [selectedEndpointId, setSelectedEndpointId] = React.useState<string>("")
  const [pathParamsJson, setPathParamsJson] = React.useState<string>("{}")
  const [queryJson, setQueryJson] = React.useState<string>("{}")
  const [bodyJson, setBodyJson] = React.useState<string>("{}")
  const [catalogSource, setCatalogSource] = React.useState<string>("static")
  const executedPlannedRef = React.useRef<Set<string>>(new Set())

  // API preview (table)
  const [preview, setPreview] = React.useState<{
    columns: string[]
    rows: Record<string, any>[]
    hiddenKeys: string[]
  } | null>(null)
  // Raw response + toggle
  const [lastResponse, setLastResponse] = React.useState<any>(null)
  const [showJson, setShowJson] = React.useState<boolean>(false)

  const chat = useGeneralChat()
  const stream = useGeneralChatStream()
  const apiExec = useAdminApiExecutor()

  const canSend = input.trim().length > 0 && !chat.isPending && !stream.state.isStreaming

  // Fetch remote OpenAPI-backed catalog with fallback
  React.useEffect(() => {
    ;(async () => {
      const { items, source } = await useRemoteAdminApiCatalog(apiSearch)
      setCatalog(items)
      setCatalogSource(source)
    })()
  }, [apiSearch])

  const selected = React.useMemo(() => catalog.find((c) => c.id === selectedEndpointId), [catalog, selectedEndpointId])

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

  // Extract a tabular preview from various response shapes
  function buildPreviewFromResponse(resp: any): { columns: string[]; rows: Record<string, any>[]; hiddenKeys: string[] } | null {
    if (!resp) return null
    const payload = resp.result ?? resp

    // Prefer arrays directly
    let list: any[] | null = null
    if (Array.isArray(payload)) list = payload

    // Common Medusa patterns: { products: [...] }, { orders: [...] }, { items: [...] }
    const arrayKeys = ["products", "orders", "customers", "inventory_items", "items", "data"]
    if (!list) {
      for (const k of arrayKeys) {
        if (Array.isArray(payload?.[k])) {
          list = payload[k]
          break
        }
      }
    }

    // If still not array, try wrapping single object
    if (!list) {
      if (payload && typeof payload === "object") list = [payload]
    }

    if (!list || !list.length) return null

    // Determine columns from the first item (max 4)
    const first = list[0] || {}
    const keys = Object.keys(first)
    if (!keys.length) return null

    const columns = keys.slice(0, 4)
    const hiddenKeys = keys.slice(4)

    // Normalize rows to plain objects; pick only columns for table cells
    const rows = list.map((item) => {
      const row: Record<string, any> = {}
      for (const k of columns) row[k] = item?.[k]
      // attach a synthetic field with hidden data for tooltip rendering
      if (hiddenKeys.length) {
        const rest: Record<string, any> = {}
        for (const hk of hiddenKeys) rest[hk] = item?.[hk]
        row.__hidden__ = rest
      }
      return row
    })

    return { columns, rows, hiddenKeys }
  }

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
    try {
      const method = (req.method || "POST").toUpperCase()
      const init: any = { method }
      if (!(method === "GET" || method === "DELETE") && req.body !== undefined) {
        init.body = req.body
      }
      const res = await sdk.client.fetch(req.path, init)
      const json = res as any
      setLastResponse(json)
      setPreview(buildPreviewFromResponse(json))
      const ok = true
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: ok
            ? `Action executed (${method} ${req.path})`
            : `Failed to execute ${tool}. ${json?.message || ""}`,
        },
      ])
    } catch (e: any) {
      setMessages((m) => [
        { role: "assistant", content: `Error executing ${tool}: ${e?.message || e}` },
      ])
    }
  }

  // Auto-run planned actions when enabled; avoid duplicate executions across updates
  React.useEffect(() => {
    if (!autoRunTools) return
    const planned = stream.state.actions?.planned || []
    for (const p of planned) {
      const key = `${p.tool}:${JSON.stringify(p.request)}`
      if (executedPlannedRef.current.has(key)) continue
      executedPlannedRef.current.add(key)
      runPlanned(p.tool, p.request as any)
    }
  }, [autoRunTools, stream.state.actions?.planned])

  // NOTE: Previously we auto-opened the API panel when a planned request arrived.
  // Per UX request, we now keep it hidden unless explicitly toggled by the user.

  const handleRunApi = async () => {
    if (!selected) return
    try {
      const pathParams = JSON.parse(pathParamsJson || "{}")
      const query = JSON.parse(queryJson || "{}")
      const body = JSON.parse(bodyJson || "{}")
      const resp = await apiExec.mutateAsync({
        method: selected.method as any,
        path: selected.path,
        pathParams,
        query,
        body,
      })
      setLastResponse(resp)
      setPreview(buildPreviewFromResponse(resp))
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `Action executed (${selected.method} ${selected.path})` },
      ])
    } catch (e: any) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `API error: ${e?.message || e}` },
      ])
    }
  }

  const send = async () => {
    if (!canSend) return
    const content = input.trim()
    setInput("")
    setMessages((m) => [...m, { role: "user", content }])

    const basePayload = {
      message: content,
      threadId,
      resourceId: entity ? `ai:general-chat:${entity}` : "ai:general-chat",
      context: {
        entity: entity || undefined,
        entity_id: entityId || undefined,
        ui: "admin",
      },
    }

    if (useStreaming) {
      // Start SSE and update assistant bubble live
      // Create a placeholder assistant message collecting chunks
      setMessages((m) => [...m, { role: "assistant", content: "" }])

      stream.start(basePayload)

      // Observe changes to stream chunks and update message content
    } else {
      try {
        const resp = await chat.mutateAsync(basePayload as any)
        const reply = resp?.result?.reply || ""
        setMessages((m) => [...m, { role: "assistant", content: reply }])
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
      setMessages((m) => [...m, { role: "assistant", content: `Error: ${stream.state.error}` }])
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

      <RouteFocusModal.Body className="flex h-full flex-col gap-y-4 overflow-y-hidden">
        {(preview || lastResponse) && (
          <div className="px-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-ui-fg-subtle text-small">Last action result</div>
              <label className="flex items-center gap-2 text-ui-fg-subtle text-small">
                <input type="checkbox" checked={showJson} onChange={(e) => setShowJson(e.target.checked)} />
                See JSON
              </label>
            </div>
            {!showJson && (
              <div className="mb-3 rounded-md border border-ui-border-base bg-ui-bg-subtle p-2 text-small">
                Action executed. Below is a preview when applicable.
              </div>
            )}
            {showJson ? (
              <pre className="max-h-[420px] overflow-auto rounded-md border border-ui-border-base bg-ui-bg-base p-3 text-xs">
                {JSON.stringify(lastResponse ?? {}, null, 2)}
              </pre>
            ) : (
              preview && (
                <div className="overflow-auto border border-ui-border-base rounded-md">
                  <table className="min-w-full text-left text-small">
                    <thead className="bg-ui-bg-subtle">
                      <tr>
                        {preview.columns.map((c) => (
                          <th key={c} className="px-3 py-2 font-medium text-ui-fg-subtle border-b border-ui-border-base">{c}</th>
                        ))}
                        {preview.hiddenKeys.length ? (
                          <th className="px-3 py-2 font-medium text-ui-fg-subtle border-b border-ui-border-base">More</th>
                        ) : null}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((r, i) => (
                        <tr key={i} className="odd:bg-ui-bg-base even:bg-ui-bg-subtle/20">
                          {preview.columns.map((c) => (
                            <td key={c} className="px-3 py-2 align-top border-b border-ui-border-base max-w-[280px] truncate" title={String(r[c] ?? "")}>
                              {typeof r[c] === "object" ? JSON.stringify(r[c]) : String(r[c] ?? "")}
                            </td>
                          ))}
                          {preview.hiddenKeys.length ? (
                            <td className="px-3 py-2 align-top border-b border-ui-border-base">
                              <span
                                className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-ui-bg-base border border-ui-border-base cursor-help"
                                title={JSON.stringify(r.__hidden__ || {}, null, 2)}
                              >
                                …
                              </span>
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4">
          <div className="flex flex-col gap-y-3">
            {messages.map((m, i) => (
              <div key={i} className={`max-w-[80%] rounded-md px-3 py-2 ${bubbleClass(m.role)}`}>
                <Text className="text-ui-fg-subtle text-small block mb-1">{m.role === "user" ? "You" : "Assistant"}</Text>
                <div className="whitespace-pre-wrap break-words">{m.content || (stream.state.isStreaming && i === messages.length - 1 ? "…" : "")}</div>
              </div>
            ))}
            {messages.length === 0 && (
              <div className="text-ui-fg-subtle">
                Start a conversation. Context will include entity and entityId if supplied.
              </div>
            )}
            {/* Planned tool actions surfaced from stream */}
            {stream.state.actions?.planned?.length ? (
              <div className="mt-4 border border-dashed border-ui-border-base rounded-md p-3">
                <Text className="text-ui-fg-subtle text-small block mb-2">Planned actions</Text>
                <div className="flex flex-wrap gap-2">
                  {stream.state.actions.planned.map((p, idx) => (
                    <Button
                      key={`${p.tool}-${idx}`}
                      variant="secondary"
                      size="small"
                      type="button"
                      onClick={() => runPlanned(p.tool, { method: p.request.openapi?.method, path: p.request.openapi?.path })}
                      disabled={stream.state.isStreaming}
                    >
                      Run {p.tool}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="border-t border-ui-border-base p-4">
          <div className="flex flex-col gap-2">
            <Textarea
              rows={3}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a message..."
              disabled={chat.isPending || stream.state.isStreaming}
            />
            <div className="flex items-center justify-end gap-2">
              {stream.state.isStreaming && (
                <Button variant="secondary" type="button" onClick={() => stream.stop()}>Stop</Button>
              )}
              <Button type="button" isLoading={chat.isPending} disabled={!canSend} onClick={send}>Send</Button>
            </div>
          </div>
        </div>
      </RouteFocusModal.Body>

      <RouteFocusModal.Footer>
        <div className="flex items-center justify-end gap-x-2">
          <RouteFocusModal.Close asChild>
            <Button variant="secondary" type="button">Close</Button>
          </RouteFocusModal.Close>
        </div>
      </RouteFocusModal.Footer>
    </>
  )
}

export default GeneralChat

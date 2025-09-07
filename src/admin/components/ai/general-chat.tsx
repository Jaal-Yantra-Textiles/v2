import React from "react"
import { Button, Heading, Input, Text, Textarea, Select } from "@medusajs/ui"
import { Spinner } from "@medusajs/icons"
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

// Use Medusa UI Spinner as typing indicator during streaming

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

  // Planned actions for non-streaming responses
  const [manualPlanned, setManualPlanned] = React.useState<any[]>([])

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
        } catch {}
        setMessages((m) => [
          ...m,
          { role: "assistant", content: `Adjusted endpoint to ${method} ${correctedPath} (normalized)` },
        ])
      }
    }
    if (!match) {
      try { console.warn("[AI][planned] No catalog match", { method, path }) } catch {}
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
    } catch {}
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
      } catch {}
      const res = await sdk.client.fetch(req.path, init)
      const json = res as any
      const ok = true
      setLastExecutedResponse(json)
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: ok
            ? `Action executed (${method} ${req.path}). Use "View JSON" to see the full result.`
            : `Failed to execute ${tool}. ${json?.message || ""}`,
        },
        // Immediate local summary so the user doesn't have to wait for the model step
        { role: "assistant", content: `Summary of latest API result:\n${summarizeDataHeuristic(json)}` },
      ])
    } catch (e: any) {
      setMessages(() => [
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
      // Debug: log outgoing Admin API request
      try {
        console.log("[AI][handleRunApi] →", {
          method: selected.method,
          path: selected.path,
          pathParams,
          query,
          body,
        })
      } catch {}
      const resp = await apiExec.mutateAsync({
        method: selected.method as any,
        path: selected.path,
        pathParams,
        query,
        body,
      })
      setLastExecutedResponse(resp)
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `Action executed (${selected.method} ${selected.path}). Use "View JSON" to see the full result.` },
        { role: "assistant", content: `Summary of latest API result:\n${summarizeDataHeuristic(resp)}` },
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
        {/* Scrollable content: messages + previews + planned actions */}
        <div className="flex-1 overflow-y-auto px-4 py-2">
          <div className="flex flex-col gap-y-3">
            {messages.map((m, i) => (
              <div key={i} className={`max-w-[80%] rounded-md px-3 py-2 ${bubbleClass(m.role)}`}>
                <Text className="text-ui-fg-subtle text-small block mb-1">{m.role === "user" ? "You" : "Assistant"}</Text>
                <div className="whitespace-pre-wrap break-words">
                  {m.content}
                  {stream.state.isStreaming && i === messages.length - 1 && m.role === "assistant" && !m.content ? (
                    <Spinner className="inline-block ml-1 align-middle" />
                  ) : null}
                </div>
              </div>
            ))}
          </div>
          {/* Removed separate Last action result panel; results are posted as chat messages */}
        {(stream.state.actions?.planned?.length || manualPlanned.length) ? (
          <div className="mt-4 border border-dashed border-ui-border-base rounded-md p-3">
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
                    !(p as any)?.request?.openapi?.method ||
                    !(p as any)?.request?.openapi?.path
                  }
                >
                  Run {p.tool}
                </Button>
              ))}
            </div>

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

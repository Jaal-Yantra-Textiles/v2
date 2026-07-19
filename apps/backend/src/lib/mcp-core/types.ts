/**
 * Shared MCP core — types.
 *
 * One declarative tool model + one execution context, reused by every MCP
 * surface (store, partner, admin). Each surface supplies its own registry of
 * `McpToolDef[]` (a data array) and an auth-scoped `McpContext`; the core owns
 * the dispatch, proxy, schema-shaping, observability and JSON-RPC server logic.
 *
 * A tool maps 1:1 to a real HTTP route on this backend. The dispatcher is a
 * thin loopback proxy, so every tool inherits the wrapped route's auth,
 * `validateAndTransformBody` validators and workflow logic — for free. Wrapping
 * a new endpoint is a single registry row.
 */

/** HTTP verb of the wrapped route. GET = read (always exposed). */
export type McpMethod = "GET" | "POST" | "PUT" | "DELETE"

export type McpToolDef = {
  /** Tool name surfaced to the agent (snake_case). */
  name: string
  /** One-line description shown in `tools/list` and to the model. */
  description: string
  /** JSON Schema for the domain arguments (framework args are injected). */
  inputSchema: Record<string, any>
  /** HTTP method of the wrapped route. Defaults to GET. */
  method?: McpMethod
  /** Route path, with `:param` placeholders, e.g. `/admin/orders/:id`. */
  path?: string
  /** Names of `:param` placeholders that must be supplied as arguments. */
  pathParams?: string[]
  /** Argument keys forwarded to the route as query-string params. */
  queryParams?: string[]
  /** Argument keys assembled into the JSON request body (write tools only). */
  bodyParams?: string[]
  /** Non-GET tool: gated behind the write flag on the server. */
  write?: boolean
  /**
   * High-stakes mutation: requires `confirm: true` to execute. Called without
   * it, the dispatcher returns a `requires_confirmation` plan. Every DELETE is
   * treated as sensitive implicitly; set this to flag sensitive POST/PUTs too.
   */
  sensitive?: boolean
  /**
   * Platform-destructive action (admin surface): on top of `confirm: true`, it
   * refuses to run without a human-supplied `reason` string (forwarded as the
   * `x-mcp-reason` header and audited). Hidden from `tools/list` and refused at
   * dispatch when the surface's dangerous flag is off. Implies `sensitive`.
   */
  dangerous?: boolean
  /**
   * Companion GET path (same `:param` substitution) used during `dry_run` to
   * fetch the current object so the model can see what it is about to change.
   */
  previewPath?: string
  /** Optional pure post-processor applied to a successful response. */
  transform?: (data: any, args: Record<string, unknown>) => any
  /**
   * One-line note about non-obvious effects of running this tool (state it
   * leaves behind, what it does NOT do). Rendered into the model-facing
   * description so the agent reasons about the tool's real footprint.
   */
  sideEffects?: string
  /**
   * Tool names the agent typically calls after this one. Rendered into the
   * description as a hint (not enforced).
   */
  nextSteps?: string[]
}

/** A single observability event emitted by the dispatcher (#844). */
export type McpToolEvent = {
  /** Which MCP surface handled the call: "store" | "partner" | "admin". */
  surface: string
  /** Tool name. */
  tool: string
  /** Wrapped route method + path actually planned/executed. */
  method: string
  path?: string
  /** True when the tool executed for real (not dry_run / requires_confirmation). */
  executed: boolean
  /** Outcome of an executed call. */
  ok: boolean
  /** Rail the call resolved on: "dry_run" | "confirm" | "reason" | "run" | "refused". */
  outcome: string
  /** Wall-clock milliseconds for the loopback call (executed calls only). */
  ms?: number
  /** Soft error message when ok=false. */
  error?: string
  /** The agent's stated intent (`context` arg), truncated. */
  context?: string
}

export type McpContext = {
  /** Backend origin for loopback calls, e.g. http://localhost:9000. */
  baseUrl: string
  /** Auth header to forward so the wrapped route authenticates (JWT). */
  bearer?: string
  /** Session cookie to forward when the caller authed via cookie. */
  cookie?: string
  /** When false, write tools (non-GET) are refused. Defaults to true. */
  enableWrite?: boolean
  /**
   * When false (default on the admin surface in dev/preview), `dangerous` tools
   * are hidden from `tools/list` and refused at dispatch. Surfaces without any
   * dangerous tools can leave this undefined.
   */
  enableDangerous?: boolean
  /** Which surface this context serves — labels observability + server name. */
  surface?: string
  /** Optional sink for per-call observability events (#844). */
  observe?: (evt: McpToolEvent) => void
}

/** Structured tool result. `ok:false` is a soft error (returned, not thrown). */
export type McpToolResult = {
  ok: boolean
  tool: string
  /** Successful response payload. */
  data?: unknown
  /** Soft error message. */
  error?: string
  /** Set when dry_run echoed the plan instead of executing. */
  dry_run?: boolean
  /** Set when a sensitive tool needs `confirm: true` before it will run. */
  requires_confirmation?: boolean
  /** Set when a dangerous tool needs a `reason` string before it will run. */
  requires_reason?: boolean
  /** The request that would be / was sent — { method, path, query, body }. */
  plan?: Record<string, unknown>
  /** Current object (writes with a previewPath, during dry_run/confirmation). */
  current?: unknown
  /** Human-readable warning for sensitive/dangerous actions. */
  warning?: string
}

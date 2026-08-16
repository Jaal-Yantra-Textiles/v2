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

// Type-only, so no runtime cycle with `./tiers` (which imports McpToolDef).
import type { McpScopeLevel } from "./tiers"

/** HTTP verb of the wrapped route. GET = read (always exposed). */
export type McpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

export type McpToolDef = {
  /** Tool name surfaced to the agent (snake_case). */
  name: string
  /** One-line description shown in `tools/list` and to the model. */
  description: string
  /** JSON Schema for the domain arguments (framework args are injected). */
  inputSchema: Record<string, any>
  /**
   * Native (non-proxy) tool marker. When set, the tool is NOT dispatched to a
   * loopback route; instead the surface's `ctx.runNative(native, args)` handler
   * runs it in-process (e.g. the store surface's `list_stores` /
   * `get_storefront_key` container-backed tenant discovery). Native tools are
   * read-only and bypass path/method/query/body. Leave unset for proxy tools.
   */
  native?: string
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
   * Rung on the scope ladder a credential must reach to call this tool (#1306).
   *
   * Independent of `sensitive`, which stays the confirm-gate. Set `tier:
   * "write"` on a confirm-worthy but ordinary mutation — reversible, no money,
   * no effect outside the platform — to make it reachable by a `write`-scoped
   * third-party credential while the admin UI keeps asking to confirm it.
   *
   * Omit it and the rung is derived from the existing flags, which is the
   * pre-#1306 behaviour. It can only ever NARROW relative to that derivation
   * for a dangerous tool; see `mcpToolTier`.
   */
  tier?: McpScopeLevel
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
  /**
   * When false, `sensitive` tools (explicitly flagged ones, every DELETE, and
   * every dangerous tool) are hidden from `tools/list` and refused at dispatch.
   *
   * This is a PERMISSION, distinct from the confirm rail: the rail asks a human
   * to approve, whereas from a third-party MCP client the model supplies
   * `confirm: true` itself, so the rail is not a boundary there (#1306 Track C).
   * A token scoped to `write` gets ordinary mutations without the confirm-gated
   * ones. Undefined means allowed, so surfaces that don't scope are unaffected.
   */
  enableSensitive?: boolean
  /**
   * When true, the confirm/reason safety rails are skipped entirely and every
   * tool is either a read or a plain write (write-gated only). The store
   * surface sets this: there a DELETE (`remove_line_item`) is an ordinary cart
   * operation, not a platform-destructive action, so the admin surface's
   * "DELETE is implicitly sensitive" rule must not apply. Defaults to false —
   * partner/admin keep the full rails.
   */
  disableSensitiveRails?: boolean
  /**
   * The credential's effective rung on the scope ladder (#1306).
   *
   * When set it SUPERSEDES the three `enable*` flags for visibility and
   * dispatch: a tool is exposed and callable iff `scopeLevel` reaches its
   * `mcpToolTier(def)`. That is what makes the `write` rung mean something —
   * the flags cannot express "ordinary mutations but not the confirm-gated
   * ones" per tool, only per class, and every admin write is in the sensitive
   * class.
   *
   * Left undefined by surfaces that don't scope (store, partner), which keep
   * the flag behaviour unchanged.
   */
  scopeLevel?: McpScopeLevel
  /** Which surface this context serves — labels observability + server name. */
  surface?: string
  /** Optional sink for per-call observability events (#844). */
  observe?: (evt: McpToolEvent) => void
  /**
   * Multi-tenant proxy scoping (store surface only). When set, every proxy tool
   * is scoped to a storefront's publishable key rather than a user JWT: a
   * `store` argument (handle/domain) is resolved per-call via `resolveKey`,
   * falling back to `defaultKey`. Single-tenant surfaces (partner/admin) leave
   * this undefined and authenticate via `bearer`/`cookie` instead.
   */
  tenant?: {
    /** Publishable key used when no `store` argument is supplied. */
    defaultKey?: string
    /** Resolve a `store` argument (handle/domain/id) to a publishable key. */
    resolveKey?: (storeArg: string) => Promise<string | null>
    /** Message returned when no key can be resolved and one is required. */
    missingKeyMessage?: string
  }
  /**
   * Handler for `native` tools — run in-process instead of proxied to a route
   * (store surface: `list_stores` / `get_storefront_key`). Required if any tool
   * in the registry sets `native`.
   */
  runNative?: (
    native: string,
    args: Record<string, unknown>
  ) => Promise<McpToolResult>
  /**
   * Surface-specific copy for the write-disabled refusal. Lets the store
   * surface keep its dual-mount guidance ("use the keyed /store/mcp mount" vs
   * "set STORE_MCP_ENABLE_WRITE"). Falls back to a generic message when unset.
   */
  writeDisabledMessage?: (toolName: string) => string
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

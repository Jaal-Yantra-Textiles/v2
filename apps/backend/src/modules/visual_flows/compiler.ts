import { createHash } from "crypto"
// Import the registry INSTANCE only (operations/types has no app-level imports),
// not operations/index — that module pulls in trigger-flow → workflows → steps
// and would close an import cycle back through service.ts. The registry is
// populated at app boot when the executor imports operations/index; the compiler
// just reads whatever handlers are registered by the time a flow is saved.
import { operationRegistry } from "./operations/types"

/**
 * #459 P1 — compile-on-save.
 *
 * Turns a flow's editor graph (canvas_state, with a DB operations/connections
 * fallback) into a normalized, validated execution plan computed ONCE at save
 * time instead of being re-derived from canvas_state on every execution.
 *
 * Hard errors (block activation): cycles, unknown operation types, edges that
 * reference a missing node, and graphs with no entrypoint. Option/Zod
 * mismatches are recorded as WARNINGS, never hard errors — raw option values
 * routinely contain `{{ ... }}` template tokens that only resolve at runtime,
 * so strict static typing of them would falsely reject valid flows.
 */

export const COMPILED_PLAN_VERSION = 1 as const

export type CompiledNode = {
  /** graph node id (canvas node id, or DB operation id on the fallback path) */
  id: string
  /** operation_key — the data-chain slot this node writes to */
  key: string
  /** operation_type — resolves to a handler in operationRegistry */
  type: string
  options: Record<string, any>
  /** outgoing edges grouped by branch handle */
  next: { default: string[]; success: string[]; failure: string[] }
}

export type CompiledPlan = {
  version: typeof COMPILED_PLAN_VERSION
  ok: boolean
  errors: string[]
  warnings: string[]
  /** node ids reachable from the trigger (entry of the graph) */
  entrypoints: string[]
  /** topological levels; nodes within a level have no inter-dependency */
  levels: string[][]
  nodes: Record<string, CompiledNode>
  hash: string
}

type GraphNode = { id: string; key: string; type: string; options: Record<string, any> }
type GraphEdge = { source: string; target: string; sourceHandle: string }

const TRIGGER_ID = "trigger"

/**
 * Extract the execution graph from a flow, mirroring the live executor's
 * source-of-truth precedence: canvas_state nodes/edges first, falling back to
 * DB operations/connections (seed scripts store the graph only in the DB).
 * Canvas node options take precedence; DB operation options fill the gap.
 */
export function extractGraph(flow: any): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const canvas = flow?.canvas_state || {}
  const canvasNodes: any[] = Array.isArray(canvas.nodes) ? canvas.nodes : []
  const canvasEdges: any[] = Array.isArray(canvas.edges) ? canvas.edges : []

  const dbOps: any[] = Array.isArray(flow?.operations) ? flow.operations : []
  const dbOpByKey = new Map<string, any>()
  for (const op of dbOps) dbOpByKey.set(op.operation_key, op)

  // Prefer the canvas graph (what the executor runs); fall back to DB rows.
  const usingCanvas = canvasNodes.some((n) => n.id !== TRIGGER_ID)

  if (usingCanvas) {
    const nodes: GraphNode[] = []
    for (const node of canvasNodes) {
      if (node.id === TRIGGER_ID) continue
      const data = node.data || {}
      const key = data.operationKey || node.id
      const dbOp = dbOpByKey.get(key)
      const hasCanvasOptions = data.options && Object.keys(data.options).length > 0
      nodes.push({
        id: node.id,
        key,
        type: data.operationType || dbOp?.operation_type || "unknown",
        options: hasCanvasOptions ? data.options : dbOp?.options || {},
      })
    }
    const edges: GraphEdge[] = canvasEdges.map((e) => ({
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle || "default",
    }))
    return { nodes, edges }
  }

  // DB fallback
  const nodes: GraphNode[] = dbOps.map((op) => ({
    id: op.id,
    key: op.operation_key,
    type: op.operation_type,
    options: op.options || {},
  }))
  const dbConns: any[] = Array.isArray(flow?.connections) ? flow.connections : []
  const edges: GraphEdge[] = dbConns.map((c) => ({
    source: c.source_id,
    target: c.target_id,
    sourceHandle: c.source_handle || "default",
  }))
  return { nodes, edges }
}

/** Deep-scan an options object for `{{ ... }}` template tokens. */
function hasTemplateTokens(value: any): boolean {
  if (typeof value === "string") return /\{\{\s*[^}]+\s*\}\}/.test(value)
  if (Array.isArray(value)) return value.some(hasTemplateTokens)
  if (value && typeof value === "object") return Object.values(value).some(hasTemplateTokens)
  return false
}

function stableHash(plan: Omit<CompiledPlan, "hash">): string {
  // Hash the structural parts only (not ok/errors/warnings — those are derived).
  const material = JSON.stringify({
    version: plan.version,
    entrypoints: plan.entrypoints,
    levels: plan.levels,
    nodes: plan.nodes,
  })
  return createHash("sha256").update(material).digest("hex")
}

/**
 * Compile a flow into a CompiledPlan. Pure — no container, no I/O.
 */
export function compileFlow(flow: any): CompiledPlan {
  const errors: string[] = []
  const warnings: string[] = []

  const { nodes: graphNodes, edges } = extractGraph(flow)

  const nodeById = new Map<string, GraphNode>()
  for (const n of graphNodes) nodeById.set(n.id, n)

  // --- Structural validation: edges must reference known nodes (trigger ok) ---
  const validEdges: GraphEdge[] = []
  for (const e of edges) {
    const sourceOk = e.source === TRIGGER_ID || nodeById.has(e.source)
    const targetOk = nodeById.has(e.target)
    if (!sourceOk) errors.push(`Edge from unknown node '${e.source}'`)
    if (!targetOk) errors.push(`Edge to unknown node '${e.target}'`)
    if (sourceOk && targetOk) validEdges.push(e)
  }

  // --- Per-node handler + option validation ---
  const compiledNodes: Record<string, CompiledNode> = {}
  for (const n of graphNodes) {
    const def = operationRegistry.get(n.type)
    if (!def) {
      errors.push(`Unknown operation type '${n.type}' (node '${n.key}')`)
    } else {
      // Option schema mismatches are warnings: raw options may carry {{ }}
      // tokens that only resolve at runtime.
      try {
        const parsed = def.optionsSchema.safeParse(n.options || {})
        if (!parsed.success && !hasTemplateTokens(n.options)) {
          const issue = parsed.error.issues?.[0]
          warnings.push(
            `Options for '${n.key}' (${n.type}) may be invalid: ${issue?.path?.join(".") || ""} ${issue?.message || ""}`.trim()
          )
        }
      } catch {
        // safeParse should not throw; ignore defensively.
      }
    }
    compiledNodes[n.id] = {
      id: n.id,
      key: n.key,
      type: n.type,
      options: n.options || {},
      next: { default: [], success: [], failure: [] },
    }
  }

  // --- Build adjacency over op-nodes (exclude the virtual trigger) ---
  const adjacency = new Map<string, string[]>()
  const indegree = new Map<string, number>()
  for (const id of nodeById.keys()) {
    adjacency.set(id, [])
    indegree.set(id, 0)
  }

  const triggerTargets: string[] = []
  for (const e of validEdges) {
    if (e.source === TRIGGER_ID) {
      triggerTargets.push(e.target)
      continue
    }
    adjacency.get(e.source)!.push(e.target)
    indegree.set(e.target, (indegree.get(e.target) || 0) + 1)

    // Record the branch handle on the source node.
    const bucket =
      e.sourceHandle === "success" || e.sourceHandle === "failure"
        ? e.sourceHandle
        : "default"
    compiledNodes[e.source].next[bucket].push(e.target)
  }

  // --- Entrypoints: explicit trigger edges, else nodes with no incoming edge
  // (mirrors the executor's implicit-root synthesis). ---
  let entrypoints = Array.from(new Set(triggerTargets))
  if (entrypoints.length === 0) {
    entrypoints = Array.from(nodeById.keys()).filter((id) => (indegree.get(id) || 0) === 0)
  }
  if (graphNodes.length > 0 && entrypoints.length === 0) {
    errors.push("Graph has no entrypoint (every node has an incoming edge — cycle at the root)")
  }

  // --- Kahn topological sort → levels; leftover nodes ⇒ cycle ---
  const workIndegree = new Map(indegree)
  // Seed the queue with entrypoints + any other zero-indegree nodes.
  let frontier = Array.from(nodeById.keys()).filter((id) => (workIndegree.get(id) || 0) === 0)
  const levels: string[][] = []
  let processed = 0
  const seen = new Set<string>()

  while (frontier.length > 0) {
    const level = frontier.filter((id) => !seen.has(id))
    if (level.length === 0) break
    levels.push(level)
    const nextFrontier: string[] = []
    for (const id of level) {
      seen.add(id)
      processed++
      for (const target of adjacency.get(id) || []) {
        workIndegree.set(target, (workIndegree.get(target) || 0) - 1)
        if ((workIndegree.get(target) || 0) === 0) nextFrontier.push(target)
      }
    }
    frontier = nextFrontier
  }

  if (processed < nodeById.size) {
    errors.push(
      `Graph contains a cycle (${nodeById.size - processed} node(s) unreachable in topological order)`
    )
  }

  const base: Omit<CompiledPlan, "hash"> = {
    version: COMPILED_PLAN_VERSION,
    ok: errors.length === 0,
    errors,
    warnings,
    entrypoints,
    levels,
    nodes: compiledNodes,
  }

  return { ...base, hash: stableHash(base) }
}

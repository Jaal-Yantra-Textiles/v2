/**
 * Shared MCP core — tool classification + input-schema shaping.
 *
 * Single source of truth for the framework args injected onto every tool
 * (`context`, `dry_run`, and `confirm`/`reason` for guarded tools) and for the
 * sensitivity classification the dispatcher enforces. Both consumers — the
 * JSON-RPC `tools/list` and the in-app assistant's AI-SDK tool binding — call
 * these so they present identical schemas and guidance.
 */
import type { McpToolDef } from "./types"

/** A tool is sensitive if flagged, dangerous, or a DELETE (implicitly). */
export const isSensitive = (def: McpToolDef): boolean =>
  !!def.sensitive || !!def.dangerous || def.method === "DELETE"

/** A tool is dangerous (platform-destructive) only when explicitly flagged. */
export const isDangerous = (def: McpToolDef): boolean => !!def.dangerous

/**
 * Fold the declarative guidance fields (`sideEffects`, `nextSteps`) into a
 * short suffix appended to the model-facing description. Returns "" when a tool
 * declares neither, so untouched tools are unaffected.
 */
export const renderToolGuidance = (def: McpToolDef): string => {
  const parts: string[] = []
  if (def.sideEffects) parts.push(`Side effects: ${def.sideEffects}`)
  if (def.nextSteps?.length)
    parts.push(`Usually followed by: ${def.nextSteps.join(", ")}.`)
  return parts.length ? `\n${parts.join(" ")}` : ""
}

/**
 * Build the full JSON Schema for a tool, injecting the framework args
 * (`context`, `dry_run`, and `confirm`/`reason` for guarded tools) onto the
 * domain schema. Used by both `tools/list` and the chat route's tool binding so
 * the model/clients know these switches exist.
 */
export const buildToolInputSchema = (
  def: McpToolDef
): Record<string, any> => {
  const base = def.inputSchema || { type: "object", properties: {} }
  const properties = { ...(base.properties || {}) }

  // Injected on EVERY tool. Lets the model state what it is trying to
  // accomplish — most valuable for multi-step goals. Forwarded to the route as
  // the `x-mcp-context` header for telemetry and echoed on dry_run/confirmation
  // plans so approval cards show intent.
  properties.context = {
    type: "string",
    description:
      "One sentence on what you are ultimately trying to accomplish with this call (and the broader goal if this is one step of several). Always set it — it improves results and helps diagnose multi-step flows.",
  }

  properties.dry_run = {
    type: "boolean",
    description:
      "Preview only: return the planned request (and, for writes, the current object) WITHOUT executing. Use this to inspect data before making a change.",
  }
  if (isSensitive(def)) {
    properties.confirm = {
      type: "boolean",
      description:
        "This is a sensitive/destructive action. It will NOT run unless confirm=true. Do not set this yourself — the user must approve it.",
    }
  }
  if (isDangerous(def)) {
    properties.reason = {
      type: "string",
      description:
        "This is a PLATFORM-DESTRUCTIVE action. It will NOT run without a human-supplied reason explaining why (audited). Ask the user for the reason; do not invent one.",
    }
  }

  return { ...base, properties }
}

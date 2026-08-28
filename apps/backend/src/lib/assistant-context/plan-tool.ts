/**
 * The `run_plan` tool — the assistant's entry point into the plan executor.
 *
 * Without this, a request that needs several tools ("orders for customer X")
 * forces the model to chain raw tool calls itself: resolve the reference,
 * remember the id, pass it to the next tool. That is where single-tool turns
 * fail — the model invents a filter syntax or passes a name where an id belongs.
 *
 * This tool exposes the structured alternative. The model emits ONE plan; the
 * executor (lib/mcp-core/plan) runs it with reference substitution, map fan-out,
 * deterministic empty-result retry, and entity-memory `resolve` steps. Every
 * step still dispatches through the surface's real dispatcher, so the
 * dry_run / confirm / reason rails and scope checks apply per step.
 *
 * Shared by the admin and partner assistants — a surface supplies its own
 * dispatcher and (optionally) its cache-backed entity resolver.
 */
import { tool, jsonSchema } from "ai"
import {
  executeMcpPlan,
  PLAN_SCOPE_GUIDANCE,
  type McpContext,
  type McpToolDef,
  type McpToolResult,
  type McpPlanStep,
  type McpPlanResult,
  type EntityResolver,
} from "../mcp-core"

export const PLAN_TOOL_NAME = "run_plan"

/**
 * Model-facing description. Always visible (the tool is added to the active
 * slice on every turn), so it doubles as the prompt guidance for planning.
 */
export const PLAN_TOOL_DESCRIPTION =
  "Run a MULTI-STEP plan over the tools you have, when a request needs several " +
  "calls chained together (look up an entity, then list/act on it; or repeat a " +
  "tool for each item of a list). Each step still respects dry_run / confirm / " +
  "reason rails. " +
  "A step is ONE of:\n" +
  "- Tool call: {\"tool\": name, \"args\": {...}, \"as\": name|null, \"extract\": \"path\"|null}. " +
  "\"as\" stores the full result under that name; \"extract\" pulls one value out of it " +
  "(a dot/bracket path into the result data, e.g. \"customers.0.id\") and stores that instead.\n" +
  "- Resolve: {\"resolve\": \"<entity_type>\", \"by\": \"<natural_key>\", \"value\": \"<value>\", \"as\": name, " +
  "\"fallback\": {\"tool\": name, \"args\": {...}, \"extract\": \"path\"|null}}. Resolves an entity id " +
  "from memory by a natural key (email/name/handle) without re-running the lookup tool; the " +
  "fallback lookup runs only when memory misses.\n" +
  "- Map: {\"map\": \"<listName>\", \"item\": \"var\", \"steps\": [...]}. Iterates a stored list and " +
  "runs the sub-steps once per item.\n" +
  "Reference stored values as \"$name\" (whole value) or \"$name.path\" (a field). " +
  PLAN_SCOPE_GUIDANCE

/**
 * Recursive JSON Schema for the plan grammar. `$defs` + `$ref` keep the
 * `steps` and `fallback` shapes nestable; `jsonSchema` (AI SDK 5) passes the
 * schema through to the provider untouched, so the recursion is preserved.
 */
export const PLAN_INPUT_SCHEMA: Record<string, any> = {
  type: "object",
  properties: {
    steps: {
      type: "array",
      items: { $ref: "#/$defs/step" },
      description: "The ordered plan steps to execute.",
    },
  },
  required: ["steps"],
  additionalProperties: false,
  $defs: {
    step: {
      type: "object",
      properties: {
        tool: {
          type: "string",
          description: "Tool name from the catalog to call.",
        },
        args: {
          type: "object",
          description: "Arguments. Reference stored values as $name or $name.path.",
          additionalProperties: true,
        },
        as: {
          type: ["string", "null"],
          description: "Store the full result data under this name for later $refs.",
        },
        extract: {
          type: ["string", "null"],
          description:
            "Dot/bracket path into the result data to store under `as` (e.g. 'customers.0.id').",
        },
        resolve: {
          type: "string",
          description: "Entity type to resolve from memory by a natural key (skip the lookup tool).",
        },
        by: {
          type: "string",
          description: "Natural key field to resolve by, e.g. 'email'.",
        },
        value: {
          type: "string",
          description: "The key's value to resolve, e.g. 'delhi@gmail.com'.",
        },
        fallback: { $ref: "#/$defs/fallback" },
        map: {
          type: "string",
          description: "Name of a stored list to iterate over (plural asks).",
        },
        item: {
          type: "string",
          description: "Loop variable name; reference it as $var.field inside sub-steps.",
        },
        steps: { type: "array", items: { $ref: "#/$defs/step" } },
      },
    },
    fallback: {
      type: "object",
      properties: {
        tool: { type: "string" },
        args: { type: "object", additionalProperties: true },
        extract: { type: ["string", "null"] },
      },
      required: ["tool"],
    },
  },
}

export type RunPlanOptions = {
  ctx: McpContext
  tools: McpToolDef[]
  dispatch: (name: string, args: Record<string, unknown>) => Promise<McpToolResult>
  /** Cache-backed resolver consulted by `resolve` steps. Omit for no memory. */
  resolveEntity?: EntityResolver
}

/**
 * Run a plan through the executor. Split out from the tool wrapper so the
 * wiring is testable without the AI SDK.
 */
export function runAssistantPlan(
  opts: RunPlanOptions,
  steps: McpPlanStep[]
): Promise<McpPlanResult> {
  return executeMcpPlan({
    ctx: opts.ctx,
    tools: opts.tools,
    dispatch: opts.dispatch,
    resolveEntity: opts.resolveEntity,
    plan: { steps },
  })
}

/**
 * Build the AI-SDK `run_plan` tool for a surface. `cap`, when given, bounds a
 * large (map fan-out) result before it is handed back to the model.
 */
export function buildRunPlanTool(
  opts: RunPlanOptions & { cap?: (result: unknown) => unknown }
) {
  return tool({
    description: PLAN_TOOL_DESCRIPTION,
    inputSchema: jsonSchema(PLAN_INPUT_SCHEMA),
    execute: async (input: any) => {
      const steps: McpPlanStep[] = Array.isArray(input?.steps) ? input.steps : []
      const result = await runAssistantPlan(opts, steps)
      return opts.cap ? opts.cap(result) : result
    },
  })
}
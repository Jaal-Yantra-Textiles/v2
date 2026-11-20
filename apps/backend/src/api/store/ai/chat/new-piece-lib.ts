/**
 * Starting another piece, and going back to one, handled by the route rather
 * than the model (#2556).
 *
 * Asked for "the matching trousers", the model wrote "Design created ✅" with
 * a made-up id three turns running instead of calling start_new_design (prod,
 * 2026-11-19), and it never called switch_design on its own. So when the ask
 * is clear, the route does it before the model runs and streams the result as
 * an ordinary tool part; the page treats it exactly like the model's call.
 *
 * "Clear" is decided, in order, by:
 *   1. the "+ Another design" button (`context.new_piece`) — always a new piece;
 *   2. a System One judgment (design-chat-intent.ts), when a classifier row
 *      serves its scope and the answer is confident;
 *   3. the word rules (design-new-piece-intent.ts) — when 2 is off or unsure.
 */
import type { MedusaContainer } from "@medusajs/framework"
import { createUIMessageStream, type UIMessageChunk } from "ai"
import { judgeDesignTurn, type OpenDesign } from "../../../../mastra/agents/design-chat-intent"
import { detectNewPieceIntent } from "../../../../mastra/agents/design-new-piece-intent"
import {
  runStartNewDesign,
  runSwitchDesign,
  type DesignCard,
  type StartNewDesignResult,
} from "../../../../mastra/agents/tools/storefront-design-multi"
import type { DesignContext } from "../../../../mastra/agents/tools/storefront-design-flow"
import type { StoreAiChatReq } from "./validators"

export type ServerTurnAction =
  | { tool: "start_new_design"; output: StartNewDesignResult; decidedBy: "button" | "judgment" | "words" }
  | { tool: "switch_design"; output: DesignCard; decidedBy: "judgment" }

const lastTextOf = (messages: StoreAiChatReq["messages"] | undefined, role: string): string => {
  const last = [...(messages ?? [])].reverse().find((m: any) => m?.role === role) as any
  if (!last) return ""
  return Array.isArray(last.parts)
    ? last.parts
        .filter((p: any) => p?.type === "text" && typeof p.text === "string")
        .map((p: any) => p.text)
        .join(" ")
    : String(last.content ?? "")
}

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const startPiece = async (
  container: MedusaContainer,
  context: DesignContext,
  productType: string | null
): Promise<StartNewDesignResult | null> => {
  const started = await runStartNewDesign(
    container,
    productType ? { product_type: productType, name: titleCase(productType) } : {},
    context
  ).catch(() => null)
  return started && "design_id" in started ? started : null
}

/**
 * Do what the maker clearly asked for this turn, or null — when they did not,
 * or when it was refused (not signed in, too many designs, rate limit). The
 * model then handles the turn as usual. Mutates `context` like the tools do.
 */
export const routeDesignTurn = async (
  container: MedusaContainer,
  context: DesignContext,
  body: StoreAiChatReq
): Promise<ServerTurnAction | null> => {
  if (!context.customer_id || !context.design_id) return null

  const lastUserText = lastTextOf(body.messages, "user")
  const ids = [context.design_id, ...(context.designs ?? []).map((d) => d.design_id)]
  const designService: any = container.resolve("design" as any)
  const rows: any[] = await designService
    .listDesigns({ id: ids }, { take: 20, select: ["id", "name", "product_type"] })
    .catch(() => [])
  const row = (id: string) => rows.find((r) => r.id === id)
  const activeGarment: string | null = row(context.design_id)?.product_type ?? null
  const others: OpenDesign[] = ids.slice(1).map((id) => ({
    design_id: id,
    garment: row(id)?.product_type ?? null,
    name: row(id)?.name ?? null,
  }))

  // 1. The button.
  if (body.context?.new_piece === true) {
    const intent = detectNewPieceIntent({
      lastUserText,
      activeGarment,
      openGarments: others.map((o) => o.garment),
      explicit: true,
    })
    const output = await startPiece(container, context, intent?.product_type ?? null)
    return output ? { tool: "start_new_design", output, decidedBy: "button" } : null
  }

  // Without a garment on the active design, a garment named now is ITS brief.
  if (!activeGarment) return null

  // 2. The judgment.
  const judged = await judgeDesignTurn(container, {
    lastUserText,
    lastAssistantText: lastTextOf(body.messages, "assistant"),
    activeGarment,
    others,
  })
  if (judged?.action === "stay") return null
  if (judged?.action === "switch") {
    const output = await runSwitchDesign(container, judged.design_id, context).catch(() => null)
    return output ? { tool: "switch_design", output, decidedBy: "judgment" } : null
  }
  if (judged?.action === "new_piece") {
    const output = await startPiece(container, context, judged.product_type)
    return output ? { tool: "start_new_design", output, decidedBy: "judgment" } : null
  }

  // 3. The word rules.
  const intent = detectNewPieceIntent({
    lastUserText,
    activeGarment,
    openGarments: others.map((o) => o.garment),
  })
  if (!intent) return null
  const output = await startPiece(container, context, intent.product_type)
  return output ? { tool: "start_new_design", output, decidedBy: "words" } : null
}

/** What the model is told when the route has already acted this turn. */
export const serverActionNote = (action: ServerTurnAction): string => {
  const lines = ["# Already done this turn (by the system, not you)"]
  if (action.tool === "start_new_design") {
    const pt = action.output.product_type
    lines.push(
      `- A NEW design${pt ? ` for the ${pt}` : ""} has just been started and is now the ACTIVE design. The earlier designs stay saved; the maker sees a new tab for it.`,
      "- Do NOT call start_new_design or create_design this turn. Tell the maker the new piece is started, in one short line, and carry on with ITS brief" +
        (pt ? "." : ": first ask which garment it is.")
    )
  } else {
    const d = action.output
    lines.push(
      `- The maker went back to their ${d.product_type ?? "other"} design${d.name ? ` ("${d.name}")` : ""}; it is now the ACTIVE design and its tab is selected.`,
      "- Do NOT call switch_design this turn. Say in one short line where that design stands, then answer their message for it."
    )
  }
  lines.push("- Never write a design id to the maker.")
  return lines.join("\n")
}

/**
 * The route's action goes out FIRST, as a finished tool step, then the
 * model's reply. `result` is a streamText result.
 */
export const serverActionUIStream = (
  result: { toUIMessageStream: (opts?: any) => ReadableStream<UIMessageChunk> },
  action: ServerTurnAction,
  onError: (err: unknown) => string
): ReadableStream<UIMessageChunk> => {
  const toolCallId = `srv_${action.tool}_${action.output.design_id}`
  const input =
    action.tool === "start_new_design"
      ? { product_type: action.output.product_type ?? undefined }
      : { design_id: action.output.design_id }
  return createUIMessageStream({
    onError,
    execute: ({ writer }) => {
      writer.write({ type: "start" })
      writer.write({ type: "start-step" })
      writer.write({ type: "tool-input-available", toolCallId, toolName: action.tool, input })
      writer.write({ type: "tool-output-available", toolCallId, output: action.output })
      writer.write({ type: "finish-step" })
      writer.merge(result.toUIMessageStream({ sendStart: false, onError }))
    },
  })
}

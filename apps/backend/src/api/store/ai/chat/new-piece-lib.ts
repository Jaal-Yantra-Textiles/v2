/**
 * "Another piece" handled by the route, not the model (#2556).
 *
 * Asked for "the matching trousers", the model wrote "Design created ✅" with
 * a made-up id three turns running instead of calling start_new_design (prod,
 * 2026-11-19). When the ask is clear, the route starts the design itself
 * before the model runs and streams it to the page as an ordinary
 * start_new_design tool part.
 */
import type { MedusaContainer } from "@medusajs/framework"
import { createUIMessageStream, type UIMessageChunk } from "ai"
import { detectNewPieceIntent } from "../../../../mastra/agents/design-new-piece-intent"
import {
  runStartNewDesign,
  type StartNewDesignResult,
} from "../../../../mastra/agents/tools/storefront-design-multi"
import type { DesignContext } from "../../../../mastra/agents/tools/storefront-design-flow"
import type { StoreAiChatReq } from "./validators"

const lastUserTextOf = (messages: StoreAiChatReq["messages"] | undefined): string => {
  const lastUser = [...(messages ?? [])].reverse().find((m: any) => m?.role === "user") as any
  if (!lastUser) return ""
  return Array.isArray(lastUser.parts)
    ? lastUser.parts
        .filter((p: any) => p?.type === "text" && typeof p.text === "string")
        .map((p: any) => p.text)
        .join(" ")
    : String(lastUser.content ?? "")
}

/**
 * Start the maker's next piece when they clearly asked for one (#2556).
 * Returns null when they did not, or when starting it was refused (not signed
 * in, too many designs, rate limit) — the model then handles the turn as usual.
 */
export const startNewPieceIfAsked = async (
  container: MedusaContainer,
  context: DesignContext,
  body: StoreAiChatReq
): Promise<StartNewDesignResult | null> => {
  if (!context.customer_id || !context.design_id) return null

  const lastUserText = lastUserTextOf(body.messages)

  const ids = [context.design_id, ...(context.designs ?? []).map((d) => d.design_id)]
  const designService: any = container.resolve("design" as any)
  const rows: any[] = await designService
    .listDesigns({ id: ids }, { take: 20, select: ["id", "product_type"] })
    .catch(() => [])
  const garmentOf = (id: string) => rows.find((r) => r.id === id)?.product_type ?? null

  const intent = detectNewPieceIntent({
    lastUserText,
    activeGarment: garmentOf(context.design_id),
    openGarments: ids.slice(1).map(garmentOf),
    explicit: body.context?.new_piece === true,
  })
  if (!intent) return null

  const started = await runStartNewDesign(
    container,
    {
      ...(intent.product_type
        ? {
            product_type: intent.product_type,
            name: intent.product_type.charAt(0).toUpperCase() + intent.product_type.slice(1),
          }
        : {}),
    },
    context
  ).catch(() => null)
  return started && "design_id" in started ? started : null
}

/** What the model is told when the route has already started the next piece. */
export const startedPieceNote = (started: StartNewDesignResult): string =>
  [
    "# Already done this turn (by the system, not you)",
    `- A NEW design${started.product_type ? ` for the ${started.product_type}` : ""} has just been started and is now the ACTIVE design. The earlier designs stay saved; the maker sees a new tab for it.`,
    "- Do NOT call start_new_design or create_design this turn. Tell the maker the new piece is started, in one short line, and carry on with ITS brief" +
      (started.product_type ? "." : ": first ask which garment it is."),
    "- Never write a design id to the maker.",
  ].join("\n")



/**
 * The design the route started goes out FIRST, as a finished start_new_design
 * step, then the model's reply. `result` is a streamText result.
 */
export const startedPieceUIStream = (
  result: { toUIMessageStream: (opts?: any) => ReadableStream<UIMessageChunk> },
  started: StartNewDesignResult,
  onError: (err: unknown) => string
): ReadableStream<UIMessageChunk> => {
  const toolCallId = `srv_start_new_design_${started.design_id}`
  return createUIMessageStream({
    onError,
    execute: ({ writer }) => {
      writer.write({ type: "start" })
      writer.write({ type: "start-step" })
      writer.write({
        type: "tool-input-available",
        toolCallId,
        toolName: "start_new_design",
        input: { product_type: started.product_type ?? undefined },
      })
      writer.write({ type: "tool-output-available", toolCallId, output: started })
      writer.write({ type: "finish-step" })
      writer.merge(result.toUIMessageStream({ sendStart: false, onError }))
    },
  })
}

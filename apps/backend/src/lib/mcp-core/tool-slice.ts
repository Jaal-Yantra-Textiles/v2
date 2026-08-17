/**
 * Slice bookkeeping shared by every MCP chat surface.
 *
 * The per-surface slicers (admin, partners) are deliberately parallel modules
 * over different domain unions — that part is not duplication, it is two
 * registries. But the rule for reading a widening back out of history is not
 * surface-specific: it is a fact about the message shape the AI SDK emits, and
 * it was copied byte-for-byte into both. Two copies of a parser is two places to
 * fix when the transport changes its part shape.
 */

/**
 * Domains the model already widened into earlier in THIS conversation.
 *
 * The slice is recomputed per HTTP request from keywords, and the chat routes
 * strip tool parts from history — so without this a domain bought with a
 * `load_*_tools` round trip on turn N is silently gone on turn N+1, and the
 * model has no transcript evidence it ever had it. A follow-up like "now do the
 * same for the other one" re-pays the widening AND burns one of the steps.
 *
 * Reads the RAW inbound messages (before a route's text-only normalisation),
 * and only ever returns domains on `selectable`, so a malformed or adversarial
 * history part can widen nothing it could not widen by asking.
 */
export function widenedDomainsFromHistory<D extends string>(
  rawMessages: unknown,
  opts: { loadToolName: string; selectable: readonly D[] }
): D[] {
  const selectable = new Set<string>(opts.selectable)
  const found = new Set<D>()

  for (const m of Array.isArray(rawMessages) ? rawMessages : []) {
    const parts = Array.isArray((m as any)?.parts) ? (m as any).parts : []
    for (const p of parts) {
      const isLoadCall =
        p?.type === `tool-${opts.loadToolName}` ||
        (p?.type === "dynamic-tool" && p?.toolName === opts.loadToolName)
      if (!isLoadCall) continue
      // The call's own args are the reliable half; the result echoes them back,
      // so read both and let the allow-list below discard anything odd.
      for (const d of [
        ...(Array.isArray(p?.input?.domains) ? p.input.domains : []),
        ...(Array.isArray(p?.output?.domains) ? p.output.domains : []),
      ]) {
        if (typeof d === "string" && selectable.has(d)) {
          found.add(d as D)
        }
      }
    }
  }

  return [...found]
}

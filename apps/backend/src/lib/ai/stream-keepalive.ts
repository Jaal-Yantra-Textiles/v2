/**
 * Keep a streaming AI response alive while the model is busy.
 *
 * The prod load balancer drops any connection that carries no bytes for 60 s.
 * An assistant turn can spend longer than that reading tool results and
 * planning before it streams a word (2026-10-08: a 107 s turn turning an
 * inbound email into an inventory order). The browser then reports "Couldn't
 * reach the server" while the server finishes the work anyway — so the
 * operator retries and a second copy of the turn runs alongside the first.
 *
 * Every `intervalMs` this writes an SSE comment line (": keep-alive"). Both
 * the AI SDK client parser and EventSource ignore comment lines, so nothing
 * changes on screen. The AI SDK writes each event in one `write`, so a comment
 * between writes can never split an event.
 *
 * Call it AFTER `pipeUIMessageStreamToResponse` (which writes the headers);
 * it stops itself when the response finishes or the client goes away.
 */
type StreamingResponse = {
  headersSent: boolean
  writableEnded: boolean
  destroyed?: boolean
  write: (chunk: string) => boolean
  once: (event: "close" | "finish", fn: () => void) => unknown
}

export const KEEPALIVE_INTERVAL_MS = 15_000

export function keepStreamAlive(res: StreamingResponse, intervalMs = KEEPALIVE_INTERVAL_MS): () => void {
  const timer = setInterval(() => {
    if (res.writableEnded || res.destroyed) return stop()
    if (!res.headersSent) return
    try {
      res.write(": keep-alive\n\n")
    } catch {
      stop()
    }
  }, intervalMs)
  // Never hold the process open for a heartbeat.
  ;(timer as any).unref?.()

  function stop() {
    clearInterval(timer)
  }
  res.once("close", stop)
  res.once("finish", stop)
  return stop
}

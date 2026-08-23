/**
 * Reading a JSON object out of whatever a model actually returned.
 *
 * ## Why this exists
 *
 * Every AI feature here calls an agent with `{ output: someZodSchema }` and
 * then reads `response.object`. That works only when the underlying model
 * honours structured output — and this app deliberately runs on free/rotating
 * models, several of which do not.
 *
 * Found live on `stealth/ox-alpha` (picked by `dynamicFreeTextModel` from the
 * OpenRouter free pool): the answer was correct and arrived as **markdown prose
 * in `response.text`, with `response.object` UNDEFINED**. Everything reading
 * `.object` threw or silently degraded.
 *
 * 🔑 The trap worth remembering: that model **advertises `response_format` in
 * its `supported_parameters`**. Filtering the pool on advertised capability
 * would not have saved us. A capability flag is a claim, not a guarantee — so
 * the read path has to be tolerant regardless of which model was chosen.
 *
 * `textileProductExtraction` had already hand-rolled a fallback for exactly
 * this, with a lazy `\{...\}` regex that truncates on any nested object. That
 * is the reason this lives in one shared, tested place instead of being
 * re-solved per workflow.
 */

/**
 * PURE. The first BALANCED `{...}` or `[...]` in a string, code fences stripped.
 *
 * Scans for the matching brace rather than regexing. A lazy `\{[\s\S]*?\}` stops
 * at the first `}` — which, on any response containing a nested object, yields
 * invalid JSON or a silently truncated one.
 */
export function extractJsonBlock(text: string): string | null {
  if (typeof text !== "string" || !text.trim()) return null

  const unfenced = text.replace(/```(?:json|JSON)?/g, "")

  // Whichever delimiter appears FIRST wins. Always trying "{" first returns the
  // first ELEMENT of a top-level array (`[{"a":1},…]` → `{"a":1}`) — a valid
  // object, silently missing every other item.
  const candidates = ([
    ["{", "}"],
    ["[", "]"],
  ] as const)
    .map(([open, close]) => ({ open, close, start: unfenced.indexOf(open) }))
    .filter((c) => c.start !== -1)
    .sort((a, b) => a.start - b.start)

  for (const { open, close, start } of candidates) {

    let depth = 0
    let inString = false
    let escaped = false

    for (let i = start; i < unfenced.length; i++) {
      const ch = unfenced[i]

      // Braces inside a string literal are text, not structure. Without this a
      // reasoning field containing "}" closes the object early.
      if (inString) {
        if (escaped) escaped = false
        else if (ch === "\\") escaped = true
        else if (ch === '"') inString = false
        continue
      }
      if (ch === '"') {
        inString = true
        continue
      }
      if (ch === open) depth++
      else if (ch === close) {
        depth--
        if (depth === 0) return unfenced.slice(start, i + 1)
      }
    }
  }

  return null
}

/**
 * PURE. Get the model's structured answer, however it chose to send it.
 *
 *   1. `object` — the model honoured the schema.
 *   2. JSON parsed out of `text` — fenced or bare, brace-matched.
 *
 * Returns null when neither yields an object. Null means "the model did not
 * give us a usable answer", which callers should treat as a failure of THIS
 * call rather than as an empty result: `response.object || {}` turns a model
 * that answered in prose into a silently empty extraction.
 */
export function readModelJson(response: {
  object?: unknown
  text?: unknown
}): unknown | null {
  const obj = response?.object
  if (obj && typeof obj === "object") return obj

  const text = typeof response?.text === "string" ? response.text : ""
  const block = extractJsonBlock(text)
  if (!block) return null

  try {
    const parsed = JSON.parse(block)
    return parsed && typeof parsed === "object" ? parsed : null
  } catch {
    return null
  }
}

/**
 * `readModelJson` that throws a diagnosable error instead of returning null.
 *
 * For callers whose whole step is the extraction — there is nothing sensible to
 * continue with, and a thrown error naming the model's actual words is far
 * easier to debug than a downstream `undefined`.
 */
export function readModelJsonOrThrow(
  response: { object?: unknown; text?: unknown },
  context: string
): unknown {
  const value = readModelJson(response)
  if (value !== null) return value

  const text = typeof response?.text === "string" ? response.text : ""
  throw new Error(
    `${context}: model returned no readable JSON. Response began: ${
      text.slice(0, 200) || "(empty)"
    }`
  )
}

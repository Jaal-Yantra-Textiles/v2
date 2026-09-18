/**
 * Making a Meta template parameter safe to carry PROSE.
 *
 * Today every template variable is a name, an id, a day-count or a quantity —
 * `vars: [partnerName, designName, runId, String(daysSinceAssignment)]`. None of
 * those can contain a newline, so nothing in the send path has ever needed to
 * care, and nothing does: `send-whatsapp.ts` builds parameters with
 *
 *     parameters: variableValues.map((text) => ({ type: "text", text }))
 *
 * raw, with no cleaning and no length cap.
 *
 * 🔴 That becomes reachable the moment a template variable carries generated
 * text. **Meta rejects a body parameter containing a newline, a tab, or more
 * than 4 consecutive spaces**, and prose contains newlines essentially always.
 * The first prose reminder would be rejected — and per #1279, a rejected send
 * used to still burn the reminder's cap, which is how runs got parked having
 * never been asked.
 *
 * So this is not a formatting nicety. It is the difference between a reminder
 * channel that works and one that fails closed on its first message.
 *
 * The rule is deliberately applied to EVERY parameter, not just prose ones. A
 * design name pasted from a spreadsheet can carry a tab; a partner name can
 * carry a trailing newline. Those would have been rejected too, silently, and
 * nobody would have connected the rejection to the whitespace.
 */

/**
 * Meta's body limit is 1024 characters for the rendered message. A parameter
 * has to fit INSIDE the template's own scaffolding, so the cap here is lower
 * than the limit on purpose — the scaffolding of a prose carrier ("JYT update:
 * … — Jaal Yantra Textiles") plus a long parameter must still land under 1024.
 *
 * 700 leaves room for roughly 300 characters of scaffolding, which is far more
 * than any carrier template needs.
 */
export const TEMPLATE_PARAM_MAX_LENGTH = 700

/**
 * Collapse everything Meta refuses into a single space.
 *
 * `\s` covers newline, carriage return, tab and the ordinary space, so one
 * rule handles all three prohibited classes at once — including the
 * "more than 4 consecutive spaces" case, since any run collapses to one.
 */
const FORBIDDEN_WHITESPACE = /\s+/g

/**
 * Characters that are not whitespace but still break a parameter: the Unicode
 * line/paragraph separators, and the zero-width / bidi controls that survive a
 * copy-paste out of a design tool and render as mojibake on a phone.
 */
// Built from a string on purpose: writing U+2028/U+2029 literally into a
// regex literal puts real line terminators in the SOURCE, which does not parse.
const INVISIBLE_CONTROLS = new RegExp("[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u2028\u2029\u202A-\u202E\uFEFF]", "g")

export type SanitizedParam = {
  /** The value safe to hand to Meta. */
  text: string
  /** True when the input was altered — worth logging, never worth failing on. */
  changed: boolean
  /** True when the value was cut to fit. The reader lost words; say so. */
  truncated: boolean
}

/**
 * Make one template parameter safe.
 *
 * Never throws and never returns an empty string for a non-empty input: an
 * empty body parameter makes Meta reject the whole send with a parameter-count
 * mismatch, which would turn "this text was all whitespace" into "this template
 * is broken". A single space is a legitimate value; nothing is not.
 */
export function sanitizeTemplateParam(
  value: unknown,
  maxLength: number = TEMPLATE_PARAM_MAX_LENGTH
): SanitizedParam {
  const original = typeof value === "string" ? value : String(value ?? "")

  const cleaned = original
    .replace(INVISIBLE_CONTROLS, "")
    .replace(FORBIDDEN_WHITESPACE, " ")
    .trim()

  if (!cleaned.length) {
    // An input that was entirely whitespace or invisible controls. Not an
    // error — but an empty parameter is, so send a placeholder the reader can
    // at least recognise as missing rather than a send that fails outright.
    return { text: original.length ? "—" : "", changed: original.length > 0, truncated: false }
  }

  if (cleaned.length <= maxLength) {
    return { text: cleaned, changed: cleaned !== original, truncated: false }
  }

  // Cut on a word boundary when one is close to the limit, so the message ends
  // mid-sentence rather than mid-word. `…` signals to the reader that there was
  // more, which a hard cut does not.
  const hardCut = cleaned.slice(0, maxLength - 1)
  const lastSpace = hardCut.lastIndexOf(" ")
  const body = lastSpace > maxLength - 80 ? hardCut.slice(0, lastSpace) : hardCut

  return { text: `${body.trimEnd()}…`, changed: true, truncated: true }
}

/** Sanitize a whole parameter list, reporting what changed for the audit log. */
export function sanitizeTemplateParams(
  values: unknown[],
  maxLength: number = TEMPLATE_PARAM_MAX_LENGTH
): { texts: string[]; changedIndexes: number[]; truncatedIndexes: number[] } {
  const texts: string[] = []
  const changedIndexes: number[] = []
  const truncatedIndexes: number[] = []

  values.forEach((v, i) => {
    const r = sanitizeTemplateParam(v, maxLength)
    texts.push(r.text)
    if (r.changed) changedIndexes.push(i)
    if (r.truncated) truncatedIndexes.push(i)
  })

  return { texts, changedIndexes, truncatedIndexes }
}

/**
 * #2377 S3 — an email body as plain text a model (or a person) can read.
 *
 * Shop confirmations are table soup. Collapsing every tag to a space (what
 * the old order parser did) runs the item name, quantity and price of every
 * row into one line, so the row structure is kept: a table row becomes a
 * line, its cells are joined with " | ", and block elements break lines.
 */
const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&rupee;": "₹",
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&[a-z]+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? " ")
}

/** Apply a removal until nothing changes: one pass over "<scr<script>ipt>"
 *  leaves a "<script" behind. */
function removeAll(input: string, pattern: RegExp): string {
  let out = input
  let prev: string
  do {
    prev = out
    out = out.replace(pattern, "")
  } while (out !== prev)
  return out
}

export function htmlToText(html: string): string {
  let stripped = removeAll(html, /<(style|script|head|title)[^>]*>[\s\S]*?<\/\1\s*>/gi)
  stripped = removeAll(stripped, /<!--[\s\S]*?-->/g)
  const text = stripped
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(td|th)>/gi, " | ")
    .replace(/<\/(tr|p|div|li|h[1-6]|table|section|header|footer)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
  // Whatever tags remain, until none do; a stray "<" or ">" left over is not
  // a tag, so it is dropped rather than kept as markup-looking text.
  const noTags = removeAll(text.replace(/<[^>]+>/g, " "), /<[^>]+>/g).replace(/[<>]/g, " ")
  return decodeEntities(noTags)
    .split("\n")
    .map((line) =>
      line
        .replace(/[ \t ]+/g, " ")
        .replace(/(\s*\|\s*)+/g, " | ")
        .replace(/^\s*\|\s*|\s*\|\s*$/g, "")
        .trim()
    )
    .filter(Boolean)
    .join("\n")
}

/** The readable body: the text part when the sender sent one with content,
 *  else the HTML flattened, capped so one huge newsletter can't flood a
 *  model's context. */
export function emailBodyText(
  email: { text_body?: string | null; html_body?: string | null },
  maxChars = 20_000
): { text: string; truncated: boolean } {
  const fromHtml = email.html_body ? htmlToText(email.html_body) : ""
  const plain = (email.text_body ?? "").trim()
  // Many shops send a token text part ("view this email in a browser");
  // prefer the HTML when it carries clearly more.
  const text = plain && plain.length >= fromHtml.length * 0.5 ? plain : fromHtml || plain
  return text.length > maxChars
    ? { text: text.slice(0, maxChars), truncated: true }
    : { text, truncated: false }
}

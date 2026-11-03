/**
 * Pure helpers for a company's update letter to its investors
 * (`POST /admin/companies/:id/send-update`).
 *
 * The letter goes to each investor on its own — one email per address, so no
 * investor ever sees another's address.
 */

export const INVESTOR_UPDATE_TEMPLATE_KEY = "investor-update"

/**
 * Manually provisioned stakes create investors with a synthesized placeholder
 * address (`manual-…@captable.local`, see `POST /admin/cap-tables/:id/stakes`).
 * Nothing can be delivered there.
 */
const PLACEHOLDER_DOMAIN = "@captable.local"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type UpdateInvestorLike = {
  id: string
  name?: string | null
  email?: string | null
}

export type UpdateRecipient = { investor_id: string; name: string; email: string }
export type SkippedRecipient = { investor_id: string; name: string; reason: string }

/**
 * Who receives the letter. `onlyIds` narrows to the named investors; an id
 * that is not one of the company's investors is reported, never mailed.
 * One email per address even when two investor rows share it.
 */
export function planUpdateRecipients(
  investors: UpdateInvestorLike[],
  onlyIds?: string[] | null
): { recipients: UpdateRecipient[]; skipped: SkippedRecipient[] } {
  const wanted = onlyIds?.length ? new Set(onlyIds) : null
  const recipients: UpdateRecipient[] = []
  const skipped: SkippedRecipient[] = []
  const seenEmail = new Set<string>()
  const seenId = new Set<string>()

  for (const inv of investors) {
    if (!inv?.id || seenId.has(inv.id)) continue
    seenId.add(inv.id)
    if (wanted && !wanted.has(inv.id)) continue
    const name = (inv.name ?? "").trim() || "Investor"
    const email = (inv.email ?? "").trim().toLowerCase()
    if (!email || !EMAIL_RE.test(email)) {
      skipped.push({ investor_id: inv.id, name, reason: "no email address" })
      continue
    }
    if (email.endsWith(PLACEHOLDER_DOMAIN)) {
      skipped.push({ investor_id: inv.id, name, reason: "placeholder address (added by hand, no real email)" })
      continue
    }
    if (seenEmail.has(email)) {
      skipped.push({ investor_id: inv.id, name, reason: `same address as another investor (${email})` })
      continue
    }
    seenEmail.add(email)
    recipients.push({ investor_id: inv.id, name, email })
  }

  if (wanted) {
    for (const id of wanted) {
      if (!seenId.has(id)) skipped.push({ investor_id: id, name: id, reason: "not an investor of this company" })
    }
  }
  return { recipients, skipped }
}

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")

const URL_RE = /\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g

const linkify = (escaped: string) =>
  escaped.replace(URL_RE, (url) => `<a href="${url}">${url}</a>`)

/**
 * The admin writes the letter as plain text: blank lines separate paragraphs,
 * lines starting with "- " or "• " become a bullet list, and bare http(s)
 * links become clickable. Everything is HTML-escaped first, so the text can
 * never inject markup into the email.
 */
export function updateMessageToHtml(message: string): string {
  const blocks = message.replace(/\r\n?/g, "\n").trim().split(/\n\s*\n/)
  return blocks
    .map((block) => {
      const lines = block.split("\n").map((l) => l.trim()).filter(Boolean)
      if (!lines.length) return ""
      const isBullet = (l: string) => /^[-•*]\s+/.test(l)
      if (lines.every(isBullet)) {
        const items = lines.map((l) => `<li>${linkify(escapeHtml(l.replace(/^[-•*]\s+/, "")))}</li>`)
        return `<ul>${items.join("")}</ul>`
      }
      return `<p>${lines.map((l) => linkify(escapeHtml(l))).join("<br>")}</p>`
    })
    .filter(Boolean)
    .join("\n")
}

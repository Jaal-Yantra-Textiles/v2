import { extractEmailBodyHtml, resolveBlogEmailHtml } from "../email-html"

const REACT_EMAIL_DOC = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN"><html dir="ltr" lang="en"><head><meta content="text/html; charset=UTF-8" http-equiv="Content-Type"/></head><body style="background-color:#ffffff"><table align="center" role="presentation"><tbody><tr><td><a href="https://cicilabel.com" style="background-color:#33348e">Shop</a></td></tr></tbody></table></body></html>`

describe("extractEmailBodyHtml", () => {
  it("keeps only the inside of <body> from a whole React Email document", () => {
    const out = extractEmailBodyHtml(REACT_EMAIL_DOC)
    expect(out.startsWith('<table align="center" role="presentation">')).toBe(true)
    expect(out).toContain('href="https://cicilabel.com"')
    expect(out).not.toMatch(/<\/?(html|head|body)\b/i)
    expect(out).not.toContain("DOCTYPE")
  })

  it("returns a fragment with no <body> unchanged", () => {
    expect(extractEmailBodyHtml("<p>Hello</p>")).toBe("<p>Hello</p>")
  })

  it("returns empty for empty input", () => {
    expect(extractEmailBodyHtml("")).toBe("")
  })
})

describe("resolveBlogEmailHtml", () => {
  const tiptapDoc = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "From the blog editor" }] }],
  }

  it("sends the Email-tab version when the page has one", () => {
    const out = resolveBlogEmailHtml({ content: tiptapDoc, email_html: REACT_EMAIL_DOC })
    expect(out).toContain('href="https://cicilabel.com"')
    expect(out).not.toContain("From the blog editor")
  })

  it("falls back to the TipTap converter when there is no email version", () => {
    const out = resolveBlogEmailHtml({ content: tiptapDoc, email_html: null })
    expect(out).toContain("From the blog editor")
  })

  it("falls back when the email version is blank", () => {
    const out = resolveBlogEmailHtml({ content: tiptapDoc, email_html: "   " })
    expect(out).toContain("From the blog editor")
  })
})

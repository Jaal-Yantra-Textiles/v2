/**
 * Converts TipTap editor JSON content to inline-styled HTML for email sending.
 *
 * Matches the styling used in the blog-post-content component
 * to ensure consistent appearance between the website and email.
 */

// Helper function to escape HTML in text content
function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

// Sanitize URLs — only allow http(s) and mailto protocols
function sanitizeUrl(url: string): string {
  const trimmed = (url || "").trim()
  if (/^(https?:|mailto:|\/)/i.test(trimmed)) {
    return trimmed.replace(/"/g, "&quot;")
  }
  return ""
}

// Sanitize a CSS value — strip anything that could be an injection
function sanitizeCssValue(value: string): string {
  return (value || "").replace(/[;{}()\\]/g, "").trim()
}

class TipTapToHTML {
  convert(doc: any): string {
    if (!doc || !doc.content) return ""

    const html = this.renderContent(doc.content)

    return `<div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif; color: #333; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 20px;">${html}</div>`
  }

  renderNode(node: any): string {
    if (!node) return ""

    switch (node.type) {
      case "text":
        return this.renderText(node)
      case "paragraph":
        return `<p style="margin-bottom: 1.5em; font-size: 16px;">${this.renderContent(node.content)}</p>`
      case "heading":
        return this.renderHeading(node)
      case "bulletList":
        return `<ul style="padding-left: 1.5em; margin-bottom: 1.5em;">${this.renderContent(node.content)}</ul>`
      case "orderedList": {
        const start = node.attrs?.start || 1
        return `<ol style="padding-left: 1.5em; margin-bottom: 1.5em;" start="${start}">${this.renderContent(node.content)}</ol>`
      }
      case "listItem":
        return `<li style="margin-bottom: 0.5em;">${this.renderContent(node.content)}</li>`
      case "codeBlock": {
        const code = node.content?.[0]?.text || ""
        return `<pre style="background-color: #f5f5f5; padding: 1em; border-radius: 4px; overflow-x: auto;"><code style="font-family: monospace;">${escapeHtml(code)}</code></pre>`
      }
      case "image":
        return this.renderImage(node)
      case "table":
        return `<table style="width: 100%; border-collapse: collapse; margin-bottom: 1.5em;">${this.renderContent(node.content)}</table>`
      case "tableRow":
        return `<tr>${this.renderContent(node.content)}</tr>`
      case "tableCell":
        return `<td style="border: 1px solid #e0e0e0; padding: 0.5em;">${this.renderContent(node.content)}</td>`
      case "tableHeader":
        return `<th style="border: 1px solid #e0e0e0; padding: 0.5em; font-weight: 600; background-color: #f9f9f9;">${this.renderContent(node.content)}</th>`
      case "blockquote":
        return `<blockquote style="border-left: 4px solid #e0e0e0; padding-left: 1em; margin-left: 0; margin-right: 0; font-style: italic; color: #555;">${this.renderContent(node.content)}</blockquote>`
      case "horizontalRule":
        return '<hr style="border: none; height: 1px; background-color: #e0e0e0; margin: 2em 0;" />'
      case "hardBreak":
        return "<br>"
      case "doc":
        return this.renderContent(node.content)
      default:
        // Unknown node — try to render children if any
        if (node.content && Array.isArray(node.content)) {
          return this.renderContent(node.content)
        }
        return ""
    }
  }

  renderText(node: any): string {
    let text = escapeHtml(node.text || "")

    if (node.marks) {
      for (const mark of node.marks) {
        text = this.applyMark(text, mark)
      }
    }

    return text
  }

  applyMark(text: string, mark: any): string {
    switch (mark.type) {
      case "bold":
        return `<strong style="font-weight: 600;">${text}</strong>`
      case "italic":
        return `<em style="font-style: italic;">${text}</em>`
      case "underline":
        return `<u style="text-decoration: underline;">${text}</u>`
      case "strike":
        return `<s style="text-decoration: line-through;">${text}</s>`
      case "code":
        return `<code style="font-family: monospace; background-color: #f5f5f5; padding: 0.2em 0.4em; border-radius: 3px; font-size: 0.9em;">${text}</code>`
      case "link": {
        const href = sanitizeUrl(mark.attrs?.href)
        if (!href) return text
        return `<a href="${href}" target="_blank" rel="noopener noreferrer" style="color: #0070f3; text-decoration: none; font-weight: 500;">${text}</a>`
      }
      case "textStyle":
        return this.applyTextStyle(text, mark.attrs)
      case "highlight": {
        const color = sanitizeCssValue(mark.attrs?.color || "yellow")
        return `<span style="background-color: ${color};">${text}</span>`
      }
      case "subscript":
        return `<sub>${text}</sub>`
      case "superscript":
        return `<sup>${text}</sup>`
      default:
        return text
    }
  }

  applyTextStyle(text: string, attrs: any): string {
    const styles: string[] = []
    if (attrs?.color) styles.push(`color: ${sanitizeCssValue(attrs.color)}`)
    if (attrs?.fontSize) styles.push(`font-size: ${sanitizeCssValue(attrs.fontSize)}`)
    if (attrs?.fontFamily) styles.push(`font-family: ${sanitizeCssValue(attrs.fontFamily)}`)

    return styles.length
      ? `<span style="${styles.join("; ")}">${text}</span>`
      : text
  }

  renderHeading(node: any): string {
    const level = Math.min(Math.max(node.attrs?.level || 2, 1), 6)
    const content = this.renderContent(node.content)

    const styles: Record<number, string> = {
      1: "font-size: 2em; font-weight: 700; margin-top: 1.5em; margin-bottom: 0.8em; color: #111;",
      2: "font-size: 1.5em; font-weight: 600; margin-top: 1.4em; margin-bottom: 0.7em; color: #222;",
      3: "font-size: 1.25em; font-weight: 600; margin-top: 1.3em; margin-bottom: 0.6em; color: #333;",
    }
    const style = styles[level] || "font-size: 1.1em; font-weight: 600; margin-top: 1.2em; margin-bottom: 0.5em; color: #444;"

    return `<h${level} style="${style}">${content}</h${level}>`
  }

  renderImage(node: any): string {
    const src = sanitizeUrl(node.attrs?.src)
    if (!src) return ""
    const alt = escapeHtml(node.attrs?.alt || "")
    const title = escapeHtml(node.attrs?.title || "")
    const width = node.attrs?.width ? `width="${parseInt(node.attrs.width, 10)}"` : ""
    const align = node.attrs?.align === "left" || node.attrs?.align === "right" ? node.attrs.align : "center"

    return `<div style="text-align: ${align}; margin: 1.5em 0;"><img src="${src}" alt="${alt}" title="${title}" ${width} style="max-width: 100%; height: auto; border-radius: 4px;"></div>`
  }

  renderContent(content: any[]): string {
    if (!content) return ""
    let html = ""
    for (const node of content) {
      html += this.renderNode(node)
    }
    return html
  }
}

/**
 * Converts TipTap JSON content to HTML.
 * @param content - TipTap JSON content (object, JSON string, or plain text)
 * @returns HTML string with inline email styling
 */
export function convertTipTapToHtml(content: any): string {
  try {
    let jsonContent: any

    if (typeof content === "string") {
      try {
        jsonContent = JSON.parse(content)
      } catch {
        // Not valid JSON — treat as plain text
        return `<p>${escapeHtml(content)}</p>`
      }
    } else {
      jsonContent = content
    }

    // Handle Map-like array structure [[key, value], ...]
    if (
      Array.isArray(jsonContent) &&
      jsonContent.length > 0 &&
      jsonContent.some((item) => Array.isArray(item) && item.length === 2)
    ) {
      const objFromMap: Record<string, any> = {}
      jsonContent.forEach(([key, value]: [string, any]) => {
        if (key && typeof key === "string") objFromMap[key] = value
      })
      jsonContent = objFromMap
    }

    // Find the doc structure
    let docContent: any = null

    if (jsonContent.type === "doc") {
      docContent = jsonContent
    } else if (jsonContent.text && jsonContent.text.type === "doc") {
      docContent = jsonContent.text
    } else if (jsonContent.content && Array.isArray(jsonContent.content)) {
      docContent = { type: "doc", content: jsonContent.content }
    } else {
      // Search any property for a doc structure
      for (const key in jsonContent) {
        const val = jsonContent[key]
        if (val && typeof val === "object") {
          if (val.type === "doc") {
            docContent = val
            break
          }
          if (key === "content" && Array.isArray(val)) {
            docContent = { type: "doc", content: val }
            break
          }
        }
      }
    }

    // Flat array of nodes
    if (!docContent && Array.isArray(jsonContent)) {
      docContent = { type: "doc", content: jsonContent }
    }

    if (!docContent) {
      return `<div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif; color: #333; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 20px;"><p style="margin-bottom: 1.5em; font-size: 16px;">Unable to process blog content. Please view the full article on our website.</p></div>`
    }

    const converter = new TipTapToHTML()
    return converter.convert(docContent)
  } catch (error) {
    console.error("Error converting TipTap content to HTML:", error)
    return typeof content === "string" ? escapeHtml(content) : ""
  }
}

export default TipTapToHTML

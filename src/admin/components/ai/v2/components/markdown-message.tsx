import React from "react"

const escapeHtml = (input: string) =>
  String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;")

const renderInlineMarkdown = (escaped: string) => {
  let s = escaped
  s = s.replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 rounded bg-ui-bg-base text-xs">$1</code>')
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold">$1</strong>')
  s = s.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, "$1<em class=\"italic\">$2</em>")
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a class="underline" href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
  return s
}

const renderMarkdownToHtml = (md: string) => {
  const src = String(md || "")
  const lines = src.split(/\r?\n/)

  let out = ""
  let inCode = false
  let codeBuffer: string[] = []
  let listType: "ul" | "ol" | null = null

  const closeList = () => {
    if (!listType) return
    out += listType === "ul" ? "</ul>" : "</ol>"
    listType = null
  }

  const flushCode = () => {
    const code = escapeHtml(codeBuffer.join("\n"))
    out += `<pre class="mt-2 mb-2 overflow-auto rounded bg-ui-bg-base p-2 text-xs"><code>${code}</code></pre>`
    codeBuffer = []
  }

  for (const rawLine of lines) {
    const line = String(rawLine)

    if (line.trim().startsWith("```")) {
      if (!inCode) {
        closeList()
        inCode = true
      } else {
        inCode = false
        flushCode()
      }
      continue
    }

    if (inCode) {
      codeBuffer.push(line)
      continue
    }

    if (/^\s*---\s*$/.test(line)) {
      closeList()
      out += '<hr class="my-3 border-ui-border-base" />'
      continue
    }

    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      closeList()
      const level = Math.min(6, h[1].length)
      const text = renderInlineMarkdown(escapeHtml(h[2] || ""))
      const cls =
        level === 1
          ? "text-lg font-semibold mt-2"
          : level === 2
            ? "text-base font-semibold mt-2"
            : "text-sm font-semibold mt-2"
      out += `<h${level} class="${cls}">${text}</h${level}>`
      continue
    }

    const ul = line.match(/^\s*[-*]\s+(.*)$/)
    if (ul) {
      const item = renderInlineMarkdown(escapeHtml(ul[1] || ""))
      if (listType !== "ul") {
        closeList()
        listType = "ul"
        out += '<ul class="mt-2 mb-2 list-disc pl-5 space-y-1">'
      }
      out += `<li>${item}</li>`
      continue
    }

    const ol = line.match(/^\s*(\d+)\.\s+(.*)$/)
    if (ol) {
      const item = renderInlineMarkdown(escapeHtml(ol[2] || ""))
      if (listType !== "ol") {
        closeList()
        listType = "ol"
        out += '<ol class="mt-2 mb-2 list-decimal pl-5 space-y-1">'
      }
      out += `<li>${item}</li>`
      continue
    }

    if (!line.trim()) {
      closeList()
      out += '<div class="h-2"></div>'
      continue
    }

    closeList()
    out += `<p class="text-sm leading-6">${renderInlineMarkdown(escapeHtml(line))}</p>`
  }

  if (inCode && codeBuffer.length) {
    inCode = false
    flushCode()
  }
  closeList()

  return out
}

export const MarkdownMessage: React.FC<{ value: string }> = ({ value }) => {
  const html = React.useMemo(() => renderMarkdownToHtml(value), [value])
  return <div className="break-words" dangerouslySetInnerHTML={{ __html: html }} />
}

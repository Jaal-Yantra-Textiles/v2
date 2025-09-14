"use client"

import React from "react"

type TipTapViewerProps = {
  doc: any
  className?: string
}

// Lightweight TipTap JSON -> HTML renderer without external deps
function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

function textWithMarks(textNode: any): string {
  const txt = escapeHtml(textNode.text || "")
  const marks = textNode.marks || []
  return marks.reduce((acc: string, m: any) => {
    switch (m.type) {
      case "bold":
        return `<strong>${acc}</strong>`
      case "italic":
        return `<em>${acc}</em>`
      case "strike":
        return `<s>${acc}</s>`
      case "code":
        return `<code>${acc}</code>`
      case "underline":
        return `<u>${acc}</u>`
      default:
        return acc
    }
  }, txt)
}

function renderNode(node: any): string {
  if (!node) return ""
  if (node.type === "text") {
    return textWithMarks(node)
  }
  const children = (node.content || []).map(renderNode).join("")
  switch (node.type) {
    case "heading": {
      const level = Math.min(Math.max(node.attrs?.level || 2, 1), 6)
      return `<h${level}>${children}</h${level}>`
    }
    case "paragraph":
      return children ? `<p>${children}</p>` : "<p></p>"
    case "bulletList":
      return `<ul>${children}</ul>`
    case "orderedList":
      return `<ol>${children}</ol>`
    case "listItem":
      return `<li>${children}</li>`
    case "blockquote":
      return `<blockquote>${children}</blockquote>`
    case "codeBlock": {
      const text = (node.content || [])
        .filter((n: any) => n.type === "text")
        .map((n: any) => escapeHtml(n.text || ""))
        .join("")
      return `<pre><code>${text}</code></pre>`
    }
    case "hardBreak":
      return "<br/>"
    default:
      return children
  }
}

function renderTipTapBody(doc: any): string {
  try {
    return (doc?.content || []).map(renderNode).join("")
  } catch {
    return ""
  }
}

export default function TipTapViewer({ doc, className }: TipTapViewerProps) {
  const html = React.useMemo(() => renderTipTapBody(doc), [doc])
  if (!html) return null
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />
}

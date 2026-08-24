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
      case "link": {
        // Dropped until now: an anchor mark fell through to `default`, so a
        // link the author wrote rendered as unclickable text with nothing to
        // say it had ever been one.
        const href = escapeHtml(m.attrs?.href || "")
        const target = m.attrs?.target
          ? ` target="${escapeHtml(m.attrs.target)}"`
          : ""
        return `<a href="${href}"${target} rel="noopener noreferrer">${acc}</a>`
      }
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

    /**
     * 🔴 These four cases are why this file was edited.
     *
     * An image, a video and an embed are all ATOM nodes: they carry their
     * payload in `attrs` and have no `content`. Falling through to `default`
     * returns `children`, which for an atom is the empty string — so every
     * picture and every video a partner inserted rendered as NOTHING, with no
     * error anywhere. The sibling viewer in `apps/storefront-starter` has
     * handled them for a while; this copy quietly did not.
     */
    case "image": {
      const src = escapeHtml(node.attrs?.src || "")
      const alt = escapeHtml(node.attrs?.alt || "")
      return src ? `<img src="${src}" alt="${alt}" class="tiptap-image" />` : ""
    }
    case "youtube":
    case "vimeo":
    case "embed": {
      // `youtube-nocookie` for the same reason as the starter: it is the host
      // content blockers leave alone, and a blank 16:9 hole gets reported by
      // nobody.
      const raw = String(node.attrs?.src || "")
      const src = escapeHtml(
        raw.replace(/^https:\/\/(www\.)?youtube\.com\//, "https://www.youtube-nocookie.com/")
      )
      if (!src) return ""
      return `<div class="tiptap-video-wrapper" style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden"><iframe src="${src}" title="Embedded video" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen style="position:absolute;top:0;left:0;width:100%;height:100%"></iframe></div>`
    }
    case "video": {
      const src = escapeHtml(node.attrs?.src || "")
      return src ? `<video controls class="tiptap-video" src="${src}"></video>` : ""
    }
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

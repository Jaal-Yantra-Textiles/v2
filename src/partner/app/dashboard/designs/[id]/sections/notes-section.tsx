"use client"

import { Container, Heading, Text } from "@medusajs/ui"
import React from "react"

// TipTap (ProseMirror-like) minimal types
interface MarkLinkAttrs { href?: string; target?: string }
interface Mark { type: "bold" | "italic" | "underline" | "strike" | "code" | "link"; attrs?: MarkLinkAttrs }
interface TextNode { type: "text"; text: string; marks?: Mark[] }
interface HardBreakNode { type: "hardBreak" }
interface ParagraphNode { type: "paragraph"; content?: InlineNode[] }
interface HeadingNode { type: "heading"; attrs?: { level?: number }; content?: InlineNode[] }
interface ListItemNode { type: "listItem"; content?: BlockNode[] }
interface BulletListNode { type: "bulletList"; content?: ListItemNode[] }
interface OrderedListNode { type: "orderedList"; content?: ListItemNode[] }
interface BlockquoteNode { type: "blockquote"; content?: BlockNode[] }
interface HorizontalRuleNode { type: "horizontalRule" }

type InlineNode = TextNode | HardBreakNode

type BlockNode =
  | ParagraphNode
  | HeadingNode
  | BulletListNode
  | OrderedListNode
  | BlockquoteNode
  | HorizontalRuleNode
  | { type: string; [k: string]: unknown }

interface TipTapDoc { type: "doc"; content?: BlockNode[] }

// Render helpers
function renderTextNode(node: TextNode, key: React.Key) {
  let content: React.ReactNode = node.text || ""
  const marks = node.marks || []
  for (const mark of marks) {
    switch (mark.type) {
      case "bold":
        content = <strong key={`${key}-b`}>{content}</strong>
        break
      case "italic":
        content = <em key={`${key}-i`}>{content}</em>
        break
      case "underline":
        content = <u key={`${key}-u`}>{content}</u>
        break
      case "strike":
        content = <s key={`${key}-s`}>{content}</s>
        break
      case "code":
        content = <code key={`${key}-c`} className="px-1 py-0.5 bg-ui-bg-subtle rounded border text-xs">{content}</code>
        break
      case "link": {
        const href = (mark.attrs as MarkLinkAttrs | undefined)?.href || "#"
        const target = (mark.attrs as MarkLinkAttrs | undefined)?.target || "_blank"
        content = (
          <a key={`${key}-a`} href={href} target={target} className="text-ui-fg-interactive hover:underline">
            {content}
          </a>
        )
        break
      }
      default:
        break
    }
  }
  return <React.Fragment key={key}>{content}</React.Fragment>
}

function renderInline(nodes: InlineNode[] = []) {
  return nodes.map((n, i) => {
    if (n.type === "text") return renderTextNode(n as TextNode, i)
    if (n.type === "hardBreak") return <br key={`br-${i}`} />
    return null
  })
}

function renderBlock(node: BlockNode, idx: number): React.ReactNode {
  switch (node.type) {
    case "paragraph": {
      const n = node as ParagraphNode
      return <p key={idx} className="mb-2">{renderInline(n.content)}</p>
    }
    case "heading": {
      const n = node as HeadingNode
      const level = Math.min(Math.max(n.attrs?.level ?? 2, 1), 6)
      const Tag = `h${level}` as keyof JSX.IntrinsicElements
      return <Tag key={idx} className="font-semibold mt-3 mb-2">{renderInline(n.content)}</Tag>
    }
    case "bulletList": {
      const n = node as BulletListNode
      return (
        <ul key={idx} className="list-disc pl-6 mb-2">
          {(n.content || []).map((li, i) => (
            <li key={i}>{(li.content || []).map((c, j) => renderBlock(c, j))}</li>
          ))}
        </ul>
      )
    }
    case "orderedList": {
      const n = node as OrderedListNode
      return (
        <ol key={idx} className="list-decimal pl-6 mb-2">
          {(n.content || []).map((li, i) => (
            <li key={i}>{(li.content || []).map((c, j) => renderBlock(c, j))}</li>
          ))}
        </ol>
      )
    }
    case "blockquote": {
      const n = node as BlockquoteNode
      return (
        <blockquote key={idx} className="border-l-2 pl-3 text-ui-fg-subtle italic mb-2">
          {(n.content || []).map((c, j) => renderBlock(c, j))}
        </blockquote>
      )
    }
    case "horizontalRule":
      return <hr key={idx} className="my-3" />
    default:
      // Unknown node fallback
      return (
        <pre key={idx} className="text-xs bg-ui-bg-subtle p-2 rounded border overflow-auto">
          {JSON.stringify(node, null, 2)}
        </pre>
      )
  }
}

export default function NotesSection({ designerNotes }: { designerNotes?: string | TipTapDoc | null }) {
  let doc: TipTapDoc | null = null

  if (typeof designerNotes === "string") {
    try {
      doc = JSON.parse(designerNotes) as TipTapDoc
    } catch {
      // treat plain string as a paragraph doc
      doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: designerNotes }] }] }
    }
  } else if (designerNotes && typeof designerNotes === "object") {
    doc = designerNotes as TipTapDoc
  }

  const isTipTap = doc && doc.type === "doc"
  const blocks = isTipTap ? (doc?.content || []) : []

  const hasContent = isTipTap && Array.isArray(blocks) && blocks.length > 0

  return (
    <Container className="p-0 divide-y">
      <div className="px-6 py-4 flex items-center justify-between">
        <Heading level="h3">Designer Notes</Heading>
      </div>
      <div className="px-6 py-4">
        {!hasContent ? (
          <Text size="small" className="text-ui-fg-subtle">No notes</Text>
        ) : (
          <div className="space-y-2 text-sm leading-6">
            {blocks.map((n, i) => renderBlock(n, i))}
            <details className="rounded-md border p-3 bg-ui-bg-base mt-2">
              <summary className="cursor-pointer select-none text-sm">View raw TipTap JSON</summary>
              <pre className="mt-2 max-h-64 overflow-auto text-xs whitespace-pre-wrap">{JSON.stringify(doc, null, 2)}</pre>
            </details>
          </div>
        )}
      </div>
    </Container>
  )
}

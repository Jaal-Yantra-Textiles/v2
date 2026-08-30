"use client"

import React from "react"

/**
 * Tiny markdown renderer for chat replies — covers the subset the design
 * models actually emit (probed: bold, italics, headings, unordered/ordered
 * lists, inline code). No react-markdown dependency; renders to styled JSX
 * matching the bubble typography.
 *
 * The storefront chat models reply in markdown ("**Brief – first step**" +
 * numbered onboarding questions) — rendered raw, the asterisks show. This
 * formats them.
 */

type Inline = string

/** Inline formatting: **bold**, *italic*, `code` — tokenized, no nesting. */
const renderInline = (text: Inline, keyPrefix: string): React.ReactNode[] => {
  const nodes: React.ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    const token = m[0]
    const key = `${keyPrefix}-${i++}`
    if (token.startsWith("**")) {
      nodes.push(
        <strong key={key} className="font-semibold">
          {token.slice(2, -2)}
        </strong>
      )
    } else if (token.startsWith("`")) {
      nodes.push(
        <code key={key} className="rounded bg-ui-bg-base-pressed px-1 py-0.5 text-[0.9em]">
          {token.slice(1, -1)}
        </code>
      )
    } else {
      nodes.push(
        <em key={key} className="italic">
          {token.slice(1, -1)}
        </em>
      )
    }
    last = m.index + token.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

export const MarkdownContent = ({ text }: { text: string }) => {
  const blocks = React.useMemo(() => {
    const lines = text.split("\n")
    const out: React.ReactNode[] = []
    let listBuffer: { ordered: boolean; items: string[] } | null = null
    let key = 0

    const flushList = () => {
      if (!listBuffer) return
      const { ordered, items } = listBuffer
      const itemsNodes = items.map((item, i) => (
        <li key={i} className="pl-1">
          {renderInline(item, `li-${key}-${i}`)}
        </li>
      ))
      out.push(
        ordered ? (
          <ol key={`l-${key++}`} className="ml-5 list-decimal space-y-1">
            {itemsNodes}
          </ol>
        ) : (
          <ul key={`l-${key++}`} className="ml-5 list-disc space-y-1">
            {itemsNodes}
          </ul>
        )
      )
      listBuffer = null
    }

    for (const raw of lines) {
      const line = raw.trimEnd()
      const heading = line.match(/^(#{1,4})\s+(.*)$/)
      const bullet = line.match(/^\s*[-*•]\s+(.*)$/)
      const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/)

      if (heading) {
        flushList()
        const level = heading[1].length
        out.push(
          level <= 2 ? (
            <p key={`h-${key++}`} className="mt-2 font-semibold">
              {renderInline(heading[2], `h-${key}`)}
            </p>
          ) : (
            <p key={`h-${key++}`} className="mt-1.5 font-medium">
              {renderInline(heading[2], `h-${key}`)}
            </p>
          )
        )
        continue
      }
      if (bullet) {
        if (!listBuffer || listBuffer.ordered) {
          flushList()
          listBuffer = { ordered: false, items: [] }
        }
        listBuffer.items.push(bullet[1])
        continue
      }
      if (ordered) {
        if (!listBuffer || !listBuffer.ordered) {
          flushList()
          listBuffer = { ordered: true, items: [] }
        }
        listBuffer.items.push(ordered[1])
        continue
      }
      flushList()
      if (!line.trim()) continue
      out.push(
        <p key={`p-${key++}`} className="whitespace-pre-wrap">
          {renderInline(line, `p-${key}`)}
        </p>
      )
    }
    flushList()
    return out
  }, [text])

  return <div className="flex flex-col gap-1.5">{blocks}</div>
}

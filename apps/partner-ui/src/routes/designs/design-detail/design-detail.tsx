import { TriangleRightMini } from "@medusajs/icons"
import { Badge, Container, Heading, Text } from "@medusajs/ui"
import { useMemo } from "react"
import { Link, useParams } from "react-router-dom"

import { SectionRow } from "../../../components/common/section"
import { TwoColumnPageSkeleton } from "../../../components/common/skeleton"
import { SingleColumnPage, TwoColumnPage } from "../../../components/layout/pages"
import { getStatusBadgeColor } from "../../../lib/status-badge"
import {
  usePartnerDesign,
} from "../../../hooks/api/partner-designs"
import { DesignActionsSection } from "./components/design-actions-section"
import { DesignMediaSection } from "./components/design-media-section"
import { DesignMoodboardSection } from "./components/design-moodboard-section"

type MarkLinkAttrs = { href?: string; target?: string }
type Mark = {
  type: "bold" | "italic" | "underline" | "strike" | "code" | "link"
  attrs?: MarkLinkAttrs
}

type TextNode = { type: "text"; text: string; marks?: Mark[] }
type HardBreakNode = { type: "hardBreak" }
type ParagraphNode = { type: "paragraph"; content?: InlineNode[] }
type HeadingNode = { type: "heading"; attrs?: { level?: number }; content?: InlineNode[] }
type ListItemNode = { type: "listItem"; content?: BlockNode[] }
type BulletListNode = { type: "bulletList"; content?: ListItemNode[] }
type OrderedListNode = { type: "orderedList"; content?: ListItemNode[] }
type BlockquoteNode = { type: "blockquote"; content?: BlockNode[] }
type HorizontalRuleNode = { type: "horizontalRule" }

type InlineNode = TextNode | HardBreakNode

type BlockNode =
  | ParagraphNode
  | HeadingNode
  | BulletListNode
  | OrderedListNode
  | BlockquoteNode
  | HorizontalRuleNode
  | { type: string; [k: string]: unknown }

type TipTapDoc = { type: "doc"; content?: BlockNode[] }

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
        content = (
          <code
            key={`${key}-c`}
            className="px-1 py-0.5 bg-ui-bg-subtle rounded border text-xs"
          >
            {content}
          </code>
        )
        break
      case "link": {
        const href = (mark.attrs as MarkLinkAttrs | undefined)?.href || "#"
        const target = (mark.attrs as MarkLinkAttrs | undefined)?.target || "_blank"
        content = (
          <a
            key={`${key}-a`}
            href={href}
            target={target}
            className="text-ui-fg-interactive hover:underline"
          >
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
      return (
        <p key={idx} className="mb-2">
          {renderInline(n.content)}
        </p>
      )
    }
    case "heading": {
      const n = node as HeadingNode
      const level = Math.min(Math.max(n.attrs?.level ?? 2, 1), 6)
      const Tag = `h${level}` as keyof React.JSX.IntrinsicElements
      return (
        <Tag key={idx} className="font-semibold mt-3 mb-2">
          {renderInline(n.content)}
        </Tag>
      )
    }
    case "bulletList": {
      const n = node as BulletListNode
      return (
        <ul key={idx} className="list-disc pl-6 mb-2">
          {(n.content || []).map((li, i) => (
            <li key={i}>
              {(li.content || []).map((c, j) => renderBlock(c, j))}
            </li>
          ))}
        </ul>
      )
    }
    case "orderedList": {
      const n = node as OrderedListNode
      return (
        <ol key={idx} className="list-decimal pl-6 mb-2">
          {(n.content || []).map((li, i) => (
            <li key={i}>
              {(li.content || []).map((c, j) => renderBlock(c, j))}
            </li>
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
      return (
        <pre
          key={idx}
          className="text-xs bg-ui-bg-subtle p-2 rounded border overflow-auto"
        >
          {JSON.stringify(node, null, 2)}
        </pre>
      )
  }
}

function getTipTapBlocks(input: unknown): BlockNode[] {
  let doc: TipTapDoc | null = null

  if (typeof input === "string") {
    const trimmed = input.trim()

    if (!trimmed) {
      return []
    }

    try {
      doc = JSON.parse(trimmed) as TipTapDoc
    } catch {
      doc = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: input }],
          },
        ],
      }
    }
  } else if (input && typeof input === "object") {
    doc = input as TipTapDoc
  }

  if (!doc || doc.type !== "doc") {
    return []
  }

  return Array.isArray(doc.content) ? (doc.content as BlockNode[]) : []
}

export const DesignDetail = () => {
  const { id } = useParams()

  if (!id) {
    return (
      <SingleColumnPage widgets={{ before: [], after: [] }} hasOutlet={false}>
        <Container className="p-6">
          <Heading>Design</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Missing design id
          </Text>
        </Container>
      </SingleColumnPage>
    )
  }

  const { design, isPending, isError, error } = usePartnerDesign(id)

  const inventoryItems = (design?.inventory_items || []) as Array<Record<string, any>>

  const inventoryItemRows = useMemo(() => {
    return inventoryItems.map((it) => {
      const label = it?.title || it?.name || it?.sku || it?.id
      return {
        id: String(it.id),
        label: String(label),
      }
    })
  }, [inventoryItems])

  const metadata = (design as any)?.metadata as Record<string, any> | undefined
  const notesValue = metadata?.notes
  const specsValue = metadata?.specs

  const notesBlocks = useMemo(() => getTipTapBlocks(notesValue), [notesValue])
  const hasNotesContent = notesBlocks.length > 0

  if (isPending) {
    return (
      <TwoColumnPageSkeleton
        mainSections={5}
        sidebarSections={3}
        showJSON={false}
        showMetadata={false}
      />
    )
  }

  if (isError) {
    throw error
  }

  if (!design) {
    return (
      <SingleColumnPage widgets={{ before: [], after: [] }} hasOutlet={false}>
        <Container className="p-6">
          <Heading>Design</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Design not found
          </Text>
        </Container>
      </SingleColumnPage>
    )
  }

  return (
    <TwoColumnPage widgets={{ before: [], after: [], sideBefore: [], sideAfter: [] }} hasOutlet>
      <TwoColumnPage.Main>
        <Container className="divide-y p-0">
          <div className="px-6 py-4">
            <Heading level="h2">General</Heading>
          </div>
          <SectionRow title="Name" value={design?.name || "-"} />
          <SectionRow title="Design ID" value={design?.id || "-"} />
          <SectionRow
            title="Status"
            value={
              design?.status ? (
                <Badge size="2xsmall" color={getStatusBadgeColor(design.status)}>
                  {String(design.status)}
                </Badge>
              ) : (
                "-"
              )
            }
          />
          <SectionRow
            title="Partner status"
            value={
              design?.partner_info?.partner_status ? (
                <Badge
                  size="2xsmall"
                  color={getStatusBadgeColor(design.partner_info.partner_status)}
                >
                  {String(design.partner_info.partner_status)}
                </Badge>
              ) : (
                "-"
              )
            }
          />
        </Container>

        <Container className="divide-y p-0">
          <div className="px-6 py-4">
            <Heading level="h2">Inventory Items</Heading>
          </div>

          {inventoryItemRows.length === 0 ? (
            <div className="px-6 py-4">
              <Text size="small" className="text-ui-fg-subtle">
                No inventory items linked to this design.
              </Text>
            </div>
          ) : (
            <div className="txt-small flex flex-col gap-2 px-2 pt-2 pb-2">
              {inventoryItemRows.map((row) => {
                const link = `/inventory/${row.id}`

                const Inner = (
                  <div className="shadow-elevation-card-rest bg-ui-bg-component rounded-md px-4 py-2 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="flex flex-1 flex-col overflow-hidden">
                        <span className="text-ui-fg-base font-medium truncate">
                          {row.label}
                        </span>
                        <span className="text-ui-fg-subtle truncate">{row.id}</span>
                      </div>
                      <div className="size-7 flex items-center justify-center">
                        <TriangleRightMini className="text-ui-fg-muted rtl:rotate-180" />
                      </div>
                    </div>
                  </div>
                )

                return (
                  <Link
                    to={link}
                    key={row.id}
                    className="outline-none focus-within:shadow-borders-interactive-with-focus rounded-md [&:hover>div]:bg-ui-bg-component-hover"
                  >
                    {Inner}
                  </Link>
                )
              })}
            </div>
          )}
        </Container>

        <Container className="divide-y p-0">
          <div className="px-6 py-4">
            <Heading level="h2">Designer Notes</Heading>
          </div>
          <div className="px-6 py-4">
            {!hasNotesContent ? (
              <Text size="small" className="text-ui-fg-subtle">
                No notes
              </Text>
            ) : (
              <div className="space-y-2">
                <div className="text-sm leading-6 resize-y overflow-auto min-h-[120px] max-h-[60vh] rounded-md border bg-ui-bg-base p-3">
                  {notesBlocks.map((n, i) => renderBlock(n, i))}
                </div>
                <Text size="xsmall" className="text-ui-fg-muted">
                  Drag the bottom edge to resize
                </Text>
              </div>
            )}
          </div>
        </Container>

        <Container className="divide-y p-0">
          <div className="px-6 py-4">
            <Heading level="h2">Specs</Heading>
          </div>
          {specsValue && typeof specsValue === "object" && !Array.isArray(specsValue) ? (
            Object.entries(specsValue as Record<string, any>).map(([key, value]) => (
              <SectionRow
                key={key}
                title={String(key)}
                value={
                  typeof value === "string" || typeof value === "number"
                    ? String(value)
                    : value
                    ? JSON.stringify(value)
                    : "-"
                }
              />
            ))
          ) : (
            <div className="px-6 py-4">
              <Text size="small" className="text-ui-fg-subtle whitespace-pre-line">
                {typeof specsValue === "string"
                  ? specsValue || "-"
                  : specsValue
                  ? JSON.stringify(specsValue, null, 2)
                  : "-"}
              </Text>
            </div>
          )}
        </Container>
      </TwoColumnPage.Main>

      <TwoColumnPage.Sidebar>
        {design && <DesignActionsSection design={design} isPending={isPending} />}
        {design && <DesignMediaSection design={design} />}
        {design && <DesignMoodboardSection design={design} />}
      </TwoColumnPage.Sidebar>
    </TwoColumnPage>
  )
}

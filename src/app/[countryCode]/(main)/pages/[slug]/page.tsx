import { notFound } from "next/navigation"
import { Metadata } from "next"
import { getWebsitePage } from "@lib/data/website"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { generateHTML } from "@tiptap/html"
import StarterKit from "@tiptap/starter-kit"
import ContactUsForm from "@modules/layout/components/contact-us-form"
import VisualEditorBridge from "@modules/website/components/visual-editor-bridge"

const DOMAIN = "shop.cicilabel.com"

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  try {
    const page = await getWebsitePage(DOMAIN, slug)
    return { title: page?.title || "Page" }
  } catch {
    return { title: "Page" }
  }
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { slug } = await params
  const search = await searchParams
  const isVisualEditor = search.visual_editor === "true"

  let page: Awaited<ReturnType<typeof getWebsitePage>> | null = null
  try {
    page = await getWebsitePage(DOMAIN, slug)
    
  } catch {
    notFound()
  }
  if (!page) {
    notFound()
  }

  // Full-bleed hero with gradient background and responsive typography
  const renderHero = (title?: string, subtitle?: string, align: "left" | "center" = "center") => (
    <section className="relative mb-8 md:mb-12">
      <div className="w-screen relative left-1/2 right-1/2 -mx-[50vw] bg-gradient-to-b from-ui-bg-base to-transparent">
        <div className={
          `content-container py-10 md:py-16 ${align === 'left' ? 'text-left' : 'text-center'}`
        }>
          {title && (
            <h1 className={`mb-3 text-2xl md:text-4xl font-semibold tracking-tight ${align === 'left' ? '' : ''}`}>
              {title}
            </h1>
          )}
          {subtitle && (
            <p className={
              `${align === 'left' ? 'max-w-xl' : 'max-w-xl mx-auto'} text-ui-fg-subtle text-sm md:text-base`
            }>
              {subtitle}
            </p>
          )}
        </div>
      </div>
    </section>
  )

  // Note: For TipTap JSON, render via official static renderer (server-side).

  // Very small formatter for plain body text: supports
  // - Headings: "# ", "## " => h2/h3
  // - Unordered lists: lines starting with "- " or "* "
  // - Ordered lists: lines like "1. "
  // - Paragraphs as fallback
  const renderFormattedBody = (body: string) => {
    const blocks = body.split(/\n\n+/)
    return (
      <div className="space-y-6 text-ui-fg-subtle">
        {blocks.map((block, idx) => {
          const lines = block.split(/\n/).filter(Boolean)
          if (lines.length === 0) return null

          // Headings
          if (block.startsWith('# ')) {
            return <h2 key={idx} className="text-xl md:text-2xl font-semibold m-0">{block.replace(/^#\s+/, '')}</h2>
          }
          if (block.startsWith('## ')) {
            return <h3 key={idx} className="text-lg md:text-xl font-semibold m-0">{block.replace(/^##\s+/, '')}</h3>
          }

          // Unordered list
          const isUL = lines.every(l => /^[-*]\s+/.test(l))
          if (isUL) {
            return (
              <ul key={idx} className="list-disc ml-6 space-y-1">
                {lines.map((l, i) => <li key={i}>{l.replace(/^[-*]\s+/, '')}</li>)}
              </ul>
            )
          }

          // Ordered list
          const isOL = lines.every(l => /^\d+\.\s+/.test(l))
          if (isOL) {
            return (
              <ol key={idx} className="list-decimal ml-6 space-y-1">
                {lines.map((l, i) => <li key={i}>{l.replace(/^\d+\.\s+/, '')}</li>)}
              </ol>
            )
          }

          // Paragraph fallback
          return <p key={idx} className={idx === 0 ? 'text-base md:text-lg' : undefined}>{block}</p>
        })}
      </div>
    )
  }

  const renderMain = (body?: unknown, sectionTitle?: string) => {
    // If TipTap JSON object is provided
    if (body && typeof body === "object") {
      const html = generateHTML(body as any, [
        StarterKit.configure({
          heading: {
            levels: [1, 2, 3, 4, 5, 6],
            HTMLAttributes: {
              class: 'mb-6 mt-8',
            },
          },
          paragraph: {
            HTMLAttributes: {
              class: 'mb-4',
            },
          },
          bulletList: {
            HTMLAttributes: {
              class: 'mb-4 ml-6 list-disc',
            },
          },
          orderedList: {
            HTMLAttributes: {
              class: 'mb-4 ml-6 list-decimal',
            },
          },
          listItem: {
            HTMLAttributes: {
              class: 'mb-2',
            },
          },
        }),
      ])
      return (
        <section className="prose prose-neutral max-w-none">
          {sectionTitle && <h2 className="mt-0 mb-6">{sectionTitle}</h2>}
          <div 
            dangerouslySetInnerHTML={{ __html: html }} 
            className="tiptap-content"
          />
        </section>
      )
    }

    // Otherwise treat as plain string
    const text = typeof body === "string" ? body : ""
    return (
      <section className="prose prose-neutral max-w-none prose-p:mb-4 prose-headings:mb-6 prose-ul:mb-4 prose-ol:mb-4">
        {sectionTitle && <h2 className="mt-0 mb-6">{sectionTitle}</h2>}
        {text ? (
          renderFormattedBody(text)
        ) : (
          <p className="text-ui-fg-subtle">No content</p>
        )}
      </section>
    )
  }

  const blocks = Array.isArray(page.blocks)
    ? page.blocks
        .slice()
        .sort((a: any, b: any) => {
          const ao = Number(a?.order ?? 0)
          const bo = Number(b?.order ?? 0)
          if (ao !== bo) return ao - bo
          const an = String(a?.name || "")
          const bn = String(b?.name || "")
          return an.localeCompare(bn)
        })
        .map((b: any, idx: number) => ({ ...b, order: Number(b?.order ?? idx) }))
    : []

  const normalizeType = (raw?: string) => {
    const t = (raw || "").toLowerCase()
    if (t.includes("hero")) return "Hero"
    if (t.includes("main")) return "Main"
    return raw || ""
  }

  return (
    <article className="content-container py-6 md:py-10">
      {/* If no hero block is present, show page title as fallback */}
      {blocks.some((b) => b.type === "Hero") ? null : (
        <h1 className="mb-6 text-2xl md:text-3xl font-semibold">{page.title}</h1>
      )}

      {/* Breadcrumbs */}
      <nav aria-label="Breadcrumb" className="mb-6">
        <ol className="flex items-center gap-2 text-ui-fg-subtle text-sm">
          <li>
            <LocalizedClientLink href="/" className="hover:text-ui-fg-base">Home</LocalizedClientLink>
          </li>
          <li aria-hidden className="text-ui-fg-muted">/</li>
          <li>
            <span className="text-ui-fg-muted">Pages</span>
          </li>
          <li aria-hidden className="text-ui-fg-muted">/</li>
          <li>
            <span className="text-ui-fg-base">{page.title}</span>
          </li>
        </ol>
      </nav>

      <div className="space-y-8">
        {blocks.length > 0 ? (
          blocks.map((block, idx) => {
            const type = normalizeType(block.type as any)
            const rawContent = (block as any).content ?? (block as any) // allow content at root

            // data attributes for visual editor block targeting
            const blockAttrs = isVisualEditor && block.id
              ? {
                  "data-block-id": block.id,
                  "data-block-type": block.type || type,
                  "data-block-name": block.name || type,
                }
              : {}

            if (type === "Hero") {
              const content = rawContent as { title?: string; subtitle?: string; align?: "left" | "center" }
              return (
                <div key={`hero-${idx}`} {...blockAttrs}>{renderHero(content?.title ?? page.title, content?.subtitle, content?.align || 'center')}</div>
              )
            }
            if (type === "Main") {
              const content = rawContent as { body?: unknown; title?: string }
              return (
                <div key={`main-${idx}`} {...blockAttrs}>{renderMain(content?.body, content?.title)}</div>
              )
            }
            // Fallback for unknown block types: if title/body exist, render nicely
            const c = rawContent as { title?: string; body?: string }
            if (typeof c?.title === 'string' || typeof c?.body !== 'undefined') {
              return (
                <div key={`${block.type}-${idx}`} {...blockAttrs}>{renderMain(c.body as any, c.title)}</div>
              )
            }
            // Otherwise minimal presentation
            return (
              <section key={`${block.type}-${idx}`} className="p-4" {...blockAttrs}>
                <h2 className="m-0">{block.name || block.type}</h2>
                {block && (
                  <pre className="text-sm text-ui-fg-subtle overflow-auto bg-ui-bg-subtle p-3 rounded mt-2">{JSON.stringify(block, null, 2)}</pre>
                )}
              </section>
            )
          })
        ) : (
          <p className="text-ui-fg-subtle">No content available for this page.</p>
        )}

        {slug === "contact-us" ? (
          <section className="py-2">
            <ContactUsForm />
          </section>
        ) : null}
      </div>

      {isVisualEditor && <VisualEditorBridge blocks={blocks} />}
    </article>
  )
}

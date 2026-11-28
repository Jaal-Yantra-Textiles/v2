import { notFound } from "next/navigation"
import { Metadata } from "next"
import { getWebsitePage } from "@lib/data/website"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { generateHTML } from "@tiptap/html"
import StarterKit from "@tiptap/starter-kit"
import ContactUsForm from "@modules/layout/components/contact-us-form"
import { PageHero } from "@modules/layout/components/page-threads"

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

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  let page: Awaited<ReturnType<typeof getWebsitePage>> | null = null
  try {
    page = await getWebsitePage(DOMAIN, slug)
    
  } catch {
    notFound()
  }
  if (!page) {
    notFound()
  }

  // The hero and the poppy painting are one section: the painting is the
  // ground, the title sits on top of it. The slug seeds the palette and the
  // motion, so each CMS page gets its own colours and its own sway.
  const renderHero = (title?: string, subtitle?: string, align: "left" | "center" = "center") => (
    <PageHero title={title} subtitle={subtitle} align={align} seed={slug} />
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

  // The painted hero is the page's own section now, so this index only says
  // whether the CMS supplied one or the title needs the fallback below.
  const firstHeroIndex = blocks.findIndex(
    (b: any) => normalizeType(b.type) === "Hero"
  )

  return (
    <article className="content-container py-6 md:py-10">
      {/* If no hero block is present, the page title gets the painted hero */}
      {firstHeroIndex === -1 && <PageHero title={page.title} seed={slug} />}

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

            if (type === "Hero") {
              const content = rawContent as { title?: string; subtitle?: string; align?: "left" | "center" }
              return (
                <div key={`hero-${idx}`}>
                  {renderHero(content?.title ?? page.title, content?.subtitle, content?.align || 'center')}
                </div>
              )
            }
            if (type === "Main") {
              const content = rawContent as { body?: unknown; title?: string }
              return (
                <div key={`main-${idx}`}>{renderMain(content?.body, content?.title)}</div>
              )
            }
            // Fallback for unknown block types: if title/body exist, render nicely
            const c = rawContent as { title?: string; body?: string }
            if (typeof c?.title === 'string' || typeof c?.body !== 'undefined') {
              return (
                <div key={`${block.type}-${idx}`}>{renderMain(c.body as any, c.title)}</div>
              )
            }
            // Otherwise minimal presentation
            return (
              <section key={`${block.type}-${idx}`} className="p-4">
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
    </article>
  )
}

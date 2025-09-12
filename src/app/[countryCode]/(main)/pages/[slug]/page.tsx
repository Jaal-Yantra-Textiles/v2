import { notFound } from "next/navigation"
import { Metadata } from "next"
import { getWebsitePage } from "@lib/data/website"
import LocalizedClientLink from "@modules/common/components/localized-client-link"

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

  const renderMain = (body?: string, sectionTitle?: string) => (
    <section className="prose prose-neutral max-w-none">
      {sectionTitle && <h2 className="mt-0 mb-4">{sectionTitle}</h2>}
      {body ? (
        <div className="space-y-6 text-ui-fg-subtle">
          {body.split(/\n\n+/).map((para, i) => (
            <p key={i} className={i === 0 ? "text-base md:text-lg" : undefined}>{para}</p>
          ))}
        </div>
      ) : (
        <p className="text-ui-fg-subtle">No content</p>
      )}
    </section>
  )

  const blocks = Array.isArray(page.blocks)
    ? page.blocks.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
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

            if (type === "Hero") {
              const content = rawContent as { title?: string; subtitle?: string; align?: "left" | "center" }
              return (
                <div key={`hero-${idx}`}>{renderHero(content?.title ?? page.title, content?.subtitle, content?.align || 'center')}</div>
              )
            }
            if (type === "Main") {
              const content = rawContent as { body?: string; title?: string }
              return (
                <div key={`main-${idx}`}>{renderMain(content?.body, content?.title)}</div>
              )
            }
            // Fallback for unknown block types: if title/body exist, render nicely
            const c = rawContent as { title?: string; body?: string }
            if (typeof c?.title === 'string' || typeof c?.body === 'string') {
              return (
                <div key={`${block.type}-${idx}`}>{renderMain(c.body, c.title)}</div>
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
      </div>
    </article>
  )
}

import { listCategories } from "@lib/data/categories"
import { listCollections } from "@lib/data/collections"
import { buildPublicMediaUrl, listPublicMedia } from "@lib/data/media"
import { Text, clx } from "@medusajs/ui"

import LocalizedClientLink from "@modules/common/components/localized-client-link"
import MedusaCTA from "@modules/layout/components/medusa-cta"
import NewsletterForm from "@modules/layout/components/newsletter-form"

export default async function Footer() {
  const { collections } = await listCollections({
    fields: "*products",
  })
  const productCategories = await listCategories()


  return (
    <footer className="border-t border-ui-border-base w-full bg-white relative">
      <div className="content-container flex flex-col w-full relative z-10">
        <div className="flex flex-col gap-y-6 xsmall:flex-row items-start justify-between py-24">
          <div className="flex flex-col gap-y-4">
            <LocalizedClientLink
              href="/"
              className="txt-compact-xlarge-plus text-ui-fg-subtle hover:text-ui-fg-base uppercase"
            >
              Cici Label Store
            </LocalizedClientLink>
            <img
              src="/logo.png"
              alt="Cici Label Store Logo"
              className="h-24 w-auto object-contain"
            />
          </div>
          <div className="text-small-regular gap-10 md:gap-x-16 grid grid-cols-2 sm:grid-cols-4">
            {productCategories && productCategories?.length > 0 && (
              <div className="flex flex-col gap-y-2">
                <span className="txt-small-plus txt-ui-fg-base">
                  Categories
                </span>
                <ul
                  className="grid grid-cols-1 gap-2"
                  data-testid="footer-categories"
                >
                  {productCategories?.slice(0, 6).map((c) => {
                    if (c.parent_category) {
                      return
                    }

                    const children =
                      c.category_children?.map((child) => ({
                        name: child.name,
                        handle: child.handle,
                        id: child.id,
                      })) || null

                    return (
                      <li
                        className="flex flex-col gap-2 text-ui-fg-subtle txt-small"
                        key={c.id}
                      >
                        <LocalizedClientLink
                          className={clx(
                            "hover:text-ui-fg-base",
                            children && "txt-small-plus"
                          )}
                          href={`/categories/${c.handle}`}
                          data-testid="category-link"
                        >
                          {c.name}
                        </LocalizedClientLink>
                        {children && (
                          <ul className="grid grid-cols-1 ml-3 gap-2">
                            {children &&
                              children.map((child) => (
                                <li key={child.id}>
                                  <LocalizedClientLink
                                    className="hover:text-ui-fg-base"
                                    href={`/categories/${child.handle}`}
                                    data-testid="category-link"
                                  >
                                    {child.name}
                                  </LocalizedClientLink>
                                </li>
                              ))}
                          </ul>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
            {collections && collections.length > 0 && (
              <div className="flex flex-col gap-y-2">
                <span className="txt-small-plus txt-ui-fg-base">
                  Collections
                </span>
                <ul
                  className="grid grid-cols-1 gap-2 text-ui-fg-subtle txt-small"
                >
                  {collections?.slice(0, 6).map((c) => (
                    <li key={c.id}>
                      <LocalizedClientLink
                        className="hover:text-ui-fg-base"
                        href={`/collections/${c.handle}`}
                      >
                        {c.title}
                      </LocalizedClientLink>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex flex-col gap-y-2">
              <span className="txt-small-plus txt-ui-fg-base">Medusa + Medu by JYT</span>
              <ul className="grid grid-cols-1 gap-y-2 text-ui-fg-subtle txt-small">
                <li>
                  <a
                    href="https://github.com/jaal-yantra-textiles/v2"
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-ui-fg-base"
                  >
                    GitHub
                  </a>
                </li>
                <li>
                  <a
                    href="https://docs.jaalyantra.com"
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-ui-fg-base"
                  >
                    Documentation
                  </a>
                </li>
                <li>
                  <a
                    href="https://github.com/medusajs/nextjs-starter-medusa"
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-ui-fg-base"
                  >
                    Source code
                  </a>
                </li>
              </ul>
            </div>
            {/* Info pages */}
            <div className="flex flex-col gap-y-2">
              <span className="txt-small-plus txt-ui-fg-base">Info & Other</span>
              <ul className="grid grid-cols-1 gap-y-2 text-ui-fg-subtle txt-small">
                <li>
                  <LocalizedClientLink className="hover:text-ui-fg-base" href="/pages/terms-and-conditions">
                    Terms & Conditions
                  </LocalizedClientLink>
                </li>
                <li>
                  <LocalizedClientLink className="hover:text-ui-fg-base" href="/pages/refund-policy">
                    Refund policy
                  </LocalizedClientLink>
                </li>
                <li>
                  <LocalizedClientLink className="hover:text-ui-fg-base" href="/pages/about-us">
                    About Us
                  </LocalizedClientLink>
                </li>
                <li>
                  <LocalizedClientLink className="hover:text-ui-fg-base" href="/gallery">
                    Gallery
                  </LocalizedClientLink>
                </li>
                <li>
                  <LocalizedClientLink className="hover:text-ui-fg-base" href="/pages/privacy-policy">
                    Privacy Policy
                  </LocalizedClientLink>
                </li>
                <li>
                  <LocalizedClientLink className="hover:text-ui-fg-base" href="/pages/contact-us">
                    Contact Us
                  </LocalizedClientLink>
                </li>
              </ul>
            </div>
          </div>
        </div>
        <div className="border-t border-ui-border-base py-16">
          <NewsletterForm />
        </div>
        <div className="flex w-full mb-16 justify-between text-ui-fg-muted">
          <Text className="txt-compact-small">
            © {new Date().getFullYear()} Cici Label & Powered by Medu & Medusa Store. All rights reserved.
          </Text>
          <MedusaCTA />
        </div>
      </div>
    </footer>
  )
}

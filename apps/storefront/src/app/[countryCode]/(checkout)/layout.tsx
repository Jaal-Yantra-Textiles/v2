import { retrieveCustomer } from "@lib/data/customer"
import { ArrowLeft, UserMini } from "@medusajs/icons"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import MedusaCTA from "@modules/layout/components/medusa-cta"
import type { Metadata } from "next"

const STORE_NAME = "Cici Label Store"

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default async function CheckoutLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const customer = await retrieveCustomer()

  return (
    <div className="min-h-screen bg-ui-bg-base flex flex-col">
      <header className="border-b border-ui-border-base bg-ui-bg-base sticky top-0 z-40">
        <div className="flex items-center content-container py-3 h-16">
          <div className="flex flex-1 items-center">
            <LocalizedClientLink
              href="/cart"
              className="flex items-center gap-x-2 txt-compact-medium-plus text-ui-fg-subtle hover:text-ui-fg-base transition-colors"
              data-testid="back-to-cart-link"
            >
              <ArrowLeft />
              <span className="hidden sm:inline">Back to shopping cart</span>
              <span className="sm:hidden font-semibold uppercase whitespace-nowrap">
                {STORE_NAME}
              </span>
            </LocalizedClientLink>
          </div>

          <LocalizedClientLink
            href="/"
            className="hidden sm:block shrink-0 txt-compact-medium font-semibold text-ui-fg-subtle uppercase hover:text-ui-fg-base transition-colors"
            data-testid="store-link"
          >
            {STORE_NAME}
          </LocalizedClientLink>

          <div className="flex flex-1 items-center justify-end">
            {customer ? (
              <div className="flex items-center gap-x-1 txt-compact-medium text-ui-fg-subtle">
                <UserMini />
                <span className="text-xs truncate hidden md:block">
                  {customer.email}
                </span>
              </div>
            ) : (
              <LocalizedClientLink
                href="/account"
                className="txt-compact-medium text-ui-fg-base hover:text-ui-fg-subtle transition-colors"
              >
                Sign in
              </LocalizedClientLink>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1" data-testid="checkout-container">
        {children}
      </main>

      <footer className="border-t border-ui-border-base bg-ui-bg-base">
        <div className="flex flex-col items-center gap-2 content-container py-4 text-center lg:hidden">
          <span className="text-base font-light text-ui-fg-subtle">
            © {new Date().getFullYear()} {STORE_NAME}. All rights reserved.
          </span>
        </div>

        <div className="hidden lg:flex items-center justify-between content-container gap-2 h-16">
          <span className="txt-compact-medium font-semibold text-ui-fg-subtle uppercase">
            {STORE_NAME}
          </span>
          <MedusaCTA />
        </div>
      </footer>
    </div>
  )
}
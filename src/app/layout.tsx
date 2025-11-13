import { getBaseURL } from "@lib/util/env"
import { Metadata } from "next"
import "styles/globals.css"

export const metadata: Metadata = {
  metadataBase: new URL(getBaseURL()),
}

export default function RootLayout(props: { children: React.ReactNode }) {
  return (
    <html lang="en" data-mode="light">
      <head>
        {/* JYT Analytics - shop.cicilabel.com */}
        <script 
          src="https://automatic.jaalyantra.com/analytics.min.js" 
          data-website-id="01JNVG9QWJ9Y64FVAPMGEX6HKX"
          defer
        />
      </head>
      <body>
        <main className="relative">{props.children}</main>
      </body>
    </html>
  )
}

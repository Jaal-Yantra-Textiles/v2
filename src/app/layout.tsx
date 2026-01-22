import { getBaseURL } from "@lib/util/env"
import { Metadata } from "next"
import { Inter, Playfair_Display } from "next/font/google"
import SmoothScroll from "@modules/common/components/smooth-scroll"
import "styles/globals.css"

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
})

const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
  display: "swap",
})

export const metadata: Metadata = {
  metadataBase: new URL(getBaseURL()),
}

export default function RootLayout(props: { children: React.ReactNode }) {
  return (
    <html lang="en" data-mode="light" className={`${inter.variable} ${playfair.variable}`}>
      <head>
        {/* JYT Analytics - shop.cicilabel.com */}
        <script
          src="https://automatic.jaalyantra.com/analytics.min.js"
          data-website-id="01JNVG9QWJ9Y64FVAPMGEX6HKX"
          defer
        />
      </head>
      <body>
        <SmoothScroll>
          <main className="relative font-sans">{props.children}</main>
        </SmoothScroll>
      </body>
    </html>
  )
}

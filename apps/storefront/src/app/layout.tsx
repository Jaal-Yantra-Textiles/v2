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
  title: {
    default: "Cici Label - Handmade, Locally Sourced Fashion",
    template: "%s | Cici Label Store",
  },
  description:
    "Cici Label is a slow fashion brand focused on handmade, locally sourced, and ethically produced clothing. Shop handloom and natural-dyed garments.",
  openGraph: {
    type: "website",
    siteName: "Cici Label Store",
    locale: "en_IN",
  },
  twitter: {
    card: "summary_large_image",
  },
  robots: {
    index: true,
    follow: true,
  },
  // Emit an explicit <link rel="icon"> in <head>. public/favicon.ico is
  // served at /favicon.ico but the App Router only auto-injects the <link>
  // tag for icons living in the app/ dir or declared here (audit #734 #2).
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
    apple: "/logo.png",
  },
}

export default function RootLayout(props: { children: React.ReactNode }) {
  const baseUrl = getBaseURL()

  const organizationLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Cici Label",
    url: baseUrl,
    logo: `${baseUrl}/logo.png`,
  }

  const websiteLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Cici Label Store",
    url: baseUrl,
  }

  return (
    <html lang="en" data-mode="light" className={`${inter.variable} ${playfair.variable}`}>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteLd) }}
        />
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

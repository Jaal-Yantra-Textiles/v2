import { themes as prismThemes } from "prism-react-renderer"
import type { Config } from "@docusaurus/types"
import type * as Preset from "@docusaurus/preset-classic"

const config: Config = {
  title: "JYT Commerce Docs",
  tagline: "Documentation for the JYT textile commerce platform",
  favicon: "img/favicon.ico",

  url: "https://docs.jaalyantra.in",
  baseUrl: "/",

  organizationName: "jaalyantra",
  projectName: "jyt-commerce-api",

  onBrokenLinks: "warn",
  onBrokenMarkdownLinks: "warn",

  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  markdown: {
    format: "md",
  },

  plugins: ["./src/plugins/tailwind-config.js"],

  presets: [
    [
      "classic",
      {
        docs: {
          sidebarPath: "./sidebars.ts",
          routeBasePath: "docs",
          showLastUpdateTime: true,
        },
        blog: false,
        theme: {
          customCss: "./src/css/custom.css",
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: "JYT Commerce",
      logo: {
        alt: "JYT Logo",
        src: "img/logo.svg",
      },
      items: [
        {
          type: "docSidebar",
          sidebarId: "guidesSidebar",
          position: "left",
          label: "Guides",
        },
        {
          type: "docSidebar",
          sidebarId: "implementationSidebar",
          position: "left",
          label: "Implementation",
        },
        {
          type: "docSidebar",
          sidebarId: "referenceSidebar",
          position: "left",
          label: "Reference",
        },
      ],
    },
    footer: {
      style: "dark",
      links: [
        {
          title: "Docs",
          items: [
            { label: "Guides", to: "/docs/guides/intro" },
            { label: "Implementation", to: "/docs/implementation/intro" },
            { label: "Reference", to: "/docs/reference/intro" },
          ],
        },
      ],
      copyright: `Copyright ${new Date().getFullYear()} JYT / Jaal Yantra Textiles.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ["bash", "json", "typescript"],
    },
  } satisfies Preset.ThemeConfig,
}

export default config

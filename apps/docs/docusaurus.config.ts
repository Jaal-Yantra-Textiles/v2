import { themes as prismThemes } from "prism-react-renderer"
import type { Config } from "@docusaurus/types"
import type * as Preset from "@docusaurus/preset-classic"

const config: Config = {
  title: "JYT Commerce Docs",
  tagline: "Documentation for the JYT textile commerce platform",
  favicon: "img/favicon.ico",

  url: "https://docs.jaalyantra.com",
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

  plugins: [
    "./src/plugins/tailwind-config.js",
    // Second docs instance: publish a CURATED set of notes/ at /notes.
    // ALLOWLIST (default-deny): only the grounded module behaviour analyses are
    // public — internal handoffs / daemon runbooks / infra & root-cause notes
    // stay private. Add a filename here to publish another analysis/reference doc.
    [
      "@docusaurus/plugin-content-docs",
      {
        id: "notes",
        path: "notes",
        routeBasePath: "notes",
        sidebarPath: "./sidebarsNotes.ts",
        showLastUpdateTime: true,
        include: [
          "568_AD_PLANNING_MODULE_ANALYSIS.md",
          "589_SOCIALS_AI_PROVIDER_ANALYSIS.md",
          "559_ANALYTICS_MODULE_ANALYSIS.md",
          "404_SHIPPING_PROVIDERS_ANALYSIS.md",
          "342_ORDERS_UNIFICATION_ANALYSIS.md",
          "457_OPS_MAINTENANCE_JOBS_ANALYSIS.md",
        ],
      },
    ],
  ],

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
        {
          type: "docSidebar",
          sidebarId: "protocolSidebar",
          position: "left",
          label: "Protocol",
        },
        {
          type: "docSidebar",
          sidebarId: "notesSidebar",
          docsPluginId: "notes",
          position: "left",
          label: "Analyses",
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
            { label: "Protocol", to: "/docs/protocol/intro" },
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

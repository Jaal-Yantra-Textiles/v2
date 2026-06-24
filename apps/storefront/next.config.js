const checkEnvVariables = require("./check-env-variables")

checkEnvVariables()

/**
 * Medusa Cloud-related environment variables
 */
const S3_HOSTNAME = process.env.MEDUSA_CLOUD_S3_HOSTNAME
const S3_PATHNAME = process.env.MEDUSA_CLOUD_S3_PATHNAME

/**
 * Domain consolidation (audit #734 #1 — canonical URL mismatch).
 *
 * The canonical domain is the apex `cicilabel.com`. When NEXT_PUBLIC_BASE_URL
 * is set to the apex (e.g. https://cicilabel.com), getBaseURL() emits apex
 * canonicals/sitemap/robots/JSON-LD AND we 301 the `www.` and `shop.`
 * aliases here to the apex so ranking signals consolidate on one host.
 *
 * Derived from NEXT_PUBLIC_BASE_URL so there is a single source of truth and
 * no hardcoded host. Returns [] (inert) when the env is unset or already
 * points at a subdomain, so a misconfig can never create a redirect loop.
 */
const buildCanonicalRedirects = () => {
  const base = process.env.NEXT_PUBLIC_BASE_URL
  if (!base) return []
  let host
  try {
    host = new URL(base).host
  } catch {
    return []
  }
  const apex = host.replace(/^(www|shop)\./, "")
  // Skip if base is itself an alias subdomain (would loop) or has no alias form.
  if (apex !== host || !apex.includes(".")) return []
  const dest = `${base.replace(/\/$/, "")}/:path*`
  return ["www", "shop"].map((sub) => ({
    source: "/:path*",
    has: [{ type: "host", value: `${sub}.${apex}` }],
    destination: dest,
    permanent: true,
  }))
}

/**
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    return buildCanonicalRedirects()
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "25mb",
    },
  },
  logging: {
    fetches: {
      fullUrl: true,
    },
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    minimumCacheTTL: 2592000, // 30 days — reduces Vercel image optimization cache writes
    formats: ["image/avif", "image/webp"],
    deviceSizes: [640, 750, 828, 1080, 1200],
    imageSizes: [16, 32, 48, 64, 96, 128, 256],
    remotePatterns: [
      {
        protocol: "http",
        hostname: "localhost",
      },
      {
        protocol: "https",
        hostname: "medusa-public-images.s3.eu-west-1.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "medusa-server-jyt.s3.us-east-1.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "automatic.jaalyantra.com",
      },
      {
        // CDN in front of the public R2 bucket — used by the hero album
        // and any other album-scoped public media.
        protocol: "https",
        hostname: "cdn.jaalyantra.com",
      },
      {
        protocol: "https",
        hostname: "**.r2.dev",
      },
      {
        protocol: "https",
        hostname: "medusa-server-testing.s3.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "medusa-server-testing.s3.us-east-1.amazonaws.com",
      },
      ...(S3_HOSTNAME && S3_PATHNAME
        ? [
            {
              protocol: "https",
              hostname: S3_HOSTNAME,
              pathname: S3_PATHNAME,
            },
          ]
        : []),
    ],
  },
}

module.exports = nextConfig

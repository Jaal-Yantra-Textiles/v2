/**
 * Regression guard for the MFA lockout of #1849.
 *
 * MFA challenges are not in Postgres. `@medusajs/auth` keeps them in the CACHE
 * module under `auth:mfa:challenge:<id>` (`createAuthMfaChallenge_` writes,
 * `verifyAuthMfaChallenge_` reads), and the same cache backs OAuth
 * `setState`/`getState`.
 *
 * `Modules.CACHE` ("cache") and `Modules.CACHING` ("caching") are DIFFERENT
 * keys, and `caching` does not satisfy `cache`. Prod once registered only
 * `caching`, so `cache` fell through to Medusa's in-memory default; with two
 * medusa-server tasks behind the ALB the challenge was written to one task's
 * process memory and verified on the other — a coin flip, 7 lockouts in 2m11s.
 *
 * The registration that fixes it is one deletion away from returning, and the
 * comment beside it cannot fail a build. Hence these.
 *
 * 🔴 The assertions run on the config with COMMENTS STRIPPED. Both configs
 * discuss `cache-redis` in prose, so a raw `toContain` would pass on a config
 * that only mentions it — including the dev one, where it is deliberately
 * commented out. The last test pins that distinction so this file cannot
 * quietly degrade into a grep for its own documentation.
 */
import fs from "fs"
import path from "path"

const CONFIG_DIR = path.join(__dirname, "..", "..", "..")

/**
 * The `resolve:` targets of the modules actually registered in `file`.
 *
 * Comments are dropped line-wise rather than by regex: a `//`-anywhere strip
 * would also eat the `http://localhost:9000/...` OAuth callback URLs, and
 * these files carry several.
 */
const registeredModules = (file: string): string[] => {
  const lines = fs.readFileSync(path.join(CONFIG_DIR, file), "utf8").split("\n")
  const found: string[] = []
  let inBlockComment = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (inBlockComment) {
      if (trimmed.includes("*/")) inBlockComment = false
      continue
    }
    if (trimmed.startsWith("/*")) {
      if (!trimmed.includes("*/")) inBlockComment = true
      continue
    }
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue

    const match = trimmed.match(/^resolve:\s*["']([^"']+)["']/)
    if (match) found.push(match[1])
  }
  return found
}

const CACHE_REDIS = "@medusajs/medusa/cache-redis"
const CACHING = "@medusajs/medusa/caching"

describe("auth MFA cache wiring", () => {
  // The outage guard. Without this module `Modules.CACHE` resolves to
  // InMemoryCacheService, and MFA breaks only on multi-task deployments —
  // which is precisely why it shipped.
  it("registers the legacy CACHE module on Redis in medusa-config.prod.ts", () => {
    expect(registeredModules("medusa-config.prod.ts")).toContain(CACHE_REDIS)
  })

  // Registering `caching` INSTEAD of `cache` is the original bug. Asserting
  // both are present makes a swap fail rather than a deletion only.
  it("keeps the caching module alongside it, not in place of it", () => {
    const modules = registeredModules("medusa-config.prod.ts")
    expect(modules).toContain(CACHING)
    expect(modules).toContain(CACHE_REDIS)
  })

  // Self-test: dev mentions `cache-redis` in two comments and registers it in
  // neither. If this ever passes-by-containing, the parser has started reading
  // prose and the assertions above are worthless.
  it("does not count a commented-out registration as registered", () => {
    const dev = registeredModules("medusa-config.ts")
    expect(dev).not.toContain(CACHE_REDIS)
    expect(dev).toContain(CACHING)
    expect(fs.readFileSync(path.join(CONFIG_DIR, "medusa-config.ts"), "utf8")).toContain(
      CACHE_REDIS
    )
  })
})

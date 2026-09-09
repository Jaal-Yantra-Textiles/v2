/**
 * Regression guard for #1939/#1942: a local module added to `medusa-config.ts`
 * and not to `medusa-config.prod.ts`.
 *
 * The Dockerfile does `cp apps/backend/medusa-config.prod.ts
 * apps/backend/medusa-config.ts` (Dockerfile:65), so the file every developer
 * edits is the one production throws away. A module registered only in the dev
 * config does not exist in production at all.
 *
 * 🔴 It fails SILENTLY, which is why the last one survived a green deploy.
 * `platform-cost-config` was registered by #1942 in the dev config only. In
 * production the module never loaded, so:
 *   - `/admin/platform-cost-config` answered 500 with
 *     `AwilixResolutionError: Could not resolve 'platform_cost_config'`, and
 *   - its migration never ran, because `db:migrate` only visits REGISTERED
 *     modules — so the table was absent as well as the service.
 * Meanwhile `loadCostConfig` deliberately swallows an unresolvable module and
 * returns an all-null policy, so every pricer fell back to its compiled-in
 * constant and no price moved. #1950 shipped "the pricers read the policy
 * table" and in production they read nothing, for a day, with every check
 * green.
 *
 * A parity test is the cheapest thing that could have caught it: the omission
 * is one missing line in a 900-line file, and no type, build or route test can
 * see it.
 */
import fs from "fs"
import path from "path"

const CONFIG_DIR = path.join(__dirname, "..", "..", "..")

/**
 * The `resolve:` targets of the modules actually registered in `file`.
 *
 * Comments are dropped line-wise rather than by regex, matching
 * `auth-mfa-cache-wiring.unit.spec.ts`: a `//`-anywhere strip would also eat
 * the `http://localhost:9000/...` OAuth callback URLs these files carry. It
 * matters here for the same reason it did there — this file's own explanatory
 * comment names `./src/modules/platform-cost-config`, and a parser that read
 * prose would find it in a config that registers nothing.
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

/** Only this repo's own modules. Packaged `@medusajs/*` modules differ between
 * the two configs on purpose (Redis vs in-memory, the email providers below),
 * and policing those would make this test a nuisance rather than a net. */
const localModules = (file: string): string[] =>
  registeredModules(file)
    .filter((m) => m.startsWith("./src/modules/"))
    .sort()

/**
 * Modules that are deliberately production-only, with the reason. A new entry
 * here is a decision being recorded, not a test being silenced — anything not
 * listed is treated as an accident.
 */
const PROD_ONLY = new Set([
  // Transactional email providers. Dev sends nothing, so registering these
  // locally would demand live API keys to boot.
  "./src/modules/maileroo",
  "./src/modules/mailjet",
  "./src/modules/resend",
])

describe("medusa-config.prod.ts registers everything medusa-config.ts does", () => {
  // The guard itself. A module in dev and not in prod is the #1942 defect.
  it("has no local module that exists only in the dev config", () => {
    const devOnly = localModules("medusa-config.ts").filter(
      (m) => !localModules("medusa-config.prod.ts").includes(m)
    )
    expect(devOnly).toEqual([])
  })

  // The other direction, allowlisted. It catches a module quietly dropped from
  // the dev config while production keeps loading it — the same divergence,
  // arriving from the other side.
  it("has no unexplained local module that exists only in the prod config", () => {
    const prodOnly = localModules("medusa-config.prod.ts").filter(
      (m) => !localModules("medusa-config.ts").includes(m) && !PROD_ONLY.has(m)
    )
    expect(prodOnly).toEqual([])
  })

  // The module whose absence produced the incident. Named explicitly so the
  // failure message says what broke, rather than printing a diff of 88 paths.
  it("registers platform-cost-config in production", () => {
    expect(localModules("medusa-config.prod.ts")).toContain(
      "./src/modules/platform-cost-config"
    )
  })

  // Self-test. This file's docblock names the module path in prose; if the
  // parser ever starts reading comments, the assertions above stop meaning
  // anything. A config that registers ~90 modules also proves the parser is
  // finding registrations at all, not returning an empty list that satisfies
  // every `toEqual([])` above.
  it("parses registrations, not the prose about them", () => {
    const parsed = localModules("medusa-config.prod.ts")
    expect(parsed.length).toBeGreaterThan(50)
    expect(parsed).not.toContain("./src/modules/platform-cost-config-that-does-not-exist")
  })
})

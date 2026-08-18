import * as fs from "fs"
import * as path from "path"

/**
 * The theme vocabulary is written down three times:
 *
 *   1. `validators.ts`        — the Zod schema, what the API will accept
 *   2. `storefront-starter`   — the TS type + the components that render it
 *   3. `partner-ui`           — the editor form the partner actually touches
 *
 * Nothing has ever tied them together. Adding a setting means three hand edits
 * in three apps, and forgetting one fails silently in a different way each
 * time: miss the storefront and the value is stored but never rendered; miss
 * the editor and the setting exists but no partner can reach it. `min_height`
 * (schema-only) and `text_color` (schema + renderer, no editor control) both
 * drifted exactly that way and nothing failed.
 *
 * This test makes the drift loud. It is deliberately a text scan rather than a
 * type-level check: the three files live in three apps with three tsconfigs
 * (the backend's excludes `apps/*` outright), so there is no compiler that
 * sees all of them at once. A grep that fails CI beats a type relationship
 * that cannot be expressed.
 *
 * It is a stopgap, not the destination — the destination is generating the
 * editor and the storefront type FROM this schema so drift is impossible
 * rather than merely detected. Until then, this is the guard.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..", "..", "..", "..", "..", "..")

const SCHEMA = path.join(
  REPO_ROOT,
  "apps/backend/src/api/partners/storefront/website/theme/validators.ts"
)
const STOREFRONT_TYPE = path.join(
  REPO_ROOT,
  "apps/storefront-starter/src/lib/data/website.ts"
)
const EDITOR = path.join(
  REPO_ROOT,
  "apps/partner-ui/src/routes/settings/theme/theme.tsx"
)

/**
 * Keys that are intentionally absent downstream. Every entry needs a reason —
 * an allowlist without one is just a way to make a failing test pass.
 */
const EXEMPT: Record<string, { from: Array<"storefront" | "editor">; why: string }> = {}

const read = (p: string): string => {
  if (!fs.existsSync(p)) {
    // Failing loudly is the point. `apps/storefront-starter` is a SUBMODULE,
    // so a runner that checks out without `submodules: true` has no such file
    // — and the alternative (skip when absent) would let this guard quietly
    // stop guarding in CI while still looking green locally, which is the
    // exact failure mode it exists to prevent.
    throw new Error(
      `${p} not found. If this is CI, the storefront-starter submodule was ` +
        `not checked out — add \`submodules: true\` to actions/checkout. ` +
        `Locally, run \`git submodule update --init\`.`
    )
  }
  return fs.readFileSync(p, "utf8")
}

/**
 * Jest's `expect` takes one argument, so the explanation cannot ride along as
 * a second parameter. Fold it into the compared VALUE instead: on failure the
 * diff prints the sentence and the offending keys, which is the whole point —
 * a bare `[] !== ["min_height"]` tells the next person nothing about what to
 * do about it.
 */
const complaint = (missing: string[], explain: string): string =>
  missing.length === 0 ? "" : `${explain}: ${missing.join(", ")}`

/** Leaf keys declared in the Zod schema (indented object properties). */
const schemaKeys = (src: string): string[] => {
  const keys = new Set<string>()
  for (const m of src.matchAll(/^\s{4,}([a-z][a-z0-9_]*):/gm)) {
    keys.add(m[1])
  }
  return [...keys].sort()
}

const mentions = (src: string, key: string): boolean =>
  new RegExp(`\\b${key}\\b`).test(src)

describe("theme schema stays in sync with its renderer and its editor", () => {
  const schemaSrc = read(SCHEMA)
  const keys = schemaKeys(schemaSrc)

  it("parses a plausible number of settings out of the schema", () => {
    // Guards the parser itself: if the regex stops matching, every assertion
    // below passes vacuously and the drift guard silently stops guarding.
    expect(keys.length).toBeGreaterThan(50)
    expect(keys).toContain("gallery_position")
    expect(keys).toContain("primary")
  })

  it("every theme setting is known to the storefront that renders it", () => {
    const src = read(STOREFRONT_TYPE)
    const missing = keys.filter(
      (k) => !mentions(src, k) && !EXEMPT[k]?.from.includes("storefront")
    )

    expect(
      complaint(
        missing,
        "accepted by the API but never read by the storefront, so a partner " +
          "can save a value that does nothing — add them to WebsiteTheme and " +
          "render them, or list them in EXEMPT with a reason"
      )
    ).toBe("")
  })

  it("every theme setting is reachable from the partner editor", () => {
    const src = read(EDITOR)
    const missing = keys.filter(
      (k) => !mentions(src, k) && !EXEMPT[k]?.from.includes("editor")
    )

    expect(
      complaint(
        missing,
        "in the schema but no control in the theme editor mentions them, so " +
          "no partner can set them — add a control, or list them in EXEMPT " +
          "with a reason"
      )
    ).toBe("")
  })
})

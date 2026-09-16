#!/usr/bin/env node
/**
 * Phantom-import gate.
 *
 * A "phantom import" is a bare import of a package that no package.json in this
 * workspace (nor the repo root) declares. It resolves anyway because `.npmrc`
 * sets `shamefully-hoist=true`, which flattens every transitive dependency into
 * one shared slot at the repo root — so the import is a bet that some *other*
 * package keeps pulling that dependency in, at a version that still works.
 *
 * `prod-build` cannot catch this class. It runs the real build, and the real
 * build resolves through the same hoist, so it only goes red on the machines
 * where the slot happens to come up empty. That is how `@jest/core` (#2093) sat
 * undeclared since #1187: green in CI for months, red on one laptop. The bet is
 * also what broke the image build in #2088, one package over — there the slot
 * was filled, just by the wrong version.
 *
 * This check reads the source instead of resolving it, so its answer does not
 * depend on which machine runs it.
 *
 *   node ./scripts/check-phantom-imports.mjs           # verify (CI + local)
 *   node ./scripts/check-phantom-imports.mjs --list    # show every import site
 *   node ./scripts/check-phantom-imports.mjs --prune   # rewrite the baseline
 *
 * ── Why a baseline rather than a hard fail ──────────────────────────────────
 * The backend has 39 phantom packages across 476 import sites today. Failing on
 * all of them would mean the gate could never be turned on, so `.phantom-imports.json`
 * records what is already there and the check fails only on a NEW one. Entries
 * that are no longer imported also fail, with a one-command fix (`--prune`), so
 * the list can only shrink.
 *
 * Fixing an entry means declaring the dependency in apps/backend/package.json at
 * the version already resolved (`pnpm why <pkg>`), then `--prune`.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs"
import { join, dirname, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { builtinModules } from "node:module"

const backendDir = join(dirname(fileURLToPath(import.meta.url)), "..")
const repoRoot = join(backendDir, "..", "..")
const baselinePath = join(backendDir, ".phantom-imports.json")

const mode = process.argv.includes("--prune")
  ? "prune"
  : process.argv.includes("--list")
    ? "list"
    : "check"

const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, "utf8"))
  } catch {
    return null
  }
}

/**
 * Walk `src`, handing each character to `onChar` with a flag saying whether it
 * sits inside a string/template literal. Comments are reported as `inComment`.
 *
 * Both tsconfigs here are JSONC — trailing commas, and a `paths` key of "@/*"
 * whose `/*` a naive comment regex reads as the start of a block comment. Doing
 * this character-wise is what keeps those two from destroying each other.
 */
const scan = (src, onChar) => {
  let i = 0
  while (i < src.length) {
    const c = src[i]
    const next = src[i + 1]
    if (c === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") onChar(src[i++], { inComment: true })
    } else if (c === "/" && next === "*") {
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) onChar(src[i++], { inComment: true })
      onChar(src[i++] ?? "", { inComment: true })
      onChar(src[i++] ?? "", { inComment: true })
    } else if (c === '"' || c === "'" || c === "`") {
      const quote = c
      onChar(src[i++], { inString: true })
      while (i < src.length && src[i] !== quote) {
        if (src[i] === "\\") { onChar(src[i++], { inString: true }); onChar(src[i++] ?? "", { inString: true }); continue }
        onChar(src[i++], { inString: true })
      }
      onChar(src[i++] ?? "", { inString: true })
    } else {
      onChar(src[i++], {})
    }
  }
}

/** Blank out comments, preserving newlines so line numbers still line up. */
const stripComments = (src) => {
  let out = ""
  scan(src, (c, { inComment }) => { out += inComment ? (c === "\n" ? "\n" : " ") : c })
  return out
}

/** JSON.parse for JSONC: tolerates comments and trailing commas. */
const readJsonc = (path) => {
  let raw
  try {
    raw = readFileSync(path, "utf8")
  } catch {
    return null
  }
  // Blank comments out, remembering which characters were inside a string so a
  // comma in a string value is never mistaken for a trailing one.
  const chars = []
  scan(raw, (c, { inComment, inString }) => {
    chars.push({ c: inComment ? (c === "\n" ? "\n" : " ") : c, inString: !!inString })
  })
  let cleaned = ""
  for (let i = 0; i < chars.length; i++) {
    if (!chars[i].inString && chars[i].c === ",") {
      let j = i + 1
      while (j < chars.length && /\s/.test(chars[j].c)) j++
      if (chars[j]?.c === "}" || chars[j]?.c === "]") continue // trailing — drop it
    }
    cleaned += chars[i].c
  }
  try {
    return JSON.parse(cleaned)
  } catch {
    return null
  }
}

// ── What counts as declared ────────────────────────────────────────────────
// The backend's own package.json, the repo root's (hoisted deliberately), and
// every workspace package by name — a workspace import is resolved by pnpm's
// link, not by the hoist, so it is not a bet.
const declared = new Set()
for (const pkgPath of [join(backendDir, "package.json"), join(repoRoot, "package.json")]) {
  const pkg = readJson(pkgPath)
  if (!pkg) continue
  for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    for (const name of Object.keys(pkg[field] ?? {})) declared.add(name)
  }
}
for (const group of ["apps", "packages"]) {
  const base = join(repoRoot, group)
  if (!existsSync(base)) continue
  for (const entry of readdirSync(base)) {
    const pkg = readJson(join(base, entry, "package.json"))
    if (pkg?.name) declared.add(pkg.name)
  }
}

const builtins = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)])

// ── What the build actually compiles ───────────────────────────────────────
// Mirror tsconfig's exclude list: a file the build skips cannot break the build.
// `src/scripts/__tests__` is NOT excluded, which is why @jest/core mattered.
const tsconfig = readJsonc(join(backendDir, "tsconfig.json")) ?? {}
// Nested tsconfigs carry their own `paths` — src/admin defines its own `@/*`,
// and reading only the root one reports every admin alias as a phantom package.
const aliases = []
const collectAliases = (dir) => {
  const cfg = readJsonc(join(dir, "tsconfig.json"))
  for (const a of Object.keys(cfg?.compilerOptions?.paths ?? {})) aliases.push(a.replace(/\*$/, ""))
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "node_modules" || entry.name.startsWith(".")) continue
    collectAliases(join(dir, entry.name))
  }
}
collectAliases(backendDir)
const excluded = (tsconfig.exclude ?? [])
  .map((p) => p.replace(/^\*\*\//, "").replace(/\/\*\*\/\*$/, "").replace(/\/\*$/, ""))
  .filter((p) => p && !p.includes("*"))

const isExcluded = (relPath) =>
  excluded.some((ex) => relPath === ex || relPath.startsWith(ex + sep))

const sourceFiles = []
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
    const full = join(dir, entry.name)
    if (isExcluded(relative(backendDir, full))) continue
    if (entry.isDirectory()) walk(full)
    else if (/\.(ts|tsx|mts|cts)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) sourceFiles.push(full)
  }
}
walk(backendDir)

// The clause between `import`/`export` and `from` may wrap over lines, but it
// can never contain a quote or a semicolon — bounding it that way keeps the
// match inside one statement. An unbounded `[\s\S]*?` here silently pairs an
// `export` with a `from "…"` hundreds of lines later and reports prose as a
// package name.
const SPECIFIER_RES = [
  /^[ \t]*(?:import|export)\s[^;"']*?\sfrom\s*["']([^"']+)["']/gm, // import/export … from "x"
  /^[ \t]*import\s*["']([^"']+)["']/gm, // side-effect import "x"
  /(?:^|[^.\w$])require\(\s*["']([^"']+)["']\s*\)/g, // require("x")
  /(?:^|[^.\w$])import\(\s*["']([^"']+)["']\s*\)/g, // dynamic import("x")
]

/** "@scope/pkg/deep" -> "@scope/pkg";  "pkg/deep" -> "pkg" */
const packageNameOf = (specifier) => {
  const parts = specifier.split("/")
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]
}

const found = new Map() // package name -> Set<relative file path>
for (const file of sourceFiles) {
  const text = stripComments(readFileSync(file, "utf8"))
  for (const re of SPECIFIER_RES) for (const match of text.matchAll(re)) {
    const specifier = match[1]
    if (!specifier || specifier.startsWith(".") || specifier.startsWith("/")) continue
    if (builtins.has(specifier)) continue
    if (aliases.some((a) => specifier.startsWith(a))) continue
    const name = packageNameOf(specifier)
    if (declared.has(name)) continue
    if (!found.has(name)) found.set(name, new Set())
    found.get(name).add(relative(repoRoot, file))
  }
}

const baseline = readJson(baselinePath)?.known ?? []
const current = [...found.keys()].sort()
const added = current.filter((name) => !baseline.includes(name))
const stale = baseline.filter((name) => !found.has(name))

if (mode === "list") {
  for (const name of current) {
    console.log(`${name}  (${found.get(name).size} sites)`)
    for (const file of [...found.get(name)].sort()) console.log(`    ${file}`)
  }
  process.exit(0)
}

if (mode === "prune") {
  writeFileSync(
    baselinePath,
    JSON.stringify(
      {
        $comment:
          "Packages imported by apps/backend but declared in no package.json — they only resolve via shamefully-hoist. Regenerate with `pnpm check:phantom-imports --prune`. This list may shrink, never grow: fix an entry by declaring the dependency.",
        known: current,
      },
      null,
      2
    ) + "\n"
  )
  console.log(`✓ Baseline written: ${current.length} phantom packages across ${sourceFiles.length} compiled files.`)
  process.exit(0)
}

console.log(`Scanned ${sourceFiles.length} compiled files — ${current.length} phantom packages, ${[...found.values()].reduce((n, s) => n + s.size, 0)} import sites.`)

if (added.length) {
  console.error(`\n✗ ${added.length} NEW phantom import(s) — not declared in any package.json:\n`)
  for (const name of added) {
    console.error(`  ${name}`)
    for (const file of [...found.get(name)].sort().slice(0, 5)) console.error(`      ${file}`)
    const extra = found.get(name).size - 5
    if (extra > 0) console.error(`      … and ${extra} more`)
  }
  console.error(
    `\n  These resolve today only because shamefully-hoist happens to fill the slot.` +
      `\n  Declare each one in apps/backend/package.json at the resolved version (\`pnpm why <pkg>\`),` +
      `\n  then re-run. To accept one deliberately: \`pnpm check:phantom-imports --prune\`.`
  )
}

if (stale.length) {
  console.error(`\n✗ ${stale.length} baseline entr(y/ies) no longer imported — the list must shrink:\n`)
  for (const name of stale) console.error(`  ${name}`)
  console.error(`\n  Fix: pnpm check:phantom-imports --prune`)
}

if (added.length || stale.length) process.exit(1)

console.log(`✓ No new phantom imports (${baseline.length} known, all still present).`)

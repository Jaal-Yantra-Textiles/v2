import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

/**
 * `RouteFocusModal`/`RouteDrawer` create the `RouteModalProvider` around their
 * OWN children. So the component that RENDERS one cannot also call
 * `useRouteModal()` — at the time its body runs, the context it is asking for
 * does not exist yet, and the route throws
 * "useRouteModal must be used within a RouteModalProvider" the moment it opens.
 *
 * The shape is always: a host renders the shell, a CHILD holds the hook.
 *
 * This is a runtime context error, so `tsc` cannot see it and neither can a
 * build — the only signal is opening the route. It has now been introduced
 * three separate times, twice leaving behind a comment warning the next person
 * (see `product-create-choice.tsx` and `product-quick-create.tsx`) and once
 * shipping to partners as the spec editor (#1349). Comments did not hold the
 * line, so this does.
 */

const SRC = join(__dirname, "..", "..", "..")

const tsxFiles = (dir: string): string[] => {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") {
      continue
    }
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...tsxFiles(full))
    } else if (entry.endsWith(".tsx")) {
      out.push(full)
    }
  }
  return out
}

/** Comments describe this trap in several files; only real code counts. */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")

/**
 * Split a module into its top-level declarations, so "the hook and the modal
 * are in the SAME component" can be asked without a real parser. A host and its
 * child living in one file is the correct shape and must not trip this.
 */
const topLevelBlocks = (source: string): string[] =>
  source.split(/\n(?=(?:export\s+)?(?:const|function|class)\s)/)

/** The Root elements — `<RouteFocusModal.Header>` and friends are fine. */
const RENDERS_ROOT = /<(RouteFocusModal|RouteDrawer)(?![.\w])/
const CALLS_HOOK = /\buseRouteModal\s*\(/

describe("useRouteModal is never called by the component that renders the modal", () => {
  const files = tsxFiles(SRC)

  it("finds source to check", () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it("has no component that both renders a route modal and calls useRouteModal", () => {
    const offenders: string[] = []

    for (const file of files) {
      const source = stripComments(readFileSync(file, "utf8"))
      if (!CALLS_HOOK.test(source)) {
        continue
      }

      for (const block of topLevelBlocks(source)) {
        if (RENDERS_ROOT.test(block) && CALLS_HOOK.test(block)) {
          const name = block.match(
            /(?:export\s+)?(?:const|function)\s+([A-Za-z0-9_]+)/
          )?.[1]
          offenders.push(`${file.replace(SRC, "src")} → ${name ?? "?"}`)
        }
      }
    }

    expect(offenders).toEqual([])
  })
})

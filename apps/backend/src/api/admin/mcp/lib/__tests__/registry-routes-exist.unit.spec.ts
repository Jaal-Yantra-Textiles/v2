/**
 * Every proxy tool must wrap a route that actually EXISTS (#1907).
 *
 * `update_product_option` shipped in #1896 pointing at
 * `POST /admin/products/:id/options/:option_id`. No such route exists — not in
 * this repo, not in core. Core only ever exposed the values through
 * `/admin/products/:id/options/batch`.
 *
 * Every registry test stayed green the whole time, because every one of them
 * asked about the registry's own internal consistency: is the tool present, is
 * it `write`, does its schema agree with its forward list, is it in a slice,
 * does its prose carry the right warning. Not one asked the only question that
 * mattered — is anything listening on the other end. So the tool advertised
 * itself, passed review, deployed, and 404'd on the first real call, weeks
 * later, against a live inventory order.
 *
 * A check that never ran reads as a pass. This is the check.
 *
 * ── How the match works ───────────────────────────────────────────────────
 *
 * Routes are files: `/admin/orders/:id` lives at `admin/orders/[id]/route.ts`.
 * Two things stop that from being a plain string comparison:
 *
 *  - Parameter NAMES need not agree. The registry says `:product_id` where
 *    core's directory is `[id]`. That is not a defect — the dispatcher
 *    substitutes positionally — so a `:param` segment matches ANY `[...]`
 *    directory at that depth.
 *  - A path can exist in BOTH trees with different verbs. `/admin/stores` is
 *    POST in this repo and GET in core. So a root that has the file but not
 *    the method is not a failure; the search continues into the next root.
 *    (Getting this wrong is what made my first pass report five phantoms that
 *    were not phantoms.)
 */
import fs from "fs"
import path from "path"
import { ADMIN_MCP_TOOLS } from "../registry"

/**
 * Repo routes take precedence, then core's compiled ones.
 *
 * Core's location is resolved through Node, not by counting `..` segments:
 * this is a pnpm workspace, so `@medusajs/medusa` is hoisted to the REPO root
 * rather than sitting under `apps/backend`, and a hand-counted relative path
 * silently resolves to nothing — which would make this guard pass every core
 * route by finding no file to disagree with.
 */
const CORE_API = path.join(
  path.dirname(require.resolve("@medusajs/medusa/package.json")),
  "dist/api"
)

const ROOTS = [
  path.resolve(__dirname, "../../../../"), // src/api
  CORE_API,
]

/** Directories a `:param` segment is allowed to match. */
const dynamicDirs = (dir: string): string[] => {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter(
      (e) => e.startsWith("[") && fs.statSync(path.join(dir, e)).isDirectory()
    )
    .map((e) => path.join(dir, e))
}

/** Every route file a path could resolve to under one root. */
const resolveRouteFiles = (root: string, routePath: string): string[] => {
  let cursor = [root]
  for (const seg of routePath.replace(/^\//, "").split("/")) {
    const next: string[] = []
    for (const dir of cursor) {
      if (seg.startsWith(":")) next.push(...dynamicDirs(dir))
      else if (fs.existsSync(path.join(dir, seg))) next.push(path.join(dir, seg))
    }
    if (!next.length) return []
    cursor = next
  }
  return cursor
    .flatMap((d) => ["route.ts", "route.js"].map((f) => path.join(d, f)))
    .filter((f) => fs.existsSync(f))
}

const exportsMethod = (file: string, method: string): boolean => {
  const src = fs.readFileSync(file, "utf8")
  return new RegExp(
    `(export\\s+const\\s+${method}\\b|export\\s+async\\s+function\\s+${method}\\b|export\\s+function\\s+${method}\\b|exports\\.${method}\\s*=)`
  ).test(src)
}

describe("every admin MCP tool wraps a route that exists (#1907)", () => {
  // Native tools run in-process and wrap no route at all.
  const proxyTools = ADMIN_MCP_TOOLS.filter((t) => !t.native && t.path)

  it("has proxy tools to check (a vacuous pass is not a pass)", () => {
    expect(proxyTools.length).toBeGreaterThan(150)
  })

  it("actually found both route trees", () => {
    // If a root resolves to nothing, every path under it reports as missing
    // and the suite becomes noise. Fail on the root, not on 50 tools.
    for (const root of ROOTS) {
      expect(`${root}:${fs.existsSync(root)}`).toBe(`${root}:true`)
    }
    expect(fs.existsSync(path.join(CORE_API, "admin/products/route.js"))).toBe(true)
  })

  it("resolves every tool's path to a real route file exporting its method", () => {
    const broken: string[] = []

    for (const def of proxyTools) {
      const method = def.method ?? "GET"
      const files = ROOTS.flatMap((r) => resolveRouteFiles(r, def.path!))

      if (!files.length) {
        broken.push(`${def.name}: NO ROUTE FILE for ${method} ${def.path}`)
        continue
      }
      if (!files.some((f) => exportsMethod(f, method))) {
        broken.push(
          `${def.name}: ${def.path} exists but exports no ${method} (${files
            .map((f) => path.relative(process.cwd(), f))
            .join(", ")})`
        )
      }
    }

    // Named, not counted: a failure here should say which tool is a phantom.
    expect(broken).toEqual([])
  })

  it("still catches a phantom when one is introduced", () => {
    // The guard is only worth having if it fails on the thing it exists for.
    // This is #1896's exact broken path.
    const files = ROOTS.flatMap((r) =>
      resolveRouteFiles(r, "/admin/products/:id/options/:option_id")
    )
    expect(files).toEqual([])
  })

  it("does not mistake a differently-named path param for a missing route", () => {
    // The registry says `:product_id`; core's directory is `[id]`.
    const def = ADMIN_MCP_TOOLS.find((t) => t.name === "create_product_variant")!
    expect(def.path).toBe("/admin/products/:product_id/variants")
    const files = ROOTS.flatMap((r) => resolveRouteFiles(r, def.path!))
    expect(files.length).toBeGreaterThan(0)
  })

  it("does not fail a path whose method lives in the OTHER root", () => {
    // `/admin/stores` is POST here and GET in core. Searching only the first
    // root that has the file would report list_stores as broken.
    const def = ADMIN_MCP_TOOLS.find((t) => t.name === "list_stores")
    if (!def?.path || def.native) return
    const files = ROOTS.flatMap((r) => resolveRouteFiles(r, def.path!))
    expect(files.some((f) => exportsMethod(f, "GET"))).toBe(true)
  })

  it("points update_product_option at the batch route that actually exists", () => {
    const def = ADMIN_MCP_TOOLS.find((t) => t.name === "update_product_option")!
    expect(def.path).toBe("/admin/products/:id/options/batch")
    // Additive now, not a whole-list rewrite: the destructive `values` shape
    // belonged to the route that was never there.
    expect(def.bodyParams).toEqual(["update"])
    expect(def.description).toMatch(/ADDITIVE/)
  })
})

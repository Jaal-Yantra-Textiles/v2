/**
 * Seed fresh data, then drive the #2018 UI in a visible browser.
 *
 * Everything is local: the seed writes to localhost:9000 and the browser hits
 * the vite dev server. Nothing here touches prod.
 *
 *   MEDUSA_ADMIN_KEY=sk_... node apps/partner-ui/e2e/run.mjs
 *   E2E_HEADED=0 ...                      # headless, for CI
 */
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const here = dirname(fileURLToPath(import.meta.url))

console.log("▶ seeding a partner + an OFFERED design work-order…")
const fixture = execFileSync("node", [join(here, "seed.mjs")], {
  encoding: "utf-8",
  env: process.env,
}).trim()
console.log(fixture)

execFileSync("node", [join(here, "action-first.spec.mjs")], {
  stdio: "inherit",
  env: { ...process.env, E2E_FIXTURE: fixture },
})

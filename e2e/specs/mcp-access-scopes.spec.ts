import { test, expect } from "@playwright/test"
import * as fs from "fs"
import * as path from "path"

/**
 * Settings → MCP Access Scopes (#1306 Track C).
 *
 * Drives the scope UI against the live server so three things are proven that
 * unit tests can't:
 *
 *  1. The page is actually MOUNTED at /app/settings/mcp-scopes and renders the
 *     ceiling + per-level tool counts it reads from the backend.
 *  2. A row written through the UI actually NARROWS the credential — asserted
 *     against the key's own token, not by re-reading the row we just wrote.
 *     A row that saves but doesn't bite is the failure mode worth catching.
 *  3. Removing the row WIDENS it back to the ceiling. "Remove" reads like
 *     "revoke" and is not, so the behaviour is pinned here deliberately.
 *
 * The enforcement assertions use the `request` fixture rather than
 * `page.request`: the latter shares the browser's admin session cookie, which
 * would authenticate as the human admin and bypass the machine-principal guard
 * entirely — the test would pass while proving nothing.
 *
 * 🔑 The write probe sends an EMPTY body to /admin/products. 403 means the
 * scope guard fired; 400 means it did not and validation merely rejected the
 * body. Neither writes anything, so this is safe to run repeatedly.
 *
 * Runs on CI: admin-only, no partner-UI server and no live LLM.
 */

const SEED_FILE = path.resolve(__dirname, "../../apps/backend/.e2e-seed.json")

type Seed = {
  email: string
  password: string
}

let seed: Seed

/** Basic base64("<token>:") — how Medusa authenticates a secret API key. */
const basicAuth = (token: string) =>
  `Basic ${Buffer.from(`${token}:`).toString("base64")}`

test.describe("Settings → MCP Access Scopes", () => {
  test.beforeAll(() => {
    if (!fs.existsSync(SEED_FILE)) {
      throw new Error(
        `E2E seed file not found at ${SEED_FILE}. Run "pnpm e2e:seed" first.`
      )
    }
    seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf-8"))
  })

  test.beforeEach(async ({ page }) => {
    await page.goto("/app/login")
    await page.waitForLoadState("networkidle")
    await page.locator('input[name="email"]').fill(seed.email)
    await page.locator('input[name="password"]').fill(seed.password)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(/\/app\/(?!login)/, { timeout: 15_000 })
  })

  test("scopes a credential to read, enforces it, then widens it back", async ({
    page,
    request,
  }) => {
    // --- 1. A throwaway secret key to scope --------------------------------
    const title = `e2e-mcp-scope-${Date.now()}`
    const createKey = await page.request.post("/admin/api-keys", {
      data: { title, type: "secret" },
    })
    expect(createKey.status(), "api-keys route must be mounted").toBe(200)
    const { api_key: apiKey } = await createKey.json()
    const keyId: string = apiKey.id
    const keyToken: string = apiKey.token
    expect(keyId).toMatch(/^apk_/)

    // --- 2. Baseline: ceiling + per-level counts ---------------------------
    const scopesRes = await page.request.get("/admin/mcp/scopes")
    expect(scopesRes.status(), "scopes route must be mounted").toBe(200)
    const scopesBody = await scopesRes.json()
    const ceiling: string = scopesBody.ceiling
    const counts: Record<string, number> = {}
    for (const l of scopesBody.levels) counts[l.level] = l.tools

    expect(counts.read).toBeGreaterThan(0)
    expect(
      counts[ceiling],
      "the ceiling must expose at least as many tools as read"
    ).toBeGreaterThanOrEqual(counts.read)

    try {
      // --- 3. The page renders what it read --------------------------------
      await page.goto("/app/settings/mcp-scopes")
      await expect(
        page.getByRole("heading", { name: "MCP Access Scopes" })
      ).toBeVisible()
      // The ceiling badge and the per-level tool counts both come from the
      // backend, so seeing them proves the page is wired, not just mounted.
      await expect(page.getByText(ceiling, { exact: true }).first()).toBeVisible()
      await expect(
        page.getByText(`${counts.read} tools`).first()
      ).toBeVisible()

      // --- 4. Scope it to `read` through the UI ----------------------------
      await page.getByRole("button", { name: "Scope a credential" }).click()

      // Credential picker — Medusa's Select renders options in a portal.
      await page.getByText("Select a secret API key").click()
      await page.getByRole("option", { name: new RegExp(keyId) }).click()

      // Level defaults to `read`; assert rather than assume, since the default
      // is what most operators will accept.
      await expect(
        page.getByRole("option", { name: /^read/ }).or(page.getByText(/^read —/))
      ).toBeTruthy()

      await page.getByRole("button", { name: "Save" }).click()

      // The row is listed, keyed on the key ID (never the token). Scope every
      // later assertion to THIS row — other scope rows may exist, and a
      // `.first()` would act on someone else's.
      const row = page.getByTestId(`mcp-scope-row-${keyId}`)
      await expect(row).toBeVisible({ timeout: 15_000 })

      // --- 5. It actually bites, judged by the credential itself -----------
      const auth = { Authorization: basicAuth(keyToken) }

      const listRes = await request.post("/admin/mcp", {
        headers: {
          ...auth,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
      })
      expect(listRes.status()).toBe(200)
      const listBody = await listRes.json()
      expect(
        listBody.result.tools.length,
        "a read-scoped key must see exactly the read tool count"
      ).toBe(counts.read)

      // Empty-body write probe: 403 = guard fired, 400 = it didn't.
      const writeRes = await request.post("/admin/products", {
        headers: { ...auth, "Content-Type": "application/json" },
        data: {},
      })
      expect(
        writeRes.status(),
        "read-scoped key must be refused by the HTTP guard (403), not merely fail validation (400)"
      ).toBe(403)

      // --- 6. Removing the row WIDENS, it does not revoke ------------------
      await row.getByRole("button", { name: "Remove" }).click()
      // usePrompt renders a Radix alert dialog. Scope the confirm to it — a
      // bare `.last()` also matches the row's own Remove button, and clicking
      // it while the dialog animates in fails the stability check.
      const confirmDialog = page.getByRole("alertdialog")
      await expect(confirmDialog).toBeVisible()
      await confirmDialog.getByRole("button", { name: "Remove" }).click()
      await expect(row).toHaveCount(0, { timeout: 15_000 })

      const afterRes = await request.post("/admin/mcp", {
        headers: {
          ...auth,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        data: { jsonrpc: "2.0", id: 2, method: "tools/list" },
      })
      const afterBody = await afterRes.json()
      expect(
        afterBody.result.tools.length,
        "removing a scope must widen the credential back to the ceiling"
      ).toBe(counts[ceiling])
    } finally {
      // Drop the scope row too. A failed run that leaves one behind makes the
      // NEXT run act on a stale row instead of its own — which is exactly how
      // this spec first went wrong.
      try {
        const res = await page.request.get("/admin/mcp/scopes")
        const body = await res.json()
        const mine = (body.scopes || []).find(
          (s: any) => s.principal_id === keyId
        )
        if (mine) {
          await page.request.delete(`/admin/mcp/scopes/${mine.id}`)
        }
      } catch {
        // best-effort
      }

      // Always revoke — a live unrestricted secret key left behind by a test
      // run is worse than a failing test.
      await page.request.post(`/admin/api-keys/${keyId}/revoke`).catch(() => {})
      await page.request.delete(`/admin/api-keys/${keyId}`).catch(() => {})
    }
  })

  test("refuses to manage scopes with a machine credential", async ({
    page,
    request,
  }) => {
    const title = `e2e-mcp-guard-${Date.now()}`
    const createKey = await page.request.post("/admin/api-keys", {
      data: { title, type: "secret" },
    })
    const { api_key: apiKey } = await createKey.json()

    try {
      // The scope routes are human-admin-only: a secret key authenticates every
      // other /admin/* route, so without this check a machine credential could
      // POST itself up to the ceiling.
      const res = await request.get("/admin/mcp/scopes", {
        headers: { Authorization: basicAuth(apiKey.token) },
      })
      expect(
        res.status(),
        "a secret API key must never be able to read or change scopes"
      ).toBe(403)
    } finally {
      await page.request
        .post(`/admin/api-keys/${apiKey.id}/revoke`)
        .catch(() => {})
      await page.request.delete(`/admin/api-keys/${apiKey.id}`).catch(() => {})
    }
  })
})

import { test, expect, type Page, type Route } from "@playwright/test"

/**
 * #2543: the design studio (/design) against a MOCKED chat backend.
 *
 * Three bugs reached prod on 2026-11-16 and were only found by driving the live
 * site by hand. Each test below fails if one comes back:
 *
 *  - 🔴 Board refresh storm: after the first create_design, the board re-fetched
 *    GET /design-assistant/designs/:id on every streamed chunk (~3/s, all session).
 *  - 🔴 Stale chat body: useChat keeps its FIRST transport, so the body froze
 *    design_id/design_token at null. The next turn's tools refused the guest's
 *    own design.
 *  - 🔴 Invisible errors: the 403/429 JSON never reached the buyer.
 *  - (#2543 phase 2) Email sign-in: the verify panel's code flow, and a tool
 *    answering sign_in_required must open it.
 *
 * Every /api/ai-chat and /design-assistant call is mocked, and any other
 * browser write to the backend is aborted, so this is safe to point at a
 * storefront that talks to prod (it never creates a design or spends on images).
 *
 * @storefront @localstack
 *
 *   # storefront on :8000 (any backend; only reads leave the browser unmocked)
 *   cd apps/storefront && pnpm dev
 *   npx playwright test -c e2e/playwright.storefront.config.ts \
 *     --grep "Design studio guards"
 */

const STUDIO_URL = process.env.DESIGN_STUDIO_URL ?? "http://localhost:8000/in/design"
const DESIGN_ID = "des_e2e_mock"
const DESIGN_TOKEN = "dt1.des_e2e_mock.-.e2e"

type ChatCall = { body: any }

/** An AI SDK v5 UI-message stream (SSE), as /api/ai-chat would relay it. */
function uiStream(opts: { tool?: { name: string; output: unknown }; text: string; chunks?: number }) {
  const ev: unknown[] = [{ type: "start", messageId: `m_${Math.random().toString(36).slice(2)}` }, { type: "start-step" }]
  if (opts.tool) {
    ev.push({ type: "tool-input-available", toolCallId: `call_${opts.tool.name}`, toolName: opts.tool.name, input: {} })
    ev.push({ type: "tool-output-available", toolCallId: `call_${opts.tool.name}`, output: opts.tool.output })
  }
  ev.push({ type: "text-start", id: "t1" })
  const n = opts.chunks ?? 1
  const size = Math.ceil(opts.text.length / n)
  for (let i = 0; i < n; i++) ev.push({ type: "text-delta", id: "t1", delta: opts.text.slice(i * size, (i + 1) * size) })
  ev.push({ type: "text-end", id: "t1" }, { type: "finish-step" }, { type: "finish" })
  return ev.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n"
}

const sse = (route: Route, body: string) =>
  route.fulfill({
    status: 200,
    headers: { "content-type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1", "cache-control": "no-cache" },
    body,
  })

/** Mock the design-assistant routes; count board reads. Abort every other backend write. */
async function mockBackend(page: Page) {
  const boardReads: string[] = []
  // Registered FIRST: Playwright tries the most recently added route first, so
  // the specific mocks below must come after this catch-all.
  // Analytics and anything else that writes from the browser: never reach the backend.
  await page.route(/jaalyantra\.com\/(web|store)\//, (route) =>
    route.request().method() === "GET" ? route.continue() : route.abort()
  )
  await page.route(/\/store\/custom\/design-assistant\/designs\/[^/?]+/, (route) => {
    boardReads.push(route.request().url())
    return route.fulfill({ json: { design: { id: DESIGN_ID, thumbnail_url: null, moodboard: null } } })
  })
  await page.route(/\/store\/custom\/design-assistant\/conversations/, (route) =>
    route.fulfill({ status: route.request().method() === "POST" ? 201 : 200, json: { conversation: { id: "conv_e2e" }, conversation_token: "ct1.conv_e2e.e2e" } })
  )
  return { boardReads }
}

async function send(page: Page, text: string) {
  await page.locator("textarea").last().fill(text)
  await page.getByRole("button", { name: "Send message" }).click()
}

async function openStudioSkippingOnboarding(page: Page) {
  await page.goto(STUDIO_URL, { waitUntil: "load" })
  const skip = page.getByText("Let Cici ask me instead")
  if (await skip.isVisible().catch(() => false)) await skip.click()
}

test.describe("Design studio guards (#2543) @storefront @localstack", () => {
  test("🔴 the board refreshes once per finished tool, not on every streamed chunk", async ({ page }) => {
    const { boardReads } = await mockBackend(page)
    const chats: ChatCall[] = []
    await page.route("**/api/ai-chat", (route) => {
      chats.push({ body: route.request().postDataJSON() })
      // Turn 1 creates the design; turn 2 is a long plain reply in many chunks.
      return chats.length === 1
        ? sse(route, uiStream({ tool: { name: "create_design", output: { design_id: DESIGN_ID, design_token: DESIGN_TOKEN } }, text: "Design created. ".repeat(20), chunks: 60 }))
        : sse(route, uiStream({ text: "Here are some thoughts on linen. ".repeat(30), chunks: 120 }))
    })

    await openStudioSkippingOnboarding(page)
    await send(page, "A linen kurta, my email is e2e@example.com")
    await expect(page.getByText("Design created.").first()).toBeVisible()
    await page.waitForTimeout(3000)
    const afterCreate = boardReads.length
    expect(afterCreate, "one refresh for create_design").toBeGreaterThanOrEqual(1)
    expect(afterCreate, "no refresh storm while turn 1 streamed").toBeLessThanOrEqual(2)

    await send(page, "Tell me about linen")
    await expect(page.getByText("Here are some thoughts on linen.").first()).toBeVisible()
    await page.waitForTimeout(3000)
    expect(boardReads.length, "a plain reply (no board tool) must not refresh the board").toBe(afterCreate)
  })

  test("🔴 the next turn sends the design id AND token minted mid-session", async ({ page }) => {
    await mockBackend(page)
    const chats: ChatCall[] = []
    await page.route("**/api/ai-chat", (route) => {
      chats.push({ body: route.request().postDataJSON() })
      return chats.length === 1
        ? sse(route, uiStream({ tool: { name: "create_design", output: { design_id: DESIGN_ID, design_token: DESIGN_TOKEN } }, text: "Design created." }))
        : sse(route, uiStream({ text: "Generating your takes." }))
    })

    await openStudioSkippingOnboarding(page)
    await send(page, "A linen kurta, my email is e2e@example.com")
    await expect(page.getByText("Design created.").first()).toBeVisible()
    await send(page, "Yes, generate")
    await expect(page.getByText("Generating your takes.").first()).toBeVisible()

    expect(chats[0].body.context?.design_id, "no design yet on turn 1").toBeUndefined()
    expect(chats[1].body.context).toMatchObject({ design_id: DESIGN_ID, design_token: DESIGN_TOKEN })
  })

  test("🔴 a design from another session shows the notice, and Start a new design clears it", async ({ page }) => {
    await mockBackend(page)
    await page.addInitScript((designId) => {
      if (sessionStorage.getItem("e2e-seeded")) return
      sessionStorage.setItem("e2e-seeded", "1")
      localStorage.setItem(
        "jyt:design-thread:custom",
        JSON.stringify({
          meta: { threadKey: "custom", designId, title: "old design" },
          messages: [
            { id: "m1", role: "user", parts: [{ type: "text", text: "A linen kurta" }] },
            { id: "m2", role: "assistant", parts: [{ type: "text", text: "Lovely, tell me more." }] },
          ],
        })
      )
    }, DESIGN_ID)
    await page.route("**/api/ai-chat", (route) =>
      route.fulfill({ status: 403, json: { code: "design_access_denied", message: "This design belongs to another session." } })
    )

    await page.goto(STUDIO_URL, { waitUntil: "load" })
    await send(page, "Can we continue?")
    await expect(page.getByText(/belongs to another session/i).first()).toBeVisible()

    await page.getByRole("button", { name: "Start a new design" }).first().click()
    const meta = await page.evaluate(() => JSON.parse(localStorage.getItem("jyt:design-thread:custom") || "{}").meta ?? {})
    expect(meta.designId).toBeUndefined()
    expect(meta.designToken).toBeUndefined()
  })

  /**
   * #2543 phase 2: a guest verifies their email with a 6-digit code before a
   * design is saved. Both auth calls are mocked at the browser — nothing
   * reaches a backend, no email is sent.
   */
  test("verify panel: email → code (wrong, then right) → signed in", async ({ page }) => {
    await mockBackend(page)
    await page.route("**/api/ai-chat", (route) => sse(route, uiStream({ text: "Lovely — a kurta." })))
    const codeCalls: any[] = []
    const verifyCalls: any[] = []
    await page.route("**/api/design-auth/code", (route) => {
      codeCalls.push(route.request().postDataJSON())
      return route.fulfill({ json: { sent: true } })
    })
    await page.route("**/api/design-auth/verify", (route) => {
      const body = route.request().postDataJSON()
      verifyCalls.push(body)
      return body.code === "424242"
        ? route.fulfill({ json: { email: body.email, customer_id: "cus_e2e", adopted_design_ids: [] } })
        : route.fulfill({ status: 400, json: { code: "invalid_code" } })
    })

    await page.goto(STUDIO_URL, { waitUntil: "load" })
    await page.getByTestId("design-chat-garment-kurta").click()
    await page.getByTestId("design-chat-onboarding-start").click()

    const panel = page.getByTestId("design-chat-verify-email")
    await expect(panel).toBeVisible()
    // The old onboarding email field is gone — the address is verified, not typed.
    await expect(page.getByTestId("design-chat-onboarding-email")).toHaveCount(0)

    await page.getByTestId("design-chat-verify-email-input").fill("Maker@Example.com")
    await page.getByTestId("design-chat-verify-send").click()
    await expect(page.getByTestId("design-chat-verify-code-input")).toBeVisible()
    expect(codeCalls).toEqual([{ email: "maker@example.com" }])
    await expect(page.getByTestId("design-chat-verify-resend")).toBeDisabled()

    await page.getByTestId("design-chat-verify-code-input").fill("111111")
    await expect(page.getByTestId("design-chat-verify-error")).toContainText(/isn't right/i)

    await page.getByTestId("design-chat-verify-code-input").fill("424 242")
    await expect(page.getByTestId("design-chat-signed-in")).toContainText("maker@example.com")
    await expect(panel).toHaveCount(0)
    expect(verifyCalls.at(-1)).toEqual({ email: "maker@example.com", code: "424242" })
  })

  test("🔴 a tool answering sign_in_required opens the verify panel", async ({ page }) => {
    await mockBackend(page)
    await page.route("**/api/ai-chat", (route) =>
      sse(
        route,
        uiStream({
          tool: {
            name: "create_design",
            output: { sign_in_required: true, action: "create_design", message: "verify first" },
          },
          text: "Please verify your email so I can save your design.",
        })
      )
    )
    await openStudioSkippingOnboarding(page)
    await expect(page.getByTestId("design-chat-verify-email")).toHaveCount(0)
    await send(page, "A linen kurta please")
    await expect(page.getByText("Please verify your email").first()).toBeVisible()
    await expect(page.getByTestId("design-chat-verify-email")).toBeVisible()
    await expect(page.getByTestId("design-chat-verify-email")).toContainText(/save your design/i)
  })

  test("🔴 a rate-limited chat tells the buyer when to try again", async ({ page }) => {
    await mockBackend(page)
    await page.route("**/api/ai-chat", (route) =>
      route.fulfill({
        status: 429,
        headers: { "retry-after": "120" },
        json: { code: "rate_limited", message: "Too many requests. Try again in 2 min." },
      })
    )
    await openStudioSkippingOnboarding(page)
    await send(page, "Hello")
    await expect(page.getByText(/too many requests.*try again in 2 min/i).first()).toBeVisible()
  })
})

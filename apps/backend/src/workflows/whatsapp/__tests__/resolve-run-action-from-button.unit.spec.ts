/**
 * The button → (action, run) resolution shared by the consent gate and the
 * command path (#2211).
 *
 * Before this function existed only the command path could answer the
 * question, and the consent gate — which runs FIRST on a partner's very first
 * message — silently dropped the tap. Two of Ksaman Naturals' three "Accept"
 * taps on 2026-09-09 died there, and nine days later the platform reassigned
 * one of those runs away from her for "no response".
 *
 * 🔴 Lazily imported. A top-level import of the handler pulls its workflow
 * graph at module-eval time; if that throws, jest reports the suite as 0
 * tests beside a green "passed" line.
 */
let resolveRunActionFromButton: any

beforeAll(async () => {
  ;({ resolveRunActionFromButton } = await import(
    "../whatsapp-message-handler"
  ))
})

describe("resolveRunActionFromButton", () => {
  it("loads the module under test", () => {
    // Guards the lazy import above: if the handler fails to evaluate, this
    // fails loudly instead of the suite reporting nothing.
    expect(typeof resolveRunActionFromButton).toBe("function")
  })

  describe("native interactive ids carry their own run", () => {
    it("splits <action>_<runId>", () => {
      expect(
        resolveRunActionFromButton("accept_prod_run_123", undefined, {})
      ).toEqual({ action: "accept", runId: "prod_run_123" })
    })

    it("rejoins a run id that contains underscores", () => {
      expect(
        resolveRunActionFromButton(
          "start_prod_run_01M22YXTZKQXBSD23MZAQBVRTE",
          undefined,
          {}
        )
      ).toEqual({
        action: "start",
        runId: "prod_run_01M22YXTZKQXBSD23MZAQBVRTE",
      })
    })

    it("ignores pending_run_id — the id in the button wins", () => {
      expect(
        resolveRunActionFromButton("accept_prod_run_real", undefined, {
          pending_run_id: "prod_run_stale",
        })
      ).toEqual({ action: "accept", runId: "prod_run_real" })
    })
  })

  describe("template quick-replies carry only a title", () => {
    it("maps the localized title to an action and pins the run from the conversation", () => {
      expect(
        resolveRunActionFromButton("Accept", "Accept", {
          pending_run_id: "prod_run_01M22YXTZKQXBSD23MZAQBVRTE",
        })
      ).toEqual({
        action: "accept",
        runId: "prod_run_01M22YXTZKQXBSD23MZAQBVRTE",
      })
    })

    it("🔴 returns an EMPTY run id rather than guessing when nothing is pinned", () => {
      /*
       * Meta forbids variables in template quick-reply buttons, so the tap
       * genuinely carries no run. Empty is the honest answer; the caller asks
       * the partner which run they meant. Inventing one here would move a run
       * nobody named.
       */
      const out = resolveRunActionFromButton("Accept", "Accept", {})
      expect(out).toEqual({ action: "accept", runId: "" })
    })
  })

  describe("decline keeps its reason token out of the run id", () => {
    it("a bare Decline is the assignment button", () => {
      expect(
        resolveRunActionFromButton("decline_prod_run_123", undefined, {})
      ).toEqual({ action: "decline", runId: "prod_run_123" })
    })
  })

  it("returns null for an empty button id, so a non-button message falls through", () => {
    expect(resolveRunActionFromButton("", undefined, {})).toBeNull()
  })
})

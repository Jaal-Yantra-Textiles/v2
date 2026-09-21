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
 * ⚠️ Imported STATICALLY, like every other spec in src/. A dynamic
 * `await import("../whatsapp-message-handler")` is what jest's unit config
 * wants, but `medusa build` compiles src/** — __tests__ included — under
 * `moduleResolution: node16`, which rejects a relative dynamic import with no
 * file extension (TS2835). That broke prod-build while the unit suite and a
 * scoped tsc both stayed green.
 *
 * The cost is that a module-eval failure here takes the whole suite down
 * rather than failing one test — so read the **Test Suites:** line, not just
 * Tests:, when this file goes quiet.
 */
import {
  resolveRunActionFromButton,
  runIdFromContextId,
  isTemplateTitleButton,
} from "../whatsapp-message-handler"

describe("resolveRunActionFromButton", () => {
  it("the module under test actually loaded", () => {
    // Cheap canary. With a static import a load failure kills the suite, so
    // this only catches the milder case of the export going missing.
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

/**
 * The run a stored outbound row names (#2212).
 *
 * This is what lets a template tap beat `pending_run_id`: WhatsApp tells us
 * which message the button belonged to, and our own row for that message is
 * tagged with the run.
 */
describe("runIdFromContextId", () => {
  it("reads a bare assignment context", () => {
    expect(
      runIdFromContextId("production_run", "prod_run_01M22YXTZKQXBSD23MZAQBVRTE")
    ).toBe("prod_run_01M22YXTZKQXBSD23MZAQBVRTE")
  })

  it("🔴 strips the per-day dedup suffix a reminder carries", () => {
    /*
     * Real shape from prod: reminders need a distinct key per day, so the
     * context id is `<run>:reminder:<date>`. Returning that whole string
     * would look like a run id and match nothing.
     */
    expect(
      runIdFromContextId(
        "production_run",
        "prod_run_01M22YXTZKQXBSD23MZAQBVRTE:reminder:2026-09-15"
      )
    ).toBe("prod_run_01M22YXTZKQXBSD23MZAQBVRTE")
  })

  it("ignores a context that is not about a run", () => {
    expect(runIdFromContextId("design", "01M22YVTXMY4Z2F6C662TTW403")).toBeNull()
    expect(runIdFromContextId(null, "prod_run_1")).toBeNull()
  })

  it("🔴 refuses a value that is not a run id rather than passing it through", () => {
    // A mis-tagged row must read as "no answer", so the caller falls back to
    // the slot instead of dispatching against a design id.
    expect(runIdFromContextId("production_run", "01M22YVTX")).toBeNull()
    expect(runIdFromContextId("production_run", "")).toBeNull()
    expect(runIdFromContextId("production_run", null)).toBeNull()
  })
})

describe("isTemplateTitleButton", () => {
  it("is true for a template quick-reply, which carries no run id", () => {
    expect(isTemplateTitleButton("Accept", "Accept")).toBe(true)
  })

  it("🔴 is false for a native id — it names its own run and must not be overridden", () => {
    expect(isTemplateTitleButton("accept_prod_run_123", undefined)).toBe(false)
  })

  it("is false when there is no button at all", () => {
    expect(isTemplateTitleButton(undefined, undefined)).toBe(false)
  })
})

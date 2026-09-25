import { classifyAwaitingDispatch } from "../runs-awaiting-dispatch"

/**
 * The rule behind the `runs-awaiting-dispatch` board (#2202).
 *
 * The board's whole value is one distinction: a run waiting correctly for
 * cloth on its way, versus a run whose cloth arrived and which nothing will
 * ever dispatch. Both are `approved`/`idle` in the database, so if this
 * classifier is wrong the board is worse than useless — it reports calm.
 */
describe("classifyAwaitingDispatch", () => {
  const run = (over: Record<string, unknown> = {}) => ({
    id: "prod_run_1",
    status: "approved",
    dispatch_state: "idle",
    ...over,
  })

  describe("held — a dependency is outstanding", () => {
    it("is held whatever else is true, because upstream decides first", () => {
      expect(
        classifyAwaitingDispatch({
          run: run({ dispatch_template_ids: ["tpl_1"] }),
          unmetReason: "goods to be delivered (io_1)",
          policyTemplateIds: ["tpl_policy"],
        })
      ).toEqual({ kind: "held", reason: "goods to be delivered (io_1)" })
    })

    it("carries the reason through verbatim, so the node can name what is missing", () => {
      const verdict = classifyAwaitingDispatch({
        run: run(),
        unmetReason: "runs to complete (prod_run_9)",
        policyTemplateIds: null,
      })
      expect(verdict).toEqual({
        kind: "held",
        reason: "runs to complete (prod_run_9)",
      })
    })
  })

  describe("cannot_self_dispatch — the row this board exists for", () => {
    it("is stuck when nothing upstream is outstanding and nothing names templates", () => {
      expect(
        classifyAwaitingDispatch({
          run: run(),
          unmetReason: null,
          policyTemplateIds: null,
        })
      ).toEqual({ kind: "cannot_self_dispatch" })
    })

    it("is stuck for a run born from an order, which can never be approved into templates", () => {
      /*
       * The live instance from #2202: one run per order_line_item_id, so no
       * child can be fanned out and no route can ever store templates on it.
       * `dispatch_template_ids` is null and stays null.
       */
      expect(
        classifyAwaitingDispatch({
          run: run({
            id: "prod_run_01M1NRXRPG8YEX737CQNR5ZTYT",
            order_line_item_id: "ordli_01M1NRXM305YZV7X7KHYR4MSXM",
            dispatch_template_ids: null,
            dispatch_template_names: null,
          }),
          unmetReason: null,
          policyTemplateIds: null,
        })
      ).toEqual({ kind: "cannot_self_dispatch" })
    })

    it("treats an EMPTY template array as no answer, not as an answer", () => {
      /*
       * `[]` is not `null` and a truthiness check on the column would pass it.
       * `selectDispatchInput` cleans first, and this asserts the board inherits
       * that rather than reading the raw field.
       */
      expect(
        classifyAwaitingDispatch({
          run: run({ dispatch_template_ids: [], dispatch_template_names: [] }),
          unmetReason: null,
          policyTemplateIds: [],
        })
      ).toEqual({ kind: "cannot_self_dispatch" })
    })

    it("treats an empty-string template id as no answer", () => {
      expect(
        classifyAwaitingDispatch({
          run: run({ dispatch_template_ids: ["", ""] as any }),
          unmetReason: null,
          policyTemplateIds: null,
        }).kind
      ).toBe("cannot_self_dispatch")
    })

    it("a WHITESPACE-only id counts as an answer — the shared selector does not trim", () => {
      /*
       * Asserted as it behaves, not as it ought to. `selectDispatchInput`
       * filters on `length`, so "  " survives and the run reads as answered;
       * dispatch would then be handed a template id that matches nothing.
       *
       * 🔴 NOT fixed here on purpose. Trimming is a change to the selector the
       * whole release path shares, and nothing yet shows a run in the database
       * carrying such an id — a repo-wide behaviour change on a hypothetical
       * is how the board and the dispatcher start disagreeing. This test
       * pins the current answer so a later trim is a deliberate, visible edit
       * rather than a silent drift between the two.
       */
      expect(
        classifyAwaitingDispatch({
          run: run({ dispatch_template_ids: ["  "] as any }),
          unmetReason: null,
          policyTemplateIds: null,
        })
      ).toEqual({ kind: "never_dispatched", via: "selection" })
    })
  })

  describe("never_dispatched — ready, answered, and going nowhere", () => {
    it("a selection on the run answers it", () => {
      expect(
        classifyAwaitingDispatch({
          run: run({ dispatch_template_ids: ["tpl_1"] }),
          unmetReason: null,
          policyTemplateIds: null,
        })
      ).toEqual({ kind: "never_dispatched", via: "selection" })
    })

    it("names on the run answer it too — ids are preferred but names dispatch", () => {
      expect(
        classifyAwaitingDispatch({
          run: run({ dispatch_template_names: ["Cutting"] }),
          unmetReason: null,
          policyTemplateIds: null,
        })
      ).toEqual({ kind: "never_dispatched", via: "selection" })
    })

    it("🔴 a standing rule is the answer when the run carries no selection", () => {
      /*
       * #2202 was written before #2206 shipped the policy fallback, so its
       * stated rule — "no dispatch_template_ids" — would have called this run
       * answerless. It is not: `releaseRunIfReady` would dispatch it by the
       * standing rule. It belongs in the never_dispatched row, whose fix is
       * one click, not in the row that needs a decision.
       */
      expect(
        classifyAwaitingDispatch({
          run: run({ dispatch_template_ids: null, run_type: "production" }),
          unmetReason: null,
          policyTemplateIds: ["tpl_policy"],
        })
      ).toEqual({ kind: "never_dispatched", via: "policy_default" })
    })

    it("🔴 ready with templates is STUCK, not fine — measured on prod", () => {
      /*
       * prod_run_01M2RV80NQJRKKHJE4S99FQ4QG, 2026-09-21. Approved, idle,
       * carrying dispatch_template_ids, depending on an inventory order
       * delivered 2026-09-17 — the dependency attached on 2026-09-20, three
       * days after the only event that could have released it.
       *
       * The first draft of this board excluded exactly this run as "has an
       * answer, will dispatch itself". It will not. Release is event-driven
       * and the event is four days gone.
       */
      expect(
        classifyAwaitingDispatch({
          run: run({
            id: "prod_run_01M2RV80NQJRKKHJE4S99FQ4QG",
            role: "stitching",
            dispatch_template_ids: ["01JSV5QCNDEY73Q3RK1EHSE44K"],
            dispatch_state: "idle",
            depends_on_inventory_order_ids: [
              "inv_order_01M232123QP7WD4E7NBSNZWJHM",
            ],
          }),
          unmetReason: null,
          policyTemplateIds: null,
        })
      ).toEqual({ kind: "never_dispatched", via: "selection" })
    })

    it("the run's own selection outranks the standing rule, as on the release path", () => {
      expect(
        classifyAwaitingDispatch({
          run: run({ dispatch_template_ids: ["tpl_human"] }),
          unmetReason: null,
          policyTemplateIds: ["tpl_policy"],
        })
      ).toEqual({ kind: "never_dispatched", via: "selection" })
    })
  })

  it("🔴 an unreadable dependency holds the run; it never promotes it to stuck", () => {
    /*
     * The resolver passes a reason string when the dependency sweep threw. A
     * database hiccup must read as "still waiting", never as "ready, and by
     * the way nobody will dispatch it" — the second would send an operator to
     * dispatch work whose cloth may not exist.
     */
    expect(
      classifyAwaitingDispatch({
        run: run(),
        unmetReason: "dependencies could not be read",
        policyTemplateIds: null,
      })
    ).toEqual({ kind: "held", reason: "dependencies could not be read" })
  })
})

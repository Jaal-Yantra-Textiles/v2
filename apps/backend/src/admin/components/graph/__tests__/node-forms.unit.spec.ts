import {
  actRail,
  actionRail,
  canApply,
  hasAffordance,
  nodeAffordance,
  type AffordanceNode,
  type FormRegistry,
} from "../node-forms"

/**
 * The affordance rules (#1847 step 3).
 *
 * Every case below is one the SCREEN cannot report: a wrong answer here is a
 * button that is missing, or one that opens a form over nothing. Fixtures are
 * built from the shapes the design spine actually emits.
 */

const registry: FormRegistry = {
  create: new Set(["tasks", "partners", "inventory"]),
  edit: new Set(["design", "palette"]),
}

const node = (over: Partial<AffordanceNode> = {}): AffordanceNode => ({
  key: "tasks",
  state: "present",
  action: null,
  ...over,
})

describe("nodeAffordance", () => {
  describe("create", () => {
    it("offers the create form on an absent node — the whole point of a dashed edge", () => {
      const a = nodeAffordance(
        node({
          key: "partners",
          state: "absent",
          action: { label: "Link a partner", href: "/designs/d1/linkPartner" },
        }),
        registry
      )

      expect(a.create).toBe(true)
      // and NOT the old link-out card beside it
      expect(a.action).toBe(false)
    })

    it("offers it on a present node too — adding a second partner is a real thing to want", () => {
      expect(nodeAffordance(node({ key: "partners" }), registry).create).toBe(true)
    })

    it("withholds it for a type with no registered form", () => {
      expect(nodeAffordance(node({ key: "consumption" }), registry).create).toBe(
        false
      )
    })
  })

  describe("edit", () => {
    it("offers the edit form on a present node", () => {
      expect(nodeAffordance(node({ key: "design" }), registry).edit).toBe(true)
    })

    it("offers it on a DERIVED node — a derived record still exists", () => {
      expect(nodeAffordance(node({ key: "design", state: "derived" }), registry).edit).toBe(
        true
      )
    })

    it("🔴 refuses it on an absent node — there is nothing on the other end to edit", () => {
      expect(nodeAffordance(node({ key: "design", state: "absent" }), registry).edit).toBe(
        false
      )
    })

    it("withholds it for a node with no registered edit form", () => {
      expect(nodeAffordance(node({ key: "tasks" }), registry).edit).toBe(false)
    })

    it("🔴 refuses it on 'Revised from', which is a DIFFERENT design of the same type", () => {
      // Both this node and the spine carry `type: "design"`. Keyed by type, the
      // design's edit form would open here and — reading the id from the URL —
      // edit the design you are looking at, not the one you clicked.
      expect(
        nodeAffordance(node({ key: "revision", state: "present" }), registry).edit
      ).toBe(false)
    })

    it("offers it on a facet of the spine record, like the palette", () => {
      expect(nodeAffordance(node({ key: "palette" }), registry).edit).toBe(true)
    })
  })

  describe("action fallback", () => {
    it("names the missing step when no form is registered", () => {
      const a = nodeAffordance(
        node({
          key: "specifications",
          state: "absent",
          action: { label: "Add construction detail", href: null },
        }),
        registry
      )

      expect(a).toEqual({ create: false, edit: false, action: true })
    })

    it("stays silent on a PRESENT node that happens to carry an action", () => {
      const a = nodeAffordance(
        node({
          key: "specifications",
          state: "present",
          action: { label: "Add construction detail", href: null },
        }),
        registry
      )

      expect(a.action).toBe(false)
    })

    it("stays silent on an absent node with no action to name", () => {
      expect(
        nodeAffordance(node({ key: "specifications", state: "absent" }), registry).action
      ).toBe(false)
    })
  })

  describe("the action rail", () => {
    const SPINE_HREF = "/designs/d1"

    const rail = (
      key: string,
      state: AffordanceNode["state"],
      href: string | null,
      action: AffordanceNode["action"] = null
    ) => actionRail(nodeAffordance(node({ key, state, action }), registry), { href, action }, SPINE_HREF)

    it("🔴 does not repeat a form — two buttons, one of them navigates away", () => {
      // The absent inventory node: a create form is offered, and its href is
      // only the design page, so there is nothing else worth a button.
      expect(
        rail("inventory", "absent", SPINE_HREF, {
          label: "Link inventory",
          href: "/designs/d1/addinv",
        })
      ).toBe("none")
    })

    it("🔴 KEEPS a real drill-in beside a form — it is the only route left to the list", () => {
      // Tasks has a create form AND a sub-page. Suppressing the whole rail here
      // stranded `/designs/:id/tasks` the moment the summary section came off
      // the design page.
      expect(rail("tasks", "present", "/designs/d1/tasks")).toBe("open")
    })

    it("names the missing step where no form is registered", () => {
      expect(
        rail("product", "absent", SPINE_HREF, {
          label: "List this run as a product",
          href: "/designs/d1/production-runs",
        })
      ).toBe("action")
    })

    it("opens a neighbour that has its own page", () => {
      expect(rail("revision", "present", "/designs/other-design")).toBe("open")
    })

    it("🔴 refuses an 'Open' that points back at the page the graph is about", () => {
      expect(rail("components", "present", SPINE_HREF)).toBe("none")
    })

    it("renders nothing for a node with neither an action nor a page", () => {
      expect(rail("consumption", "present", null)).toBe("none")
    })
  })

  it("offers nothing at all for an unmapped present node", () => {
    const a = nodeAffordance(node({ key: "orders" }), registry)

    expect(hasAffordance(a)).toBe(false)
  })

  it("an empty registry falls back to the action card and nothing else", () => {
    const empty: FormRegistry = { create: new Set(), edit: new Set() }
    const a = nodeAffordance(
      node({
        key: "partners",
        state: "absent",
        action: { label: "Link a partner", href: "/designs/d1/linkPartner" },
      }),
      empty
    )

    expect(a).toEqual({ create: false, edit: false, action: true })
  })
})

/**
 * The ACT rail (#1857). Both cases below are safety properties that look
 * identical on screen until the press lands.
 */
describe("actRail", () => {
  it("previews first where a dry run exists", () => {
    expect(actRail({ previewBody: { dry_run: true }, applyBody: { dry_run: false } })).toBe(
      "preview-then-apply"
    )
  })

  /*
   * 🔴 `previewBody: null` is "there IS no dry run", never "preview with an
   * empty body". Read the second way, the safe-looking press posts to the real
   * endpoint — and the two acts this rule was written for send a WhatsApp
   * message to a partner and push live DNS.
   */
  it("gives one confirmed press where nothing can be previewed", () => {
    expect(actRail({ previewBody: null, applyBody: { phone: "919876543210" } })).toBe(
      "confirm-once"
    )
  })

  it("renders nothing for a node that runs nothing", () => {
    expect(actRail(null)).toBe("none")
    expect(actRail(undefined)).toBe("none")
  })
})

describe("canApply", () => {
  it("withholds Apply until a preview has come back", () => {
    const act = { previewBody: { dry_run: true }, applyBody: { dry_run: false } }
    expect(canApply(act, false)).toBe(false)
    expect(canApply(act, true)).toBe(true)
  })

  /*
   * A read-only job has nothing to apply. A DISABLED Apply would imply a write
   * that is merely unavailable, when there is none to make.
   */
  it("never offers Apply where there is nothing to apply", () => {
    expect(canApply({ previewBody: { dry_run: true }, applyBody: null }, true)).toBe(false)
  })

  /*
   * 🔴 And never a SECOND button on a confirm-once act — the single button is
   * already the action, so an Apply beside it would fire it twice.
   */
  it("never adds a second button to a confirm-once act", () => {
    expect(canApply({ previewBody: null, applyBody: { phone: "9" } }, true)).toBe(false)
  })
})

/*
 * 🔴 Found by RENDERING the partner spine, not by any test that existed. The
 * WhatsApp node drew "Verify the number" TWICE — the working act directly
 * above the old `action`, whose href is null and which therefore renders as a
 * dead disabled button with identical words. #1854, repeated by the thing
 * meant to retire it.
 */
describe("the action rail does not repeat the act", () => {
  const none = { create: false, edit: false, action: false }

  it("stands down where the node runs something", () => {
    expect(
      actionRail(
        none,
        {
          href: null,
          action: { label: "Verify the number", href: null },
          act: { previewBody: null, applyBody: { phone: "9" } },
        },
        null
      )
    ).toBe("none")
  })

  it("still names the step where there is no act", () => {
    expect(
      actionRail(none, { href: null, action: { label: "Verify the number", href: null } }, null)
    ).toBe("action")
  })

  /*
   * `open` is a different question — the neighbour's own page, not a job — so
   * an act must not swallow a real drill-in.
   */
  it("keeps a real drill-in beside an act", () => {
    expect(
      actionRail(
        none,
        {
          href: "/partners/p_1/tasks",
          action: { label: "Verify the number", href: null },
          act: { previewBody: null, applyBody: {} },
        },
        "/partners/p_1"
      )
    ).toBe("open")
  })
})

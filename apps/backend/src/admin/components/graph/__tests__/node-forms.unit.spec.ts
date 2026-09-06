import {
  hasAffordance,
  nodeAffordance,
  showsActionRail,
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
    it("🔴 stands down where a create form is offered — two buttons, one a trap", () => {
      const a = nodeAffordance(
        node({
          key: "inventory",
          state: "absent",
          action: { label: "Link inventory", href: "/designs/d1/addinv" },
        }),
        registry
      )

      expect(a.create).toBe(true)
      expect(showsActionRail(a)).toBe(false)
    })

    it("stands down where an edit form is offered", () => {
      expect(showsActionRail(nodeAffordance(node({ key: "design" }), registry))).toBe(
        false
      )
    })

    it("stays for a node with no form of its own", () => {
      expect(
        showsActionRail(
          nodeAffordance(
            node({
              key: "product",
              state: "absent",
              action: { label: "List this run as a product", href: "/designs/d1/runs" },
            }),
            registry
          )
        )
      ).toBe(true)
    })

    it("stays for a plain present node, which is where 'Open' lives", () => {
      expect(showsActionRail(nodeAffordance(node({ key: "orders" }), registry))).toBe(
        true
      )
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

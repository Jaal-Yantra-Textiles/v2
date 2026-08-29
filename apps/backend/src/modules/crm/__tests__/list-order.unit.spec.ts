import {
  CRM_ORDERABLE_FIELDS,
  parseListOrder,
  serializeListOrder,
} from "../dal/list-order"

/**
 * CRM list ordering (#1551). One vocabulary shared by the admin route, the
 * proxy and the node — because the node reads every param it does not
 * recognise as an equality FILTER, so a drift between the three does not merely
 * fail to sort, it returns nothing.
 */
describe("parseListOrder", () => {
  it("reads a descending field", () => {
    expect(parseListOrder("-created_at", CRM_ORDERABLE_FIELDS)).toEqual({
      created_at: "DESC",
    })
  })

  it("reads an ascending field", () => {
    expect(parseListOrder("created_at", CRM_ORDERABLE_FIELDS)).toEqual({
      created_at: "ASC",
    })
  })

  it("🔴 refuses a column that is not on the allowlist", () => {
    // The field reaches a repository query verbatim.
    expect(parseListOrder("password", CRM_ORDERABLE_FIELDS)).toBeNull()
    expect(parseListOrder("-1; drop table", CRM_ORDERABLE_FIELDS)).toBeNull()
  })

  it("orders by nothing rather than erroring on junk", () => {
    // A list that ignores a bad sort beats a 400 on a page load.
    expect(parseListOrder("", CRM_ORDERABLE_FIELDS)).toBeNull()
    expect(parseListOrder(undefined, CRM_ORDERABLE_FIELDS)).toBeNull()
    expect(parseListOrder("-", CRM_ORDERABLE_FIELDS)).toBeNull()
  })

  it("tolerates surrounding whitespace", () => {
    expect(parseListOrder("  -updated_at ", CRM_ORDERABLE_FIELDS)).toEqual({
      updated_at: "DESC",
    })
  })
})

describe("serializeListOrder", () => {
  it("round-trips through the wire format", () => {
    const wire = serializeListOrder({ created_at: "DESC" })
    expect(wire).toBe("-created_at")
    expect(parseListOrder(wire, CRM_ORDERABLE_FIELDS)).toEqual({
      created_at: "DESC",
    })
  })

  it("writes an ascending field bare", () => {
    expect(serializeListOrder({ created_at: "ASC" })).toBe("created_at")
  })

  it("sends nothing rather than a guess for a multi-field order", () => {
    // The wire format carries one field. Picking one of two silently would
    // sort by something the caller did not ask for.
    expect(
      serializeListOrder({ created_at: "DESC", updated_at: "ASC" })
    ).toBeNull()
  })

  it("sends nothing when there is no order", () => {
    expect(serializeListOrder(null)).toBeNull()
    expect(serializeListOrder(undefined)).toBeNull()
  })
})

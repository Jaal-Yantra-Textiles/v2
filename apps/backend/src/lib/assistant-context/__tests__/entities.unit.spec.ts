import {
  inferEntityType,
  extractEntityResolutions,
  buildEntityResolver,
} from "../entities"
import { findResolutionInRows } from "../../../modules/assistant-context-cache/service"

describe("inferEntityType", () => {
  it("classifies by id prefix", () => {
    expect(inferEntityType("cus_01KS9BXSAA59AESGP84EC5FMD5")).toBe("customer")
    expect(inferEntityType("order_01ABC")).toBe("order")
    expect(inferEntityType("design_01ABC")).toBe("design")
  })

  it("prefers the longest prefix so production runs are not products", () => {
    expect(inferEntityType("prod_run_01KV3YRSNWQGF6DYC9RV0YF1PZ")).toBe("production_run")
    expect(inferEntityType("prod_01ABC")).toBe("product")
  })
})

describe("extractEntityResolutions", () => {
  it("records a natural key alongside the id", () => {
    const res = extractEntityResolutions({
      customers: [{ id: "cus_01KS9B", email: "delhi@gmail.com", first_name: "Delhi" }],
    })
    expect(res).toEqual([
      {
        type: "customer",
        key: "email",
        value: "delhi@gmail.com",
        id: "cus_01KS9B",
        label: "Delhi",
      },
    ])
  })

  it("deduplicates by natural key and recurses through nested shapes", () => {
    const res = extractEntityResolutions({
      designs: [
        { id: "design_01A", name: "Scarf" },
        { id: "design_02B", name: "Shawl" },
      ],
    })
    expect(res.map((r) => r.id)).toEqual(["design_01A", "design_02B"])
  })
})

describe("buildEntityResolver", () => {
  it("resolves a natural key to an id and misses cleanly", () => {
    const resolve = buildEntityResolver([
      { type: "customer", key: "email", value: "delhi@gmail.com", id: "cus_01KS9B" },
    ])
    expect(resolve("customer", "email", "delhi@gmail.com")).toBe("cus_01KS9B")
    expect(resolve("customer", "email", "other@x.com")).toBeNull()
  })
})

describe("findResolutionInRows", () => {
  it("scans cache rows for a matching resolution", () => {
    const rows = [
      { entity_resolutions: [{ type: "customer", key: "email", value: "a@b.com", id: "cus_1" }] },
      { entity_resolutions: [{ type: "design", key: "name", value: "Scarf", id: "design_1" }] },
    ]
    expect(findResolutionInRows(rows, "design", "name", "Scarf")).toBe("design_1")
    expect(findResolutionInRows(rows, "customer", "email", "nope@x.com")).toBeNull()
  })
})
import { ADMIN_MCP_TOOLS } from "../registry"
import { toolDomain } from "../tool-slice"

const byName = (n: string) => ADMIN_MCP_TOOLS.find((t) => t.name === n)

/**
 * The output-review queue had no tool at all, and the obvious way to add one
 * would have shipped a bulk write on the live catalogue with its preview
 * unreachable — `dry_run` is the MCP's OWN flag and is intercepted before the
 * route is ever called, so the route's report cannot come back under that name.
 * `run_maintenance_job` has exactly that defect today.
 */
describe("the run-review tool can actually be previewed (#1805 follow-up)", () => {
  it("exists as a sensitive write", () => {
    const t = byName("review_production_run_output")
    expect(t).toBeDefined()
    expect(t!.write).toBe(true)
    expect(t!.sensitive).toBe(true)
  })

  it("forwards `preview`, so the route's report is reachable", () => {
    expect(byName("review_production_run_output")!.bodyParams).toContain("preview")
  })

  it("does NOT forward `dry_run` — that name is the dispatcher's and never arrives", () => {
    expect(byName("review_production_run_output")!.bodyParams).not.toContain("dry_run")
  })

  it("advertises nothing it does not forward", () => {
    const t: any = byName("review_production_run_output")!
    const advertised = Object.keys(t.inputSchema?.properties ?? {})
    for (const k of advertised) expect(t.bodyParams).toContain(k)
  })

  it("tells the caller to preview first and warns that approval reuses a product", () => {
    const d = byName("review_production_run_output")!.description
    expect(d).toMatch(/preview: true/)
    expect(d).toMatch(/reuses/i)
  })
})

describe("a design's products are discoverable (#1900 follow-up)", () => {
  it("exists as a read tool", () => {
    const t = byName("list_design_products")
    expect(t).toBeDefined()
    expect(t!.method).toBe("GET")
    expect(t!.write).toBeUndefined()
  })

  it("shares a slice with the review tool that depends on it", () => {
    // Approval reuses the design's existing product, so the tool that reveals
    // that product must surface in the same ask as the tool that blesses it.
    const a = toolDomain(byName("list_design_products")!)
    expect(a).toBeTruthy()
    expect(byName("review_production_run_output")!.nextSteps).toContain(
      "list_design_products"
    )
  })
})

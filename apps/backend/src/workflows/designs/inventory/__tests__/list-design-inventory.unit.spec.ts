/**
 * Unit tests for `sanitizeBigInt` — the payload sanitiser behind
 * GET /admin/designs/:id/inventory.
 *
 * It recurses into every object to convert bigints, and a Date has no own
 * enumerable properties: the generic branch rebuilt one as `{}`, wiping every
 * timestamp on the wire. Harmless for as long as `consumed_at` was always null
 * (it had no writer at all — #1248), then the apply-consumption job gave it a
 * real value and the admin drawer threw "Objects are not valid as a React
 * child". These pin the passthrough so a refactor cannot reintroduce it.
 */

// Mock the SDK so the module-level createStep/createWorkflow calls don't throw
// at import time.
jest.mock("@medusajs/framework/workflows-sdk", () => ({
  createStep: (_name: string, fn: Function) => fn,
  createWorkflow: (_name: string, fn: Function) => fn,
  StepResponse: class { constructor(public data: any) {} },
  WorkflowResponse: class { constructor(public data: any) {} },
}))

jest.mock("@medusajs/framework/utils", () => ({
  ContainerRegistrationKeys: { QUERY: "query" },
  MedusaError: class extends Error {
    static Types = { NOT_FOUND: "not_found" }
    constructor(_type: string, message: string) {
      super(message)
    }
  },
}))

jest.mock("../../../../links/design-inventory-link", () => ({
  __esModule: true,
  default: { entryPoint: "design_inventory_item" },
}))

import { sanitizeBigInt } from "../list-design-inventory"

describe("sanitizeBigInt", () => {
  it("returns a Date untouched rather than rebuilding it as {}", () => {
    const date = new Date("2026-08-11T11:34:26.597Z")

    expect(sanitizeBigInt(date)).toBe(date)
  })

  it("keeps a nested consumed_at serialisable as an ISO string", () => {
    const row = {
      consumed_quantity: 4,
      consumed_at: new Date("2026-08-11T11:34:26.597Z"),
    }

    const sanitized = sanitizeBigInt(row)

    // The crash was that this round-tripped to `{}` and reached JSX as an object.
    expect(JSON.parse(JSON.stringify(sanitized)).consumed_at).toBe(
      "2026-08-11T11:34:26.597Z"
    )
  })

  it("still converts bigints, including inside arrays and nested objects", () => {
    const sanitized = sanitizeBigInt({
      quantity: BigInt(23),
      levels: [{ stocked: BigInt(19) }],
    })

    expect(sanitized.quantity).toBe(23)
    expect(sanitized.levels[0].stocked).toBe(19)
  })

  it("leaves null and primitives alone", () => {
    expect(sanitizeBigInt(null)).toBeNull()
    expect(sanitizeBigInt(undefined)).toBeUndefined()
    expect(sanitizeBigInt("2026-08-11")).toBe("2026-08-11")
  })
})

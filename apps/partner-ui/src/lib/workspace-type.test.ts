import { describe, it, expect } from "vitest"
import {
  legacyUseType,
  resolveWorkspaceType,
  workspaceTypeDisagreesWithLegacy,
} from "./workspace-type"

/**
 * #2061 / #2029 — retiring `metadata.use_type`.
 *
 * The cases that matter are the 3 real partners whose blob and column disagree
 * (GOF, Perennial, Unique Pashmina on prod, 2026-09-15). If the blob is ever
 * allowed back into the resolution, they silently change persona.
 */
describe("resolveWorkspaceType", () => {
  it("returns the typed column", () => {
    expect(resolveWorkspaceType({ workspace_type: "designer" })).toBe("designer")
  })

  it("🔴 ignores a legacy use_type that disagrees (the GOF / Perennial case)", () => {
    expect(
      resolveWorkspaceType({
        workspace_type: "manufacturer",
        metadata: { use_type: "seller" },
      })
    ).toBe("manufacturer")
  })

  it("does not fall back to the blob when the column is somehow absent", () => {
    expect(
      resolveWorkspaceType({ metadata: { use_type: "seller" } })
    ).toBeUndefined()
  })

  it("survives a partner with no metadata at all", () => {
    expect(resolveWorkspaceType({ workspace_type: "seller" })).toBe("seller")
    expect(resolveWorkspaceType(null)).toBeUndefined()
    expect(resolveWorkspaceType(undefined)).toBeUndefined()
  })

  it("passes an unrecognised persona through rather than blanking it", () => {
    // A 5th persona added backend-first must not silently become "no persona".
    expect(resolveWorkspaceType({ workspace_type: "weaver" } as never)).toBe(
      "weaver"
    )
  })
})

describe("legacyUseType", () => {
  it("reads the blob for display", () => {
    expect(legacyUseType({ metadata: { use_type: "seller" } })).toBe("seller")
  })

  it("is undefined for the 26 partners who never had one", () => {
    expect(legacyUseType({ workspace_type: "manufacturer" })).toBeUndefined()
    expect(legacyUseType({ metadata: {} })).toBeUndefined()
    expect(legacyUseType({ metadata: { use_type: "" } })).toBeUndefined()
    expect(legacyUseType({ metadata: { use_type: 7 } } as never)).toBeUndefined()
  })
})

describe("workspaceTypeDisagreesWithLegacy", () => {
  it("is true for a stated seller carrying the manufacturer default", () => {
    expect(
      workspaceTypeDisagreesWithLegacy({
        workspace_type: "manufacturer",
        metadata: { use_type: "seller" },
      })
    ).toBe(true)
  })

  it("is false when both say the same thing (Raja Shawls, Saransh Sharma)", () => {
    expect(
      workspaceTypeDisagreesWithLegacy({
        workspace_type: "manufacturer",
        metadata: { use_type: "manufacturer" },
      })
    ).toBe(false)
  })

  it("is false when there is no blob to disagree with", () => {
    expect(
      workspaceTypeDisagreesWithLegacy({ workspace_type: "manufacturer" })
    ).toBe(false)
  })
})

import { applyWeaverCorrections } from "../apply-weaver-corrections"

describe("applyWeaverCorrections", () => {
  const weaver = {
    census_id: 42,
    name: "Mohd Shahid",
    district: "SITAPUR",
    own_looms: true,
  }

  it("overlays a correction onto an existing field", () => {
    const { weaver: out, corrected_fields } = applyWeaverCorrections(weaver, [
      { field: "own_looms", corrected_value: false },
    ])
    expect(out.own_looms).toBe(false)
    expect(out.district).toBe("SITAPUR") // untouched
    expect(corrected_fields).toEqual(["own_looms"])
  })

  it("adds a correction for a field not on the record", () => {
    const { weaver: out, corrected_fields } = applyWeaverCorrections(weaver, [
      { field: "yarn_source", corrected_value: "Bhilwara" },
    ])
    expect(out.yarn_source).toBe("Bhilwara")
    expect(corrected_fields).toEqual(["yarn_source"])
  })

  it("skips corrections with no field or no value", () => {
    const { weaver: out, corrected_fields } = applyWeaverCorrections(weaver, [
      { field: "", corrected_value: "x" },
      { field: "own_looms" },
    ])
    expect(out.own_looms).toBe(true)
    expect(corrected_fields).toEqual([])
  })

  it("handles null/undefined corrections and a null weaver", () => {
    expect(applyWeaverCorrections(weaver, null).corrected_fields).toEqual([])
    expect(applyWeaverCorrections(weaver, undefined).corrected_fields).toEqual([])
    expect(applyWeaverCorrections(null as any, []).weaver).toEqual({})
  })

  it("does not mutate the input record", () => {
    const before = { ...weaver }
    applyWeaverCorrections(weaver, [{ field: "district", corrected_value: "AMBALA" }])
    expect(weaver.district).toBe(before.district)
  })
})
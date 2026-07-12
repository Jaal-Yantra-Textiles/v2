import {
  resolveDryRunOption,
  normalizeParamsOption,
  runMaintenanceJobOperation,
} from "../run-maintenance-job"

describe("run_maintenance_job — option coercion", () => {
  it("defaults dry_run to FALSE (apply) when unset/blank", () => {
    expect(resolveDryRunOption(undefined)).toBe(false)
    expect(resolveDryRunOption(null)).toBe(false)
    expect(resolveDryRunOption("")).toBe(false)
  })

  it("coerces truthy/falsey dry_run strings", () => {
    for (const v of ["true", "1", "yes", "on", "TRUE"]) {
      expect(resolveDryRunOption(v)).toBe(true)
    }
    for (const v of ["false", "0", "no", "off", "nonsense"]) {
      expect(resolveDryRunOption(v)).toBe(false)
    }
    expect(resolveDryRunOption(true)).toBe(true)
    expect(resolveDryRunOption(false)).toBe(false)
  })

  it("normalizes params from object or JSON string, else {}", () => {
    expect(normalizeParamsOption({ max_targets: 50 })).toEqual({ max_targets: 50 })
    expect(normalizeParamsOption('{"cooling_idle_days":45}')).toEqual({
      cooling_idle_days: 45,
    })
    expect(normalizeParamsOption("not json")).toEqual({})
    expect(normalizeParamsOption([1, 2])).toEqual({})
    expect(normalizeParamsOption(undefined)).toEqual({})
  })
})

describe("run_maintenance_job — execute", () => {
  const ctx = (dataChain: any = {}): any => ({
    container: {},
    dataChain: { $env: {}, $last: null, ...dataChain },
    flowId: "f",
    executionId: "e",
    operationId: "o",
    operationKey: "k",
  })

  // NOTE: exercising a real/unknown job id requires importing the maintenance
  // registry, which pulls in the full backend graph — that's integration
  // territory (the registry lazy-import resolves at runtime, not in this unit
  // env). Here we only cover the pre-import guard, which never throws.
  it("returns success:false when job_id is missing (before registry import)", async () => {
    const res = await runMaintenanceJobOperation.execute({ job_id: "  " }, ctx())
    expect(res.success).toBe(false)
    expect(res.error).toContain("job_id")
  })
})

import { describe, it, expect } from "vitest"
import {
  humanizeStatus,
  normalizeMediaUrls,
  pickFirstMediaUrl,
  isStoryEmpty,
  nonZeroConsumptionMetrics,
  formatNumber,
  formatStoryDate,
} from "../lib"
import type { ProductionStory } from "@lib/data/designs"

const emptyStory: ProductionStory = {
  design_id: "des_1",
  runs: [],
  consumption: {
    energy: { electricity_kwh: 0, water_liters: 0, gas_cubic_meters: 0 },
    labor_hours: 0,
    materials_consumed: [],
    total_logs: 0,
  },
  people: [],
  partners: [],
  materials: [],
}

describe("humanizeStatus", () => {
  it("title-cases snake/kebab case", () => {
    expect(humanizeStatus("in_progress")).toBe("In Progress")
    expect(humanizeStatus("quality-check")).toBe("Quality Check")
  })
  it("handles empty/null", () => {
    expect(humanizeStatus("")).toBe("")
    expect(humanizeStatus(null)).toBe("")
    expect(humanizeStatus(undefined)).toBe("")
  })
})

describe("normalizeMediaUrls", () => {
  it("unwraps canonical { files: string[] }", () => {
    expect(normalizeMediaUrls({ files: ["a.jpg", "b.jpg"] })).toEqual([
      "a.jpg",
      "b.jpg",
    ])
  })
  it("accepts a bare string[]", () => {
    expect(normalizeMediaUrls(["a.jpg"])).toEqual(["a.jpg"])
  })
  it("unwraps { files: [{ url }|{ file_path }] }", () => {
    expect(
      normalizeMediaUrls({ files: [{ url: "u.jpg" }, { file_path: "p.jpg" }] })
    ).toEqual(["u.jpg", "p.jpg"])
  })
  it("de-dupes and drops blanks", () => {
    expect(normalizeMediaUrls({ files: ["a.jpg", "a.jpg", "  "] })).toEqual([
      "a.jpg",
    ])
  })
  it("returns [] for null/malformed", () => {
    expect(normalizeMediaUrls(null)).toEqual([])
    expect(normalizeMediaUrls(undefined)).toEqual([])
    expect(normalizeMediaUrls(42)).toEqual([])
    expect(normalizeMediaUrls({ nope: 1 })).toEqual([])
  })
})

describe("pickFirstMediaUrl", () => {
  it("returns first url or null", () => {
    expect(pickFirstMediaUrl({ files: ["a.jpg"] })).toBe("a.jpg")
    expect(pickFirstMediaUrl(null)).toBeNull()
  })
})

describe("isStoryEmpty", () => {
  it("true for null and the empty story", () => {
    expect(isStoryEmpty(null)).toBe(true)
    expect(isStoryEmpty(emptyStory)).toBe(true)
  })
  it("false when there are runs", () => {
    expect(
      isStoryEmpty({
        ...emptyStory,
        runs: [
          {
            id: "r1",
            status: "completed",
            run_type: "production",
            quantity: 1,
            produced_quantity: 1,
            rejected_quantity: 0,
            started_at: null,
            finished_at: null,
            completed_at: null,
            created_at: null,
            activity: [],
          },
        ],
      })
    ).toBe(false)
  })
  it("false when consumption is non-zero", () => {
    expect(
      isStoryEmpty({
        ...emptyStory,
        consumption: { ...emptyStory.consumption, labor_hours: 2 },
      })
    ).toBe(false)
  })
  it("false when only partners present", () => {
    expect(
      isStoryEmpty({ ...emptyStory, partners: [{ id: "p1", name: "Atelier" }] })
    ).toBe(false)
  })
})

describe("nonZeroConsumptionMetrics", () => {
  it("includes only non-zero metrics", () => {
    const metrics = nonZeroConsumptionMetrics({
      ...emptyStory,
      consumption: {
        energy: { electricity_kwh: 1.5, water_liters: 0, gas_cubic_meters: 3 },
        labor_hours: 1,
        materials_consumed: [],
        total_logs: 2,
      },
    })
    expect(metrics).toEqual([
      { label: "Electricity", value: "1.5 kWh" },
      { label: "Gas", value: "3 m³" },
      { label: "Labor", value: "1 hour" },
    ])
  })
  it("returns [] for the empty story", () => {
    expect(nonZeroConsumptionMetrics(emptyStory)).toEqual([])
  })
})

describe("formatNumber", () => {
  it("trims trailing-zero decimals", () => {
    expect(formatNumber(12)).toBe("12")
    expect(formatNumber(12.5)).toBe("12.5")
    expect(formatNumber(12.0)).toBe("12")
  })
})

describe("formatStoryDate", () => {
  it("formats a valid ISO date", () => {
    expect(formatStoryDate("2026-03-05T00:00:00.000Z")).toMatch(/2026/)
  })
  it("returns null for null/garbage", () => {
    expect(formatStoryDate(null)).toBeNull()
    expect(formatStoryDate("not-a-date")).toBeNull()
  })
})

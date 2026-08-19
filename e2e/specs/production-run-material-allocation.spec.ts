import { test, expect } from "@playwright/test"
import * as fs from "fs"
import * as path from "path"

const SEED_FILE = path.resolve(__dirname, "../../apps/backend/.e2e-seed.json")

/**
 * #1363 — a partner is sent ONE material, not the whole design.
 *
 * Before this, `fetchDesignInventorySnapshotStep` filtered on `design_id`
 * alone: every run carried its design's entire bill of materials, and the
 * partner's consumption picker offered every item the design had ever been
 * linked to. A design with three inventory items handed to two partners asked
 * both of them about all three.
 *
 * This drives the real admin approval — open the drawer, add two assignments,
 * give each partner a DIFFERENT material — and then checks the two things a
 * green screen does not prove:
 *
 *   1. the allocation was persisted, per child run, and the two children differ;
 *   2. the gate actually refuses. A selection nothing enforces is decoration,
 *      and the enforcement lives in `logConsumptionWorkflow`, not on a route,
 *      because three routes reach it (#1314: a guard on one path is not a
 *      guard). The refusal is asserted through a DIFFERENT route than the
 *      partner one, which is the whole point of putting it in the workflow.
 *
 * And the control that must NOT fire: the parent run, which nobody allocated,
 * stays unconstrained. Every run that predates this feature is in that state,
 * so reading "nobody chose" as "chose nothing" would 400 the existing floor —
 * and would look exactly like the feature working.
 *
 * SINGLE-USE fixture, like every other run fixture here: the spec approves the
 * run, and an approved run cannot be approved again. Re-seed between runs.
 */
test.describe("Production run per-assignment material allocation (#1363)", () => {
  let seed: {
    email: string
    password: string
    allocationRunId: string
    allocationDesignId: string
    allocationPartnerAName: string
    allocationPartnerBName: string
    allocationMaterialALabel: string
    allocationMaterialBLabel: string
    allocationMaterialCLabel: string
    allocationMaterialAId: string
    allocationMaterialCId: string
  }

  test.beforeAll(() => {
    if (!fs.existsSync(SEED_FILE)) {
      throw new Error(
        `E2E seed file not found at ${SEED_FILE}. Run "pnpm e2e:seed" first.`
      )
    }
    seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf-8"))
    if (!seed.allocationRunId) {
      throw new Error("E2E seed missing allocationRunId — re-run the seed.")
    }
  })

  const login = async (page: any) => {
    await page.goto("/app/login")
    // `networkidle` never settles against `medusa develop` (long-lived
    // connections), so wait on the form itself.
    await page.locator('input[name="email"]').waitFor({ timeout: 60000 })
    await page.locator('input[name="email"]').fill(seed.email)
    await page.locator('input[name="password"]').fill(seed.password)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(/\/app\/(?!login)/, { timeout: 15000 })
  }

  /** Fill one assignment card: partner, then the material chip (+ quantity). */
  const fillAssignment = async (
    page: any,
    index: number,
    partnerName: string,
    materialLabel: string,
    quantity: string
  ) => {
    const card = page.locator("text=Assignment " + (index + 1)).locator("..").locator("..")

    // Partner select — Radix, so open then pick by name.
    await card.getByText("Select partner").click()
    await page.getByRole("option", { name: partnerName }).click()

    // The material chip. Selecting it is what puts the item in THIS assignment;
    // an unselected chip must never reach the payload (#1361's shape).
    await card.getByRole("button", { name: materialLabel }).click()

    const qtyInput = card.locator('input[type="number"]').last()
    await qtyInput.fill(quantity)
  }

  test("sends each partner only the material they were assigned, and refuses the rest", async ({
    page,
  }) => {
    await login(page)
    await page.goto(`/app/production-runs/${seed.allocationRunId}`)

    const approve = page.getByRole("button", { name: /^Approve$/ })
    await expect(approve.first()).toBeVisible({ timeout: 20000 })
    await approve.first().click()

    await expect(
      page.getByRole("heading", { name: "Approve Production Run" })
    ).toBeVisible({ timeout: 15000 })

    // Open the assignments modal.
    await page.getByRole("button", { name: /Assignments/i }).last().click()
    await expect(
      page.getByRole("heading", { name: "Assignments" })
    ).toBeVisible({ timeout: 10000 })

    // The picker offers the design's BOM — all three items — as the set an
    // assignment may be a subset OF.
    await page.getByRole("button", { name: "+ Add Assignment" }).click()
    for (const label of [
      seed.allocationMaterialALabel,
      seed.allocationMaterialBLabel,
      seed.allocationMaterialCLabel,
    ]) {
      await expect(page.getByRole("button", { name: label }).first()).toBeVisible()
    }

    await fillAssignment(
      page,
      0,
      seed.allocationPartnerAName,
      seed.allocationMaterialALabel,
      "24"
    )

    await page.getByRole("button", { name: "+ Add Assignment" }).click()
    await fillAssignment(
      page,
      1,
      seed.allocationPartnerBName,
      seed.allocationMaterialCLabel,
      "8"
    )

    await page.getByRole("button", { name: "Save Assignments" }).click()
    // The drawer now shows the count, which is the only on-screen proof the
    // picker produced a payload at all rather than silently dropping it.
    await expect(
      page.getByRole("button", { name: /Manage Assignments \(2\)/ })
    ).toBeVisible({ timeout: 10000 })

    await page.getByRole("button", { name: /^Approve$/ }).last().click()

    // Wait for the mutation to SETTLE, not just to be sent. The drawer closes
    // on success; querying straight after the click read zero children off a
    // request still in flight — a green click is not a completed write.
    await expect(
      page.getByRole("heading", { name: "Approve Production Run" })
    ).toBeHidden({ timeout: 30000 })

    // ── What a green screen does not prove ────────────────────────────────
    const children = await page.request
      .get(
        `/admin/production-runs?parent_run_id=${seed.allocationRunId}&limit=10`
      )
      .then((r) => r.json())

    expect(children.production_runs).toHaveLength(2)

    const allocations: Record<string, string[]> = {}
    for (const child of children.production_runs) {
      const detail = await page.request
        .get(`/admin/production-runs/${child.id}`)
        .then((r) => r.json())
      expect(detail.materials_constrained).toBe(true)
      allocations[child.id] = (detail.materials || []).map(
        (m: any) => m.inventory_item_id
      )
    }

    const sets = Object.values(allocations)
    // Each child got exactly ONE material…
    expect(sets.every((s) => s.length === 1)).toBe(true)
    // …and they are DIFFERENT ones. Two partners, two materials, one design —
    // the thing the old whole-BOM snapshot could not express.
    expect(new Set(sets.flat()).size).toBe(2)

    const childWithA = Object.entries(allocations).find(([, ids]) =>
      ids.includes(seed.allocationMaterialAId)
    )
    expect(childWithA).toBeTruthy()
    const runWithSilk = childWithA![0]

    // ── The gate ─────────────────────────────────────────────────────────
    // Asserted through the ADMIN design route, not the partner run route the
    // UI uses. The check lives in the workflow precisely so every path that
    // reaches it is covered, and a spec that only exercised the path the guard
    // was written on would prove nothing about the other two.
    const offPlan = await page.request.post(
      `/admin/designs/${seed.allocationDesignId}/consumption-logs`,
      {
        data: {
          productionRunId: runWithSilk,
          inventoryItemId: seed.allocationMaterialCId,
          quantity: 1,
          unitOfMeasure: "Meter",
          consumptionType: "production",
        },
      }
    )
    expect(offPlan.ok()).toBe(false)
    expect(await offPlan.text()).toContain("not assigned to this run")

    // …and the assigned one still goes through, so the refusal above is the
    // allocation talking and not a broken route.
    const onPlan = await page.request.post(
      `/admin/designs/${seed.allocationDesignId}/consumption-logs`,
      {
        data: {
          productionRunId: runWithSilk,
          inventoryItemId: seed.allocationMaterialAId,
          quantity: 1,
          unitOfMeasure: "Meter",
          consumptionType: "production",
        },
      }
    )
    expect(onPlan.status()).toBe(201)
  })

  /**
   * THE CONTROL THAT MUST NOT FIRE.
   *
   * The parent was never allocated anything, and neither was any run created
   * before #1363. Those must stay unconstrained — the whole BOM available — or
   * the feature 400s work that was fine yesterday.
   */
  test("leaves a run nobody allocated unconstrained", async ({ page }) => {
    await login(page)

    const detail = await page.request
      .get(`/admin/production-runs/${seed.allocationRunId}`)
      .then((r) => r.json())

    expect(detail.materials_constrained).toBe(false)
    expect(detail.materials).toEqual([])

    // Any item of the design is still loggable against it.
    const anyItem = await page.request.post(
      `/admin/designs/${seed.allocationDesignId}/consumption-logs`,
      {
        data: {
          productionRunId: seed.allocationRunId,
          inventoryItemId: seed.allocationMaterialCId,
          quantity: 1,
          unitOfMeasure: "Meter",
          consumptionType: "production",
        },
      }
    )
    expect(anyItem.status()).toBe(201)
  })
})

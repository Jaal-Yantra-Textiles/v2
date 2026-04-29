/**
 * Unit tests for the partner-side WhatsApp helpers added in Phase 1B.
 *
 * The helpers are pure shape-mappers over query.graph. We mock the
 * container's QUERY service so we can assert on the produced data
 * without booting Medusa.
 */

jest.mock("@medusajs/framework/utils", () => ({
  ContainerRegistrationKeys: { QUERY: "query" },
  MedusaService: () =>
    class {
      constructor(..._args: any[]) {}
    },
  model: new Proxy(
    {},
    {
      get: () => () => new Proxy(() => {}, { get: () => () => undefined }),
    },
  ),
}))

// downloadAndSaveWhatsAppMedia and friends pull in workflows that
// import the workflow SDK at module init. Stub it to a no-op so the
// helper file's imports don't crash.
jest.mock("@medusajs/framework/workflows-sdk", () => ({
  createStep: (_n: string, fn: Function) => fn,
  createWorkflow: (_n: string, fn: Function) => fn,
  StepResponse: class {
    constructor(public data: any) {}
  },
  WorkflowResponse: class {
    constructor(public data: any) {}
  },
}))

jest.mock("../../modules/media", () => ({ MEDIA_MODULE: "media" }))
jest.mock("../../modules/production_runs", () => ({
  PRODUCTION_RUNS_MODULE: "production_runs",
}))
jest.mock("../../modules/social-provider", () => ({
  SOCIAL_PROVIDER_MODULE: "social_provider",
}))
jest.mock("../../workflows/media/upload-and-organize-media", () => ({
  uploadAndOrganizeMediaWorkflow: () => ({ run: jest.fn() }),
}))
jest.mock("../../workflows/designs/list-single-design", () => ({
  listSingleDesignsWorkflow: () => ({ run: jest.fn() }),
}))
jest.mock("../../workflows/designs/update-design", () => ({
  updateDesignWorkflow: () => ({ run: jest.fn() }),
}))

import {
  listPartnerSharedFolders,
  resolvePartnerDefaultSharedFolder,
  getPartnerOpenWork,
} from "../../workflows/whatsapp/whatsapp-media-helper"

function makeScope(graph: jest.Mock) {
  return {
    resolve: (_key: string) => ({ graph }),
  }
}

describe("listPartnerSharedFolders", () => {
  it("returns empty when partner has no people", async () => {
    const graph = jest.fn().mockResolvedValueOnce({ data: [{ people: [] }] })
    const out = await listPartnerSharedFolders(makeScope(graph), "p1")
    expect(out).toEqual([])
  })

  it("dedups folders shared via multiple people and orders by latest activity", async () => {
    // Person A and Person B both have access to folder F1; only A has F2.
    // F1 has the more recent file → F1 should come first.
    const graph = jest
      .fn()
      .mockResolvedValueOnce({
        data: [{ people: [{ id: "person_a" }, { id: "person_b" }] }],
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: "person_a",
            folders: [
              {
                id: "f1",
                name: "Spring",
                slug: "spring",
                media_files: [
                  { id: "m1", created_at: "2026-04-28T10:00:00Z" },
                  { id: "m2", created_at: "2026-04-29T12:00:00Z" },
                ],
              },
              {
                id: "f2",
                name: "Archive",
                slug: "archive",
                media_files: [],
              },
            ],
          },
          {
            id: "person_b",
            folders: [
              {
                id: "f1",
                name: "Spring",
                slug: "spring",
                media_files: [{ id: "m1", created_at: "2026-04-28T10:00:00Z" }],
              },
            ],
          },
        ],
      })

    const out = await listPartnerSharedFolders(makeScope(graph), "p1")
    expect(out.map((f) => f.id)).toEqual(["f1", "f2"])
    expect(out[0].fileCount).toBe(2)
    expect(out[1].fileCount).toBe(0)
    expect(out[0].latestFileAt).toBeGreaterThan(out[1].latestFileAt)
  })
})

describe("resolvePartnerDefaultSharedFolder", () => {
  it("returns null when no folders are shared", async () => {
    const graph = jest.fn().mockResolvedValueOnce({ data: [{ people: [] }] })
    const out = await resolvePartnerDefaultSharedFolder(makeScope(graph), "p1")
    expect(out).toBeNull()
  })

  it("picks the folder with the most recent file", async () => {
    const graph = jest
      .fn()
      .mockResolvedValueOnce({
        data: [{ people: [{ id: "person_a" }] }],
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: "person_a",
            folders: [
              {
                id: "old",
                name: "Old",
                slug: "old",
                media_files: [{ created_at: "2026-01-01T00:00:00Z" }],
              },
              {
                id: "new",
                name: "New",
                slug: "new",
                media_files: [{ created_at: "2026-04-29T00:00:00Z" }],
              },
            ],
          },
        ],
      })

    const out = await resolvePartnerDefaultSharedFolder(makeScope(graph), "p1")
    expect(out).toEqual({ id: "new", name: "New", slug: "new" })
  })
})

describe("getPartnerOpenWork", () => {
  it("returns empty arrays when nothing pending", async () => {
    const graph = jest
      .fn()
      .mockResolvedValueOnce({ data: [] }) // runs
      .mockResolvedValueOnce({ data: [] }) // payments
    const out = await getPartnerOpenWork(makeScope(graph), "p1")
    expect(out).toEqual({ pendingRuns: [], pendingPayments: [] })
  })

  it("normalizes runs (accepted flag from accepted_at presence)", async () => {
    const graph = jest
      .fn()
      .mockResolvedValueOnce({
        data: [
          { id: "r1", status: "sent_to_partner", accepted_at: null, design: { name: "Spring" } },
          { id: "r2", status: "in_progress", accepted_at: "2026-04-29T00:00:00Z", design: { name: "Tibetan" } },
        ],
      })
      .mockResolvedValueOnce({ data: [] })

    const out = await getPartnerOpenWork(makeScope(graph), "p1")
    expect(out.pendingRuns).toEqual([
      { id: "r1", status: "sent_to_partner", accepted: false, designName: "Spring" },
      { id: "r2", status: "in_progress", accepted: true, designName: "Tibetan" },
    ])
  })

  it("returns an empty result on query failure rather than throwing", async () => {
    const graph = jest.fn().mockRejectedValue(new Error("db down"))
    const out = await getPartnerOpenWork(makeScope(graph), "p1")
    expect(out).toEqual({ pendingRuns: [], pendingPayments: [] })
  })
})

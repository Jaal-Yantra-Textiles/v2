/**
 * #2017 — one moodboard per OWNER, not one blob per design.
 *
 * `design.moodboard` was a single `jsonb` column. An admin and a partner
 * editing "their" boards edited the same value, and the partner save replaced
 * it wholesale — last write won, silently, with a 200, and the other party's
 * work was gone the next time they opened it.
 *
 * The issue names the assertion this suite exists for: **two authors save
 * different scenes against the same design, and BOTH survive.** A unit test
 * with a stubbed service cannot prove that, because the defect was in what the
 * database ended up holding.
 */
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { DESIGN_MODULE } from "../../src/modules/designs"

jest.setTimeout(60 * 1000)

const sceneWith = (name: string) => ({
  type: "excalidraw",
  version: 2,
  elements: [{ type: "frame", id: `f-${name}`, name }],
})

setupSharedTestSuite(() => {
  let adminHeaders: any
  let designId: string

  const { api, getContainer } = getSharedTestEnv()
  const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`

  /** Mint an invited designer partner and return their bearer headers. */
  const inviteDesigner = async (name: string) => {
    const mint = await api.post(
      `/admin/designs/${designId}/designer-invites`,
      { inviter_name: "Studio JYT" },
      adminHeaders
    )
    const accept = await api.post(
      `/partners/designer-invites/${mint.data.token}/accept`,
      {
        name,
        email: `${name.toLowerCase().replace(/\W+/g, "")}-${uniq()}@example.com`,
        password: "supersecret123",
      }
    )
    return { headers: { authorization: `Bearer ${accept.data.token}` } }
  }

  beforeAll(async () => {
    await createAdminUser(getContainer())
    adminHeaders = await getAuthHeaders(api)
  })

  beforeEach(async () => {
    const designService: any = getContainer().resolve(DESIGN_MODULE)
    const created = await designService.createDesigns({
      name: `Per-owner Moodboard ${uniq()}`,
      description: "one board per owner",
      design_type: "Original",
      status: "Conceptual",
      priority: "Medium",
    })
    designId = created.id
  })

  /**
   * 🔴 THE assertion. Before #2017 the second save overwrote the first and
   * this read back one scene twice.
   */
  it("keeps an admin board and a partner board apart — both survive", async () => {
    const designer = await inviteDesigner("Ada")

    const adminSave = await api.post(
      `/admin/designs/${designId}/moodboards`,
      { moodboard: sceneWith("ADMIN BOARD") },
      adminHeaders
    )
    expect(adminSave.status).toBe(200)

    const partnerSave = await api.put(
      `/partners/designs/${designId}/moodboard`,
      { moodboard: sceneWith("PARTNER BOARD") },
      designer
    )
    expect(partnerSave.status).toBe(200)

    // The admin still sees theirs, unchanged by the partner's save.
    const adminView = await api.get(
      `/admin/designs/${designId}/moodboards`,
      adminHeaders
    )
    expect(adminView.data.own.owner_type).toBe("core")
    expect(adminView.data.own.scene.elements[0].name).toBe("ADMIN BOARD")

    // …and the partner's board is there too, read-only, from the admin side.
    expect(adminView.data.others).toHaveLength(1)
    expect(adminView.data.others[0].owner_type).toBe("partner")
    expect(adminView.data.others[0].scene.elements[0].name).toBe("PARTNER BOARD")
    expect(adminView.data.others[0].is_own).toBe(false)

    // The partner sees the mirror image.
    const partnerView = await api.get(
      `/partners/designs/${designId}/moodboards`,
      designer
    )
    expect(partnerView.data.own.scene.elements[0].name).toBe("PARTNER BOARD")
    expect(partnerView.data.own.is_own).toBe(true)
    expect(partnerView.data.others).toHaveLength(1)
    expect(partnerView.data.others[0].scene.elements[0].name).toBe("ADMIN BOARD")
    expect(partnerView.data.others[0].is_own).toBe(false)
  })

  it("gives two different partners two different boards", async () => {
    const ada = await inviteDesigner("Ada")
    const bo = await inviteDesigner("Bo")

    await api.put(
      `/partners/designs/${designId}/moodboard`,
      { moodboard: sceneWith("ADA") },
      ada
    )
    await api.put(
      `/partners/designs/${designId}/moodboard`,
      { moodboard: sceneWith("BO") },
      bo
    )

    const adaView = await api.get(`/partners/designs/${designId}/moodboards`, ada)
    expect(adaView.data.own.scene.elements[0].name).toBe("ADA")
    expect(
      adaView.data.others.map((o: any) => o.scene.elements[0].name)
    ).toEqual(["BO"])

    const boView = await api.get(`/partners/designs/${designId}/moodboards`, bo)
    expect(boView.data.own.scene.elements[0].name).toBe("BO")
  })

  it("re-saving the same owner's board updates it rather than minting a second", async () => {
    const ada = await inviteDesigner("Ada")

    await api.put(
      `/partners/designs/${designId}/moodboard`,
      { moodboard: sceneWith("FIRST") },
      ada
    )
    await api.put(
      `/partners/designs/${designId}/moodboard`,
      { moodboard: sceneWith("SECOND") },
      ada
    )

    const view = await api.get(`/partners/designs/${designId}/moodboards`, ada)
    expect(view.data.own.scene.elements[0].name).toBe("SECOND")
    // One board, not two — the partial unique index is doing its job.
    expect(view.data.others).toHaveLength(0)
  })

  /**
   * 🔴 The reason `design.moodboard` is not dropped. A design written before
   * this entity has its scene in the column and NO rows — an empty row read
   * and "no boards" are the same value and opposite facts, and believing the
   * empty read would show a populated board as blank.
   */
  it("falls back to the legacy blob when the design has no board rows", async () => {
    const designService: any = getContainer().resolve(DESIGN_MODULE)
    await designService.updateDesigns({
      selector: { id: designId },
      data: { moodboard: sceneWith("LEGACY BLOB") },
    })

    const adminView = await api.get(
      `/admin/designs/${designId}/moodboards`,
      adminHeaders
    )
    expect(adminView.data.usedLegacyFallback).toBe(true)
    expect(adminView.data.own.is_legacy).toBe(true)
    expect(adminView.data.own.scene.elements[0].name).toBe("LEGACY BLOB")

    // A partner sees it as SOMEONE ELSE'S, read-only: the blob was the shared
    // column an admin may have authored, so handing them edit rights over it
    // would be the clobber arriving by another door.
    const ada = await inviteDesigner("Ada")
    const partnerView = await api.get(
      `/partners/designs/${designId}/moodboards`,
      ada
    )
    expect(partnerView.data.own).toBeNull()
    expect(partnerView.data.others[0].is_own).toBe(false)
    expect(partnerView.data.others[0].scene.elements[0].name).toBe("LEGACY BLOB")
  })

  it("stops falling back once a real board exists", async () => {
    const designService: any = getContainer().resolve(DESIGN_MODULE)
    await designService.updateDesigns({
      selector: { id: designId },
      data: { moodboard: sceneWith("LEGACY BLOB") },
    })

    await api.post(
      `/admin/designs/${designId}/moodboards`,
      { moodboard: sceneWith("REAL CORE") },
      adminHeaders
    )

    const view = await api.get(
      `/admin/designs/${designId}/moodboards`,
      adminHeaders
    )
    expect(view.data.usedLegacyFallback).toBe(false)
    expect(view.data.own.scene.elements[0].name).toBe("REAL CORE")
    // Not both — a half-migrated design showing the blob AND the row would
    // double every frame on the canvas.
    expect(view.data.others).toHaveLength(0)
  })
})

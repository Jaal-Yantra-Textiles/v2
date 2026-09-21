/**
 * A task assigned to a partner must be visible IN THAT PARTNER'S PORTAL.
 *
 * 🔑 Why this has to be an integration test. Three different readers traverse
 * `partner → tasks` and they do NOT agree:
 *
 *   partner graph spine            reads the link rows directly      finds it
 *   GET /admin/partners/:id/tasks  `query.index({entity:'partner'})` finds it
 *   GET /partners/assigned-tasks   `query.graph({entity:'partner'})`     ???
 *
 * A unit test cannot tell them apart: `defineLink` registers as an import side
 * effect, `entryPoint` is empty outside a real run, and a `query.graph` hop
 * that names a relation the link never declared returns an EMPTY ARRAY rather
 * than throwing. The portal route then does
 * `if (allTaskIds.length === 0) return { tasks: [], count: 0 }` — a confident
 * nothing. The partner's screen says "no tasks" with total assurance.
 *
 * ⚠️ Note what `links/partner-task.ts` does NOT declare: a `field`. Its sibling
 * `links/production-runs-tasks.ts` says `field: "tasks"` explicitly. Whether
 * that omission is the cause is exactly what this test settles.
 *
 * Measured on prod 2026-09-21: Mehak Chauhan (`01M2J1DN9X78EY0XADKYEMGXP8`)
 * had a "Photoshoot" task, ₹5,000, pending. The admin tool and the partner
 * graph both reported it. Her portal showed nothing.
 *
 * 🔴 THE CONTROL IS THE POINT. Asserting only that the portal returns a task
 * would fail for a dozen uninteresting reasons — the task was never created,
 * the link was never written, auth resolved to another partner. So the admin
 * route is asserted FIRST, on the same task, in the same run. Once it answers
 * "1", an empty portal response can only mean the portal's own read is wrong.
 *
 * Run:
 *   pnpm test:integration:http:shared ./integration-tests/http/partner-assigned-tasks-link
 */

import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

const PARTNER_PASSWORD = "supersecret"
jest.setTimeout(180_000)

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("a partner's assigned tasks reach their portal", () => {
    let adminHeaders: Record<string, any>

    beforeEach(async () => {
      await createAdminUser(getContainer())
      adminHeaders = await getAuthHeaders(api)
    })

    it("shows a task assigned by an admin in the partner's own task list", async () => {
      const unique = Date.now() + Math.random().toString(36).slice(2, 6)
      const email = `tasks-${unique}@jyt.test`

      await api.post("/auth/partner/emailpass/register", {
        email,
        password: PARTNER_PASSWORD,
      })
      let login = await api.post("/auth/partner/emailpass", {
        email,
        password: PARTNER_PASSWORD,
      })
      let partnerHeaders: Record<string, string> = {
        Authorization: `Bearer ${login.data.token}`,
      }

      const partnerRes = await api.post(
        "/partners",
        {
          name: `Task Partner ${unique}`,
          handle: `taskpartner-${unique}`,
          admin: { email, first_name: "Task", last_name: "Partner" },
        },
        { headers: partnerHeaders }
      )
      const partnerId = partnerRes.data.partner.id as string

      // Re-login so the token carries the partner actor.
      login = await api.post("/auth/partner/emailpass", {
        email,
        password: PARTNER_PASSWORD,
      })
      partnerHeaders = { Authorization: `Bearer ${login.data.token}` }

      /*
       * The real assignment route — the one an admin uses, and the one that
       * created Mehak's Photoshoot task. Not a hand-written link row: the point
       * is to prove the relation THIS route writes is the relation the portal
       * reads.
       */
      const created = await api.post(
        `/admin/partners/${partnerId}/tasks`,
        {
          title: `Photoshoot ${unique}`,
          description: "",
          status: "pending",
          priority: "medium",
        },
        adminHeaders
      )
      expect(created.status).toBeLessThan(300)

      /*
       * CONTROL. `query.index` on the same partner. If this is empty the task
       * or its link never existed, and nothing below would mean anything.
       */
      const adminView = await api.get(
        `/admin/partners/${partnerId}/tasks`,
        adminHeaders
      )
      expect(adminView.status).toBe(200)
      expect(adminView.data.tasks.length).toBeGreaterThan(0)
      const assignedTitles = adminView.data.tasks.map((t: any) => t.title)
      expect(assignedTitles).toContain(`Photoshoot ${unique}`)

      /*
       * THE CLAIM. The same task, through the route the partner's portal calls.
       * An empty array here is the bug: the admin control above has already
       * established that the task exists and is linked to this partner.
       */
      const portalView = await api.get("/partners/assigned-tasks", {
        headers: partnerHeaders,
      })
      expect(portalView.status).toBe(200)

      const portalTitles = (portalView.data.tasks || []).map(
        (t: any) => t.title
      )
      expect(portalTitles).toContain(`Photoshoot ${unique}`)
      expect(portalView.data.count).toBeGreaterThan(0)
    })

    /*
     * 🔴 THE SHAPE THAT WAS ACTUALLY BROKEN ON PROD.
     *
     * Mehak's "Photoshoot" task is not the plain task the first case creates.
     * It carries `metadata.workflow_config: { type: "sequential" }`, a cost,
     * and `eventable/notifiable: false` — the shape the admin UI's workflow
     * builder writes. The creation route picks its result with
     * `result.withoutTemplates || result.withTemplates || result.withParent`
     * and then links exactly ONE id to the partner, so which branch fires
     * decides what the partner can ever see.
     *
     * The first case passing did not clear this one: they take different paths
     * through the same route.
     */
    it("shows a workflow-shaped task, the way the admin UI creates one", async () => {
      const unique = Date.now() + Math.random().toString(36).slice(2, 6)
      const email = `wf-${unique}@jyt.test`

      await api.post("/auth/partner/emailpass/register", {
        email,
        password: PARTNER_PASSWORD,
      })
      let login = await api.post("/auth/partner/emailpass", {
        email,
        password: PARTNER_PASSWORD,
      })
      let partnerHeaders: Record<string, string> = {
        Authorization: `Bearer ${login.data.token}`,
      }
      const partnerRes = await api.post(
        "/partners",
        {
          name: `WF Partner ${unique}`,
          handle: `wfpartner-${unique}`,
          admin: { email, first_name: "WF", last_name: "Partner" },
        },
        { headers: partnerHeaders }
      )
      const partnerId = partnerRes.data.partner.id as string
      login = await api.post("/auth/partner/emailpass", {
        email,
        password: PARTNER_PASSWORD,
      })
      partnerHeaders = { Authorization: `Bearer ${login.data.token}` }

      const created = await api.post(
        `/admin/partners/${partnerId}/tasks`,
        {
          title: `Photoshoot ${unique}`,
          description: "",
          status: "pending",
          priority: "medium",
          eventable: false,
          notifiable: false,
          estimated_cost: 5000,
          cost_currency: "inr",
          cost_type: "total",
          metadata: {
            workflow_config: { type: "sequential", description: "" },
          },
        },
        adminHeaders
      )
      expect(created.status).toBeLessThan(300)

      // Control first, as above.
      const adminView = await api.get(
        `/admin/partners/${partnerId}/tasks`,
        adminHeaders
      )
      expect(
        adminView.data.tasks.map((t: any) => t.title)
      ).toContain(`Photoshoot ${unique}`)

      const portalView = await api.get("/partners/assigned-tasks", {
        headers: partnerHeaders,
      })
      expect(portalView.status).toBe(200)
      expect(
        (portalView.data.tasks || []).map((t: any) => t.title)
      ).toContain(`Photoshoot ${unique}`)
    })

    /*
     * A partner must not see another partner's work. Asserted alongside the
     * above because the obvious "fix" for an empty list — widening the read —
     * is precisely the change that would break this, and it would break it
     * silently and in the worse direction.
     */
    it("does not show one partner the other's tasks", async () => {
      const unique = Date.now() + Math.random().toString(36).slice(2, 6)

      const makePartner = async (tag: string) => {
        const email = `iso-${tag}-${unique}@jyt.test`
        await api.post("/auth/partner/emailpass/register", {
          email,
          password: PARTNER_PASSWORD,
        })
        let login = await api.post("/auth/partner/emailpass", {
          email,
          password: PARTNER_PASSWORD,
        })
        const headers = { Authorization: `Bearer ${login.data.token}` }
        const res = await api.post(
          "/partners",
          {
            name: `Iso ${tag} ${unique}`,
            handle: `iso-${tag}-${unique}`,
            admin: { email, first_name: "Iso", last_name: tag },
          },
          { headers }
        )
        login = await api.post("/auth/partner/emailpass", {
          email,
          password: PARTNER_PASSWORD,
        })
        return {
          id: res.data.partner.id as string,
          headers: { Authorization: `Bearer ${login.data.token}` },
        }
      }

      const a = await makePartner("a")
      const b = await makePartner("b")

      await api.post(
        `/admin/partners/${a.id}/tasks`,
        {
          title: `Only A ${unique}`,
          description: "",
          status: "pending",
          priority: "medium",
        },
        adminHeaders
      )

      const bView = await api.get("/partners/assigned-tasks", {
        headers: b.headers,
      })
      expect(bView.status).toBe(200)
      const bTitles = (bView.data.tasks || []).map((t: any) => t.title)
      expect(bTitles).not.toContain(`Only A ${unique}`)
    })
  })
})

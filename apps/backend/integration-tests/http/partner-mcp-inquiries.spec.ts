import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

jest.setTimeout(240 * 1000)

/**
 * The partner MCP design-inquiry tools, CALLED (#1531 / #1543).
 *
 * ## Why this file exists
 *
 * The inquiry feature shipped with a wizard and no integration test of any
 * kind, and the MCP rows added on top of it are the shape this repo has been
 * burned by twice:
 *
 * - #1394 shipped THREE partner tools that listed perfectly and could never
 *   succeed, because the `required` array they were gated on was itself the
 *   lie;
 * - "Admin MCP works with a secret key" was retracted after `tools/list`
 *   turned out to be the only thing that had ever run.
 *
 * The unit tests prove the slicer reaches these tools and that the registry
 * parses. They cannot prove the dispatcher reaches the route, that the loopback
 * carries the partner's bearer, that the confirm rail fires on the submit, or
 * — the one that is invisible — that a field the model sends ARRIVES. The
 * dispatcher assembles a body by walking `bodyParams`; a key missing from that
 * array is dropped in silence and the call still reports `ok`.
 *
 * So every assertion below is downstream of a real `tools/call`.
 */

/** Streamable HTTP wants both content types; the transport answers JSON. */
const MCP_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
}

const rpc = (method: string, params: Record<string, unknown>, id = 1) => ({
  jsonrpc: "2.0",
  id,
  method,
  params,
})

setupSharedTestSuite(() => {
  describe("POST /partners/mcp — the design-inquiry tools, executed", () => {
    let adminHeaders: { headers: Record<string, string> }
    let partnerHeaders: { Authorization: string }
    let inquiryId: string
    let questions: any[]

    beforeAll(async () => {
      const { api, getContainer } = getSharedTestEnv()
      await createAdminUser(getContainer())
      adminHeaders = await getAuthHeaders(api)

      const unique = Date.now()
      const email = `mcp-inquiry-${unique}@jyt.test`
      const password = "supersecret"

      await api.post("/auth/partner/emailpass/register", { email, password })
      const reg = await api.post("/auth/partner/emailpass", { email, password })
      const partnerRes = await api.post(
        "/partners",
        {
          name: `MCP Inquiry Partner ${unique}`,
          handle: `mcp-inquiry-partner-${unique}`,
          admin: { email, first_name: "MCP", last_name: "Partner" },
        },
        { headers: { Authorization: `Bearer ${reg.data.token}` } }
      )
      expect(partnerRes.status).toBe(200)

      // Re-login: the token minted before the partner existed carries no
      // partner claim, so every /partners/* call on it is a 401.
      const login = await api.post("/auth/partner/emailpass", { email, password })
      partnerHeaders = { Authorization: `Bearer ${login.data.token}` }

      // A design with COLOURS. The questions are generated from the design's
      // spec and its own palette; a design with neither produces an inquiry
      // with nothing to ask, which would make `answer_design_inquiry`
      // untestable for want of a question id.
      const designRes = await api.post(
        "/admin/designs",
        {
          name: `MCP Inquiry Design ${unique}`,
          description: "Design put to a partner over MCP",
          design_type: "Original",
          status: "Approved",
          priority: "Medium",
          colors: [
            { name: "Indigo", hex_code: "#3F51B5" },
            { name: "Madder", hex_code: "#B03A2E" },
          ],
        },
        adminHeaders
      )
      expect(designRes.status).toBe(201)

      const inquiryRes = await api.post(
        `/admin/designs/${designRes.data.design.id}/inquiries`,
        {
          partner_ids: [partnerRes.data.partner.id],
          title: "Can you make this shawl?",
          brief_note: "Handwoven, 90 GSM if possible.",
        },
        adminHeaders
      )
      expect(inquiryRes.status).toBe(201)
      inquiryId = inquiryRes.data.inquiry?.id ?? inquiryRes.data.id
      expect(typeof inquiryId).toBe("string")
    })

    const mcp = (body: any) => {
      const { api } = getSharedTestEnv()
      return api.post("/partners/mcp", body, {
        headers: { ...MCP_HEADERS, ...partnerHeaders },
      })
    }

    /** The tool envelope, surfaced loudly — a JSON-RPC error hides in `result`. */
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const res = await mcp(rpc("tools/call", { name, arguments: args }))
      expect(res.status).toBe(200)
      const text = res.data?.result?.content?.[0]?.text
      if (typeof text !== "string") {
        throw new Error(
          `[${name}] no tool payload — ${JSON.stringify(res.data).slice(0, 600)}`
        )
      }
      const payload = JSON.parse(text)
      if (payload.ok === false) {
        console.log(
          `[${name}] tool refused:`,
          JSON.stringify(payload).slice(0, 800)
        )
      }
      return payload
    }

    it("lists every inquiry tool", async () => {
      const res = await mcp(rpc("tools/list", {}))
      expect(res.status).toBe(200)
      const names: string[] = (res.data?.result?.tools ?? []).map(
        (t: any) => t.name
      )

      for (const name of [
        "list_design_inquiries",
        "get_design_inquiry",
        "answer_design_inquiry",
        "submit_design_inquiry",
        "list_capability_samples",
        "create_capability_sample",
      ]) {
        expect(names).toContain(name)
      }
    })

    it("finds the inquiry the partner was actually asked", async () => {
      const payload = await call("list_design_inquiries", { status: "open" })
      expect(payload.ok).toBe(true)

      const ids = (payload.data?.inquiries ?? []).map((i: any) => i.id)
      expect(ids).toContain(inquiryId)
    })

    it("returns the questions to ask, with the shape of a valid answer", async () => {
      const payload = await call("get_design_inquiry", { inquiryId })
      expect(payload.ok).toBe(true)

      questions = payload.data?.questions ?? []
      expect(questions.length).toBeGreaterThan(0)

      // Every question must carry what the model needs to put it to a partner
      // AND to record the reply in the right shape. A prompt with no `kind` is
      // a question the assistant can ask and cannot answer.
      for (const q of questions) {
        expect(typeof q.id).toBe("string")
        expect(typeof q.prompt).toBe("string")
        expect(typeof q.kind).toBe("string")
      }

      // The brief the designer wrote reaches the partner, not just the title.
      expect(payload.data?.inquiry?.brief_note).toMatch(/90 GSM/)
    })

    // 🔴 The one an `ok: true` cannot tell you. `answers` is a nested array of
    // objects; if it were missing from `bodyParams` the dispatcher would drop
    // it, the route would see an empty batch, and the call would still succeed.
    // Reading the answer back is the only proof it arrived.
    it("records an answer, and the note that carries the real reply", async () => {
      const question = questions[0]

      const saved = await call("answer_design_inquiry", {
        inquiryId,
        answers: [
          {
            question_id: question.id,
            note: "Indigo yes, madder only in the deeper shade.",
          },
        ],
      })
      expect(saved.ok).toBe(true)

      const after = await call("get_design_inquiry", { inquiryId })
      const recorded = (after.data?.answers ?? []).find(
        (a: any) => a.question_id === question.id
      )
      expect(recorded).toBeDefined()
      expect(recorded.note).toBe(
        "Indigo yes, madder only in the deeper shade."
      )

      // Saving is NOT answering: the designer must still read this as silence.
      expect(after.data?.response?.submitted_at ?? null).toBeNull()
      expect(after.data?.response?.verdict ?? null).toBeNull()
    })

    // The submit is `sensitive` because it is what the designer reads. Without
    // `confirm` the dispatcher must plan, not send.
    it("refuses to submit without confirmation", async () => {
      const payload = await call("submit_design_inquiry", {
        inquiryId,
        verdict: "with_changes",
      })

      // 🔑 A held call is NOT `ok: false` — the dispatcher returns a PLAN, and
      // a plan is a successful answer to "what would this do". The signal is
      // `requires_confirmation`; reading `ok` for it would pass on a tool with
      // no confirm rail at all.
      expect(payload.requires_confirmation).toBe(true)
      expect(payload.plan?.method).toBe("POST")
      expect(payload.plan?.path).toBe(`/partners/inquiries/${inquiryId}/submit`)

      const after = await call("get_design_inquiry", { inquiryId })
      expect(after.data?.response?.submitted_at ?? null).toBeNull()
    })

    it("submits the verdict, the lead time and the price the partner gave", async () => {
      const payload = await call("submit_design_inquiry", {
        inquiryId,
        verdict: "with_changes",
        lead_time_days: 21,
        indicative_price: 4200,
        currency_code: "inr",
        notes: "Not at 90 GSM — 110 is the finest we hold a shed at.",
        confirm: true,
      })
      expect(payload.ok).toBe(true)

      const after = await call("get_design_inquiry", { inquiryId })
      const response = after.data?.response

      // Every field, read back. Any one of them missing from `bodyParams`
      // would have been dropped silently by the dispatcher above.
      expect(response?.verdict).toBe("with_changes")
      expect(Number(response?.lead_time_days)).toBe(21)
      expect(Number(response?.indicative_price)).toBe(4200)
      expect(response?.currency_code).toBe("inr")
      expect(response?.notes).toMatch(/110 is the finest/)
      expect(response?.submitted_at).toBeTruthy()
    })

    it("lists the capability library the partner answers with", async () => {
      const payload = await call("list_capability_samples", {})
      expect(payload.ok).toBe(true)
      expect(Array.isArray(payload.data?.samples)).toBe(true)
    })

    // A sample can be recorded without a photograph — the route allows it —
    // but the tool exists to attach evidence, so the id it returns must be
    // usable as an answer's `capability_sample_ids`.
    it("creates a capability sample and returns an id an answer can carry", async () => {
      const payload = await call("create_capability_sample", {
        title: "Kani shawl, indigo ground",
        technique: "kani weave",
        material: "pashmina",
      })
      expect(payload.ok).toBe(true)

      const sampleId = payload.data?.sample?.id
      expect(typeof sampleId).toBe("string")

      // The route defaults `captured_at` when it is not given, and SAYS it did
      // — a library that cannot tell you how stale a photo is is not evidence.
      expect(payload.data?.captured_at_defaulted).toBe(true)

      const listed = await call("list_capability_samples", {})
      expect((listed.data?.samples ?? []).map((s: any) => s.id)).toContain(
        sampleId
      )
    })
  })
})

import EmailOtpAuthProviderService, {
  EMAIL_OTP_REQUESTED_EVENT,
} from "../service"
import { OTP_MAX_ATTEMPTS } from "../otp-code"

const EMAIL = "maker@example.com"
const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as any

/** In-memory stand-in for Medusa's AuthIdentityProviderService. */
function store() {
  let row: any = null
  const svc = {
    retrieve: jest.fn(async ({ entity_id }: { entity_id: string }) => {
      if (!row || entity_id !== EMAIL) throw new Error("not found")
      return row
    }),
    create: jest.fn(async (data: any) => {
      row = {
        id: "authid_1",
        app_metadata: {},
        provider_identities: [
          { provider: "email-otp", entity_id: data.entity_id, provider_metadata: data.provider_metadata },
        ],
      }
      return row
    }),
    update: jest.fn(async (_entity: string, data: any) => {
      row.provider_identities[0].provider_metadata = data.provider_metadata
      return row
    }),
    setState: jest.fn(),
    getState: jest.fn(),
  } as any
  return { svc, meta: () => row?.provider_identities[0].provider_metadata, row: () => row }
}

const setup = () => {
  const emitted: any[] = []
  const eventBus = { emit: jest.fn(async (msg: any) => void emitted.push(msg)) }
  const provider = new EmailOtpAuthProviderService({ logger, event_bus: eventBus } as any, {})
  const s = store()
  const call = (body: Record<string, unknown>, actor_type = "customer") =>
    provider.authenticate({ body, actor_type } as any, s.svc)
  const lastCode = () => emitted.at(-1)?.data?.code as string
  return { provider, emitted, call, lastCode, ...s }
}

describe("EmailOtpAuthProviderService", () => {
  it("sends a code: creates the identity, stores only a hash, emits the code", async () => {
    const t = setup()
    const res = await t.call({ email: " Maker@Example.com " })

    expect(res).toEqual({ success: false, error: "code_sent" })
    expect(t.svc.create).toHaveBeenCalledWith(expect.objectContaining({ entity_id: EMAIL }))
    expect(t.emitted).toHaveLength(1)
    expect(t.emitted[0].name).toBe(EMAIL_OTP_REQUESTED_EVENT)
    expect(t.emitted[0].data).toMatchObject({ email: EMAIL, expires_in_minutes: 10 })
    const code = t.lastCode()
    expect(code).toMatch(/^\d{6}$/)
    expect(JSON.stringify(t.meta())).not.toContain(code)
    expect(t.meta().code_hash).toMatch(/^scrypt\$/)
  })

  it("answers a known email exactly like an unknown one (no enumeration)", async () => {
    const t = setup()
    const first = await t.call({ email: EMAIL })
    const again = await t.call({ email: EMAIL })
    expect(again).toEqual(first)
    expect(t.svc.update).toHaveBeenCalled()
  })

  it("signs in with the right code, once", async () => {
    const t = setup()
    await t.call({ email: EMAIL })
    const ok = await t.call({ email: EMAIL, code: t.lastCode() })
    expect(ok.success).toBe(true)
    expect(ok.authIdentity).toBe(t.row())
    expect(t.meta().code_hash).toBeNull()
    expect(t.meta().verified_at).toBeTruthy()

    const replay = await t.call({ email: EMAIL, code: t.lastCode() })
    expect(replay).toEqual({ success: false, error: "invalid_code" })
  })

  it("a new code replaces the old one", async () => {
    const t = setup()
    await t.call({ email: EMAIL })
    const old = t.lastCode()
    await t.call({ email: EMAIL })
    if (old !== t.lastCode()) {
      expect(await t.call({ email: EMAIL, code: old })).toEqual({ success: false, error: "invalid_code" })
    }
    expect((await t.call({ email: EMAIL, code: t.lastCode() })).success).toBe(true)
  })

  it(`🔴 locks the code after ${OTP_MAX_ATTEMPTS} wrong guesses`, async () => {
    const t = setup()
    await t.call({ email: EMAIL })
    const right = t.lastCode()
    const wrong = right === "000000" ? "111111" : "000000"
    const errors: string[] = []
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
      errors.push(((await t.call({ email: EMAIL, code: wrong })) as any).error)
    }
    expect(errors.at(-1)).toBe("too_many_attempts")
    expect(await t.call({ email: EMAIL, code: right })).toEqual({
      success: false,
      error: "invalid_code",
    })
  })

  it("refuses a code for an email that was never sent one", async () => {
    const t = setup()
    expect(await t.call({ email: EMAIL, code: "123456" })).toEqual({
      success: false,
      error: "invalid_code",
    })
  })

  it("is for customers only, and needs a real email", async () => {
    const t = setup()
    expect(await t.call({ email: EMAIL }, "partner")).toEqual({
      success: false,
      error: "customers_only",
    })
    expect(await t.call({ email: "nope" })).toEqual({ success: false, error: "invalid_email" })
    expect(t.emitted).toHaveLength(0)
  })

  it("reports send_failed (not code_sent) when the email cannot be queued", async () => {
    const provider = new EmailOtpAuthProviderService({ logger } as any, {})
    const s = store()
    const res = await provider.authenticate({ body: { email: EMAIL }, actor_type: "customer" } as any, s.svc)
    expect(res).toEqual({ success: false, error: "send_failed" })
  })
})

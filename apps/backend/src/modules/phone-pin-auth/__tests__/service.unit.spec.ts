import PhonePinAuthProviderService, {
  PHONE_PIN_LOCK_MINUTES,
  PHONE_PIN_MAX_ATTEMPTS,
} from "../service"
import { hashPin, pinProblem, verifyPin } from "../pin-hash"

const PHONE = "+919876543210"
const PIN = "482913"
const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as any

let pinHash: string
beforeAll(async () => {
  pinHash = await hashPin(PIN)
})

/** An in-memory stand-in for Medusa's AuthIdentityProviderService. */
function store(meta: Record<string, unknown> | null = { pin_hash: undefined }) {
  const row = {
    id: "authid_1",
    app_metadata: { partner_id: "partner_1" },
    provider_identities: [
      { provider: "emailpass", entity_id: "a@b.test", provider_metadata: { password: "x" } },
      { provider: "phone-pin", entity_id: PHONE, provider_metadata: meta },
    ],
  }
  const svc = {
    retrieve: jest.fn(async ({ entity_id }: { entity_id: string }) => {
      if (entity_id !== PHONE || meta === null) throw new Error("not found")
      return row
    }),
    update: jest.fn(async (_entity: string, data: any) => {
      row.provider_identities[1].provider_metadata = data.provider_metadata
      return row
    }),
    create: jest.fn(),
    setState: jest.fn(),
    getState: jest.fn(),
  } as any
  return { svc, row, meta: () => row.provider_identities[1].provider_metadata as any }
}

const provider = () => new PhonePinAuthProviderService({ logger }, {})
const login = (body: Record<string, unknown>, actor_type = "partner") =>
  ({ body, actor_type }) as any

describe("PhonePinAuthProviderService", () => {
  it("logs in with the saved number in any format and the right PIN", async () => {
    const { svc, row } = store({ pin_hash: pinHash })
    const res = await provider().authenticate(login({ phone: "98765 43210", pin: PIN }), svc)

    expect(res).toEqual({ success: true, authIdentity: row })
    expect(svc.retrieve).toHaveBeenCalledWith({ entity_id: PHONE })
  })

  it("refuses a wrong PIN and counts the attempt", async () => {
    const s = store({ pin_hash: pinHash })
    const res = await provider().authenticate(login({ phone: PHONE, pin: "111222" }), s.svc)

    expect(res).toEqual({ success: false, error: "Invalid phone number or PIN" })
    expect(s.meta().failed_attempts).toBe(1)
    expect(s.meta().pin_hash).toBe(pinHash)
  })

  it(`locks after ${PHONE_PIN_MAX_ATTEMPTS} wrong PINs — even the right PIN is refused while locked`, async () => {
    const s = store({ pin_hash: pinHash })
    for (let i = 0; i < PHONE_PIN_MAX_ATTEMPTS; i++) {
      await provider().authenticate(login({ phone: PHONE, pin: "111222" }), s.svc)
    }
    const lockedUntil = new Date(s.meta().locked_until).getTime()
    expect(lockedUntil).toBeGreaterThan(Date.now() + (PHONE_PIN_LOCK_MINUTES - 1) * 60_000)

    const res = await provider().authenticate(login({ phone: PHONE, pin: PIN }), s.svc)
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/Too many wrong PINs/)
  })

  it("lets the right PIN in once the lock has expired, and clears the counter", async () => {
    const s = store({
      pin_hash: pinHash,
      failed_attempts: 3,
      locked_until: new Date(Date.now() - 1000).toISOString(),
    })
    const res = await provider().authenticate(login({ phone: PHONE, pin: PIN }), s.svc)
    expect(res.success).toBe(true)
    expect(s.meta()).toMatchObject({ failed_attempts: 0, locked_until: null, pin_hash: pinHash })
  })

  it("refuses a number with no PIN set, and an unknown number, the same way", async () => {
    const noPin = await provider().authenticate(login({ phone: PHONE, pin: PIN }), store({}).svc)
    const unknown = await provider().authenticate(login({ phone: PHONE, pin: PIN }), store(null).svc)
    expect(noPin).toEqual({ success: false, error: "Invalid phone number or PIN" })
    expect(unknown).toEqual(noPin)
  })

  it("refuses non-partner actors without looking anyone up", async () => {
    const s = store({ pin_hash: pinHash })
    const res = await provider().authenticate(login({ phone: PHONE, pin: PIN }, "customer"), s.svc)
    expect(res.success).toBe(false)
    expect(s.svc.retrieve).not.toHaveBeenCalled()
  })

  it("requires both phone and PIN", async () => {
    const s = store({ pin_hash: pinHash })
    expect((await provider().authenticate(login({ phone: PHONE }), s.svc)).success).toBe(false)
    expect((await provider().authenticate(login({ pin: PIN }), s.svc)).success).toBe(false)
  })

  it("does not register (login only)", async () => {
    expect((await provider().register()).success).toBe(false)
  })
})

describe("pin-hash", () => {
  it("verifies the right PIN and rejects others", async () => {
    expect(await verifyPin(PIN, pinHash)).toBe(true)
    expect(await verifyPin("482914", pinHash)).toBe(false)
    expect(await verifyPin(PIN, "garbage")).toBe(false)
  })

  it("salts every hash", async () => {
    expect(await hashPin(PIN)).not.toBe(pinHash)
  })

  it.each([
    ["12345", "6 digits"],
    ["1234567", "6 digits"],
    ["12a456", "6 digits"],
    ["111111", "too easy"],
    ["123456", "too easy"],
    ["654321", "too easy"],
  ])("refuses %s (%s)", (pin) => {
    expect(pinProblem(pin)).not.toBeNull()
  })

  it("accepts an ordinary PIN", () => {
    expect(pinProblem(PIN)).toBeNull()
  })
})

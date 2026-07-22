import KitService from "../service"

/**
 * Unit tests for the Kit HTTP client methods (no DB — MedusaService model
 * methods aren't exercised here). We construct the service with a minimal stub
 * and assert the exact endpoint/header/body sent to a mocked `fetch`.
 */
describe("KitService — HTTP client", () => {
  let service: KitService
  let fetchMock: jest.Mock
  const OLD_ENV = process.env

  beforeEach(() => {
    process.env = { ...OLD_ENV, KIT_API_KEY: "kit_test_key", KIT_BLOG_TAG_ID: "123" }
    // MedusaService methods we call don't touch the container; a bare instance is enough.
    service = new (KitService as any)({}, {})
    fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ broadcast: { id: 999 } }),
    }))
    ;(global as any).fetch = fetchMock
  })

  afterEach(() => {
    process.env = OLD_ENV
    jest.restoreAllMocks()
  })

  it("upsertSubscriber POSTs to /subscribers with the api-key header", async () => {
    await service.upsertSubscriber({ email: "a@x.com", first_name: "Al" })
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe("https://api.kit.com/v4/subscribers")
    expect(opts.method).toBe("POST")
    expect(opts.headers["X-Kit-Api-Key"]).toBe("kit_test_key")
    expect(JSON.parse(opts.body)).toEqual({
      email_address: "a@x.com",
      first_name: "Al",
      state: "active",
    })
  })

  it("tagSubscriber POSTs to the configured tag", async () => {
    await service.tagSubscriber("a@x.com")
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe("https://api.kit.com/v4/tags/123/subscribers")
    expect(JSON.parse(opts.body)).toEqual({ email_address: "a@x.com" })
  })

  it("createBroadcast targets the tag filter and returns the broadcast id", async () => {
    const res = await service.createBroadcast({
      subject: "Hi",
      html: "<p>hi</p>",
      sendAt: "2026-07-22T00:00:00.000Z",
    })
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe("https://api.kit.com/v4/broadcasts")
    const body = JSON.parse(opts.body)
    expect(body.subject).toBe("Hi")
    expect(body.content).toBe("<p>hi</p>")
    expect(body.send_at).toBe("2026-07-22T00:00:00.000Z")
    expect(body.subscriber_filter).toEqual([{ all: [{ type: "tag", ids: [123] }] }])
    expect(res.id).toBe("999")
  })

  it("registerWebhook POSTs the event name + target url", async () => {
    await service.registerWebhook("https://api.example.com/webhooks/kit?event=bounce", "subscriber.subscriber_bounce")
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe("https://api.kit.com/v4/webhooks")
    expect(JSON.parse(opts.body)).toEqual({
      target_url: "https://api.example.com/webhooks/kit?event=bounce",
      event: { name: "subscriber.subscriber_bounce" },
    })
  })

  it("throws a descriptive error on a non-2xx response", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 422,
      text: async () => JSON.stringify({ errors: ["bad"] }),
    })
    await expect(service.upsertSubscriber({ email: "a@x.com" })).rejects.toThrow(/422/)
  })

  it("throws when KIT_API_KEY is missing", async () => {
    delete process.env.KIT_API_KEY
    await expect(service.upsertSubscriber({ email: "a@x.com" })).rejects.toThrow(/KIT_API_KEY/)
  })
})

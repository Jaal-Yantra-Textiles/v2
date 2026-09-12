import { normalizeDelhiveryEpod } from "../client"

/**
 * Delhivery's EPOD push, per their EPOD webhook requirement document:
 * `{ waybill, EPOD, orderID }` with a base64 body. The same hook can be
 * configured to push a downloadable S3 URL instead, so both are parsed.
 */
describe("normalizeDelhiveryEpod", () => {
  it("reads the documented payload", () => {
    const out = normalizeDelhiveryEpod({
      waybill: "1234567890",
      EPOD: "JVBERi0xLjQK",
      orderID: "order_123",
    })
    expect(out.carrier).toBe("delhivery")
    expect(out.awb).toBe("1234567890")
    expect(out.pod_base64).toBe("JVBERi0xLjQK")
    expect(out.pod_url).toBeUndefined()
    expect(out.order_ref).toBe("order_123")
  })

  it("is case-insensitive on the POD key", () => {
    // Their sample writes `EPOD`; their prose writes `epod`.
    expect(normalizeDelhiveryEpod({ waybill: "1", epod: "abc" }).pod_base64).toBe("abc")
    expect(normalizeDelhiveryEpod({ Waybill: "1", Epod: "abc" }).awb).toBe("1")
  })

  it("distinguishes a downloadable URL from a base64 blob", () => {
    // Both arrive in the same field. Storing a URL as base64 would persist an
    // unusable document.
    const out = normalizeDelhiveryEpod({
      waybill: "1",
      EPOD: "https://delhivery-pod.s3.amazonaws.com/x.pdf?sig=1",
    })
    expect(out.pod_url).toBe("https://delhivery-pod.s3.amazonaws.com/x.pdf?sig=1")
    expect(out.pod_base64).toBeUndefined()
  })

  it("accepts the alternate AWB keys the scan push uses", () => {
    expect(normalizeDelhiveryEpod({ awb: "2", EPOD: "x" }).awb).toBe("2")
    expect(normalizeDelhiveryEpod({ wbn: "3", EPOD: "x" }).awb).toBe("3")
    expect(normalizeDelhiveryEpod({ lrnum: "4", EPOD: "x" }).awb).toBe("4")
  })

  it("returns an empty AWB for junk rather than throwing", () => {
    expect(normalizeDelhiveryEpod({}).awb).toBe("")
    expect(normalizeDelhiveryEpod(null).awb).toBe("")
    expect(normalizeDelhiveryEpod("nonsense").awb).toBe("")
  })

  it("keeps the raw payload for the audit trail", () => {
    const p = { waybill: "1", EPOD: "x" }
    expect(normalizeDelhiveryEpod(p).raw).toBe(p)
  })
})

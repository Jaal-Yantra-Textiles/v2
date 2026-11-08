import { normalizeDelhiveryWebhook } from "../../../../../modules/shipping-providers/delhivery/client"
import { describePushBody, pushPayloads } from "../push-body"

/**
 * Nov 2026: Delhivery pushed 26 tracking updates for GOF's parcel (AWB
 * 41712510000125) and every one was dropped as "Push without an AWB". The
 * sender is Python aiohttp, which sends `data=json.dumps(...)` as text/plain —
 * Medusa's text parser hands the route a STRING, not an object. These cases pin
 * every body shape a carrier can produce to the same AWB.
 */
const doc = {
  Shipment: {
    AWB: "41712510000125",
    Status: { Status: "Delivered", StatusType: "DL", StatusDateTime: "2026-11-03T06:39:00" },
  },
}
const text = JSON.stringify(doc)

const awbs = (body: unknown, raw?: unknown) =>
  pushPayloads(body, raw).map((p) => normalizeDelhiveryWebhook(p).awb)

describe("pushPayloads", () => {
  it("passes a parsed JSON object through unchanged", () => {
    expect(pushPayloads(doc)).toEqual([doc])
  })

  it("parses a JSON document sent as text/plain (the string Medusa hands us)", () => {
    expect(awbs(text)).toEqual(["41712510000125"])
  })

  it("parses the raw bytes when no parser ran (octet-stream)", () => {
    expect(awbs(undefined, Buffer.from(text))).toEqual(["41712510000125"])
  })

  it("prefers the raw bytes over a parsed body the form parser mangled", () => {
    // urlencoded-extended reads the brackets in a JSON document as nested keys.
    const mangled = { '{"Shipment":{"AWB":"41712510000125"}}': "" }
    expect(awbs(mangled, Buffer.from(text))).toEqual(["41712510000125"])
    // …and even without the raw bytes, the lone-key form is recovered.
    expect(awbs(mangled)).toEqual(["41712510000125"])
  })

  it("decodes a form field carrying the JSON (data=<json>)", () => {
    expect(awbs({ data: text })).toEqual(["41712510000125"])
    expect(awbs(`data=${encodeURIComponent(text)}`)).toEqual(["41712510000125"])
  })

  it("returns every update in a batch", () => {
    const second = { Shipment: { ...doc.Shipment, AWB: "111" } }
    expect(awbs([doc, second])).toEqual(["41712510000125", "111"])
    expect(awbs(JSON.stringify([doc, second]))).toEqual(["41712510000125", "111"])
  })

  it("returns nothing for an empty body — the test-webhook case", () => {
    expect(pushPayloads({})).toEqual([])
    expect(pushPayloads(undefined, Buffer.from(""))).toEqual([])
    expect(pushPayloads("not json")).toEqual([])
  })
})

describe("describePushBody", () => {
  it("records the content type, shape and a short sample", () => {
    const line = describePushBody({ foo: 1, bar: "x" }, "application/json")
    expect(line).toContain('content-type="application/json"')
    expect(line).toContain("body=object")
    expect(line).toContain("keys=[foo,bar]")
    expect(line).toContain('sample={"foo":1,"bar":"x"}')
  })

  it("caps the sample", () => {
    const line = describePushBody(Buffer.from("x".repeat(5000)), "text/plain")
    expect(line).toContain("body=buffer")
    expect(line.length).toBeLessThan(700)
  })
})

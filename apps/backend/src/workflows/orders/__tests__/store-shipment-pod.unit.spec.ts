import { appendPodToMetadata, type PodRecord } from "../store-shipment-pod"

const rec = (url: string): PodRecord => ({
  url,
  carrier: "delhivery",
  received_at: "2026-09-12T10:00:00.000Z",
  ephemeral: false,
})

/**
 * Delhivery re-push a POD whenever their audit team uploads a corrected one,
 * so several PODs for one AWB are normal. A revision must not destroy the
 * document it replaced — the superseded POD is still evidence of what was
 * shown at delivery time.
 */
describe("appendPodToMetadata", () => {
  it("records the POD and starts a history", () => {
    const out = appendPodToMetadata(undefined, rec("https://cdn/pod-1.pdf"))
    expect(out.pod.url).toBe("https://cdn/pod-1.pdf")
    expect(out.pod_documents).toHaveLength(1)
  })

  it("keeps the superseded POD when a revision arrives", () => {
    const first = appendPodToMetadata({}, rec("https://cdn/pod-1.pdf"))
    const second = appendPodToMetadata(first, rec("https://cdn/pod-2.pdf"))
    expect(second.pod.url).toBe("https://cdn/pod-2.pdf")
    expect(second.pod_documents.map((p: any) => p.url)).toEqual([
      "https://cdn/pod-1.pdf",
      "https://cdn/pod-2.pdf",
    ])
  })

  it("does not grow the history when the same document is re-pushed", () => {
    const first = appendPodToMetadata({}, rec("https://cdn/pod-1.pdf"))
    const retry = appendPodToMetadata(first, rec("https://cdn/pod-1.pdf"))
    expect(retry.pod_documents).toHaveLength(1)
  })

  it("preserves unrelated metadata", () => {
    const out = appendPodToMetadata(
      { last_webhook: "x", tracking_events: [1, 2] },
      rec("https://cdn/pod-1.pdf")
    )
    expect(out.last_webhook).toBe("x")
    expect(out.tracking_events).toEqual([1, 2])
  })

  it("survives a non-array pod_documents left by older data", () => {
    const out = appendPodToMetadata(
      { pod_documents: "corrupt" } as any,
      rec("https://cdn/pod-1.pdf")
    )
    expect(out.pod_documents).toHaveLength(1)
  })
})

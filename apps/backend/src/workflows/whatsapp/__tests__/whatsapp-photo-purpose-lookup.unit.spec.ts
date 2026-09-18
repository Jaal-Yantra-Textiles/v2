import {
  shouldResolvePhotoPurpose,
  findLivePhotoPurpose,
} from "../whatsapp-photo-purpose-lookup"
import { MESSAGING_MODULE } from "../../../modules/messaging"

/**
 * Carrying a photo's stated purpose onto the event the flows read (#2138).
 *
 * 🔴 The defect: `$trigger.photo_purpose === 'product_submission'` is the
 * product-create flow's eligibility rule, and `photo_purpose` was set NOWHERE.
 * The webhook emitted a fixed key set without it and the flow-trigger
 * subscriber enriches nothing, so the condition could never be true. Photo→
 * product creation was off and nothing had failed — a flow that never fires
 * looks exactly like a flow with no eligible input.
 */

const live = (kind: string) => ({
  kind,
  set_at: "2026-09-18T09:00:00.000Z",
  expires_at: "2099-01-01T00:00:00.000Z",
})
const expired = (kind: string) => ({
  kind,
  set_at: "2026-09-01T09:00:00.000Z",
  expires_at: "2026-09-04T09:00:00.000Z",
})

const scopeWith = (conversations: any[], opts: { throws?: boolean } = {}) => ({
  resolve: (key: string) => {
    if (key !== MESSAGING_MODULE) return null
    return {
      listMessagingConversations: async () => {
        if (opts.throws) throw new Error("db is down")
        return conversations
      },
    }
  },
})

describe("shouldResolvePhotoPurpose", () => {
  const base = { partnerId: "partner_1", from: "919876543210", messageType: "image" }

  it("a partner's photo is worth the lookup", () => {
    expect(shouldResolvePhotoPurpose(base)).toBe(true)
    expect(shouldResolvePhotoPurpose({ ...base, messageType: "document" })).toBe(true)
  })

  it("🔴 an ordinary text message costs NO query", () => {
    // This guard is why stamping the purpose does not put a conversation
    // lookup in front of every inbound message in the system.
    expect(shouldResolvePhotoPurpose({ ...base, messageType: "text" })).toBe(false)
    expect(shouldResolvePhotoPurpose({ ...base, messageType: "interactive" })).toBe(false)
  })

  it("a non-partner sender is not worth the lookup", () => {
    expect(shouldResolvePhotoPurpose({ ...base, partnerId: null })).toBe(false)
  })

  it("a message with no sender number cannot be matched to a conversation", () => {
    expect(shouldResolvePhotoPurpose({ ...base, from: "" })).toBe(false)
  })
})

describe("findLivePhotoPurpose", () => {
  const input = { partnerId: "partner_1", from: "919876543210", messageType: "image" }

  it("🔴 returns the purpose the flow's eligibility rule tests", async () => {
    const scope = scopeWith([
      { phone_number: "+91 98765 43210", metadata: { photo_context: live("product_submission") } },
    ])
    await expect(findLivePhotoPurpose(scope, input)).resolves.toBe("product_submission")
  })

  it("returns inventory_offer for an offer context", async () => {
    const scope = scopeWith([
      { phone_number: "919876543210", metadata: { photo_context: live("inventory_offer") } },
    ])
    await expect(findLivePhotoPurpose(scope, input)).resolves.toBe("inventory_offer")
  })

  it("🔴 matches on the PHONE, not the partner's first conversation", async () => {
    // A partner with two numbers has two conversations. The context belongs to
    // the one they are actually messaging from; taking row 0 is the `stores[0]`
    // defect in a smaller place.
    const scope = scopeWith([
      { phone_number: "911111111111", metadata: { photo_context: live("run_progress") } },
      { phone_number: "919876543210", metadata: { photo_context: live("inventory_offer") } },
    ])
    await expect(findLivePhotoPurpose(scope, input)).resolves.toBe("inventory_offer")
  })

  it("🔴 an EXPIRED context stamps nothing — the gate stays shut", async () => {
    const scope = scopeWith([
      { phone_number: "919876543210", metadata: { photo_context: expired("product_submission") } },
    ])
    await expect(findLivePhotoPurpose(scope, input)).resolves.toBeNull()
  })

  it("stamps nothing when no context was ever set", async () => {
    const scope = scopeWith([{ phone_number: "919876543210", metadata: {} }])
    await expect(findLivePhotoPurpose(scope, input)).resolves.toBeNull()
  })

  it("stamps nothing when no conversation matches the number", async () => {
    const scope = scopeWith([
      { phone_number: "911111111111", metadata: { photo_context: live("product_submission") } },
    ])
    await expect(findLivePhotoPurpose(scope, input)).resolves.toBeNull()
  })

  it("🔴 NEVER throws — a failed lookup must not break inbound handling", async () => {
    // This runs inside the webhook's emit path. Degrading to "nobody said what
    // these are for" sends the photo to batch-and-ask, which is exactly what
    // happened before this existed.
    const scope = scopeWith([], { throws: true })
    await expect(findLivePhotoPurpose(scope, input)).resolves.toBeNull()
  })

  it("does not query at all for a text message", async () => {
    let called = false
    const scope = {
      resolve: () => ({
        listMessagingConversations: async () => {
          called = true
          return []
        },
      }),
    }
    await findLivePhotoPurpose(scope, { ...input, messageType: "text" })
    expect(called).toBe(false)
  })
})

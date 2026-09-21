/**
 * #2216 — the constant is the floor.
 *
 * `phraseLine` has exactly one job beyond calling a model: making sure that
 * every path which is not a clean, verified success returns the English string
 * that shipped before it existed. Flag off, no model, a throw, a slow reply, a
 * rejected reply — all of them are the old message. The one outcome it must
 * never produce is silence.
 */
const generateTextMock = jest.fn()
const resolveModelMock = jest.fn()

jest.mock("ai", () => ({ generateText: (...args: any[]) => generateTextMock(...args) }))
jest.mock("../whatsapp-model", () => ({
  resolveWhatsAppModel: (...args: any[]) => resolveModelMock(...args),
}))

import { phraseLine } from "../whatsapp-line"

const FALLBACK = "Run prod_run_1 is not assigned to your account."

const spec = (over: Record<string, any> = {}) => ({
  brief: "They tried to use a job that is not theirs.",
  tail: "*Run:* prod_run_1",
  fallback: FALLBACK,
  ...over,
})

const withFlag = async (value: string | undefined, fn: () => Promise<void>) => {
  const prev = process.env.WHATSAPP_NATURAL_RUN_ACKS_ENABLED
  if (value === undefined) delete process.env.WHATSAPP_NATURAL_RUN_ACKS_ENABLED
  else process.env.WHATSAPP_NATURAL_RUN_ACKS_ENABLED = value
  try {
    await fn()
  } finally {
    if (prev === undefined) delete process.env.WHATSAPP_NATURAL_RUN_ACKS_ENABLED
    else process.env.WHATSAPP_NATURAL_RUN_ACKS_ENABLED = prev
  }
}

beforeEach(() => {
  generateTextMock.mockReset()
  resolveModelMock.mockReset()
  resolveModelMock.mockResolvedValue({ model: {} })
})

describe("phraseLine", () => {
  it("ships dark — flag off means the model is never even asked", async () => {
    await withFlag(undefined, async () => {
      expect(await phraseLine({} as any, { spec: spec(), language: "hi" })).toBe(
        FALLBACK
      )
      expect(resolveModelMock).not.toHaveBeenCalled()
      expect(generateTextMock).not.toHaveBeenCalled()
    })
  })

  it("sends the model's sentence with the id appended by code", async () => {
    await withFlag("true", async () => {
      generateTextMock.mockResolvedValue({
        text: "यह काम आपका नहीं है।",
      })

      expect(await phraseLine({} as any, { spec: spec(), language: "hi" })).toBe(
        "यह काम आपका नहीं है।\n\n*Run:* prod_run_1"
      )
    })
  })

  it("falls back when the model invents an identifier", async () => {
    await withFlag("true", async () => {
      generateTextMock.mockResolvedValue({
        text: "Job prod_run_01M22YXTZKQXBSD is not yours.",
      })

      expect(await phraseLine({} as any, { spec: spec(), language: "en" })).toBe(
        FALLBACK
      )
    })
  })

  it("falls back when the model invents a quantity", async () => {
    await withFlag("true", async () => {
      generateTextMock.mockResolvedValue({ text: "You made 20 pieces." })

      const out = await phraseLine({} as any, {
        spec: spec({ facts: [{ label: "Pieces they made", value: 2 }] }),
        language: "en",
      })

      expect(out).toBe(FALLBACK)
    })
  })

  it("falls back when the model call throws — a phrasing problem is not a failed action", async () => {
    await withFlag("true", async () => {
      generateTextMock.mockRejectedValue(new Error("502 from provider"))

      expect(await phraseLine({} as any, { spec: spec(), language: "en" })).toBe(
        FALLBACK
      )
    })
  })

  it("falls back when no model is configured at all", async () => {
    await withFlag("true", async () => {
      resolveModelMock.mockResolvedValue({ model: null })

      expect(await phraseLine({} as any, { spec: spec(), language: "en" })).toBe(
        FALLBACK
      )
      expect(generateTextMock).not.toHaveBeenCalled()
    })
  })

  /*
   * The partner is on their phone. A provider that hangs must cost them 3.5
   * seconds and then the plain message — never an unbounded wait, and never
   * nothing at all.
   */
  it("falls back rather than making the partner wait on a slow provider", async () => {
    jest.useFakeTimers()
    try {
      await withFlag("true", async () => {
        generateTextMock.mockReturnValue(new Promise(() => {}))

        const pending = phraseLine({} as any, { spec: spec(), language: "en" })
        /*
         * `...Async` and not `advanceTimersByTime`: the timeout is armed only
         * AFTER `resolveWhatsAppModel` settles, which is a microtask. Advancing
         * synchronously runs before that timer exists, so the clock moves past
         * a timeout that has not been set yet and the test hangs on a promise
         * nothing will ever resolve.
         */
        await jest.advanceTimersByTimeAsync(4000)

        expect(await pending).toBe(FALLBACK)
      })
    } finally {
      jest.useRealTimers()
    }
  })
})

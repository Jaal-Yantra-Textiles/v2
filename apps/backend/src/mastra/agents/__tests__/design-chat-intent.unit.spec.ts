jest.mock("../../../lib/ai/classify", () => ({ classify: jest.fn() }))

import { classify } from "../../../lib/ai/classify"
import {
  designTurnQuestions,
  designTurnState,
  judgeDesignTurn,
  readDesignTurn,
  type OpenDesign,
} from "../design-chat-intent"

// Answer shapes as the Featherless demo returned them, 2026-11-20.
const pick = (choice: string, p: number, others: string[] = []) => ({
  type: "choice",
  choice,
  confidence: p,
  probabilities: { [choice]: p, ...Object.fromEntries(others.map((o) => [o, (1 - p) / Math.max(1, others.length)])) },
})

const TROUSERS: OpenDesign = { design_id: "des_trousers", garment: "trousers", name: "Trousers" }
const SHAWL: OpenDesign = { design_id: "des_shawl", garment: "shawl", name: null }

describe("readDesignTurn (#2556)", () => {
  it("a confident new piece with its garment", () => {
    expect(
      readDesignTurn({ intent: pick("new_piece", 1), new_garment: pick("dupatta", 0.98) }, [])
    ).toEqual({ action: "new_piece", product_type: "dupatta" })
  })

  it("a new piece whose garment is unsure is started without one (the maker says it next)", () => {
    expect(
      readDesignTurn({ intent: pick("new_piece", 0.97), new_garment: pick("shawl", 0.5, ["stole"]) }, [])
    ).toEqual({ action: "new_piece", product_type: null })
  })

  it("a 'new' piece one of the open designs is already for switches to it instead", () => {
    expect(
      readDesignTurn({ intent: pick("new_piece", 1), new_garment: pick("trousers", 0.99) }, [TROUSERS])
    ).toEqual({ action: "switch", design_id: "des_trousers" })
  })

  it("going back: to the design it names", () => {
    expect(
      readDesignTurn({ intent: pick("switch_back", 1), switch_to: pick("d1", 0.95) }, [TROUSERS, SHAWL])
    ).toEqual({ action: "switch", design_id: "des_shawl" })
  })

  it("going back with only one other design needs no second answer", () => {
    expect(readDesignTurn({ intent: pick("switch_back", 1) }, [TROUSERS])).toEqual({
      action: "switch",
      design_id: "des_trousers",
    })
  })

  it("going back, but which design is unsure with several open → no action", () => {
    expect(
      readDesignTurn({ intent: pick("switch_back", 1), switch_to: pick("d0", 0.6, ["d1"]) }, [TROUSERS, SHAWL])
    ).toBeNull()
  })

  it("'current' is a decision to stay (the word rules are NOT consulted)", () => {
    expect(readDesignTurn({ intent: pick("current", 0.95) }, [])).toEqual({ action: "stay" })
  })

  it("below the bar it is no answer, so the caller falls back", () => {
    expect(readDesignTurn({ intent: pick("new_piece", 0.8, ["current"]) }, [])).toBeNull()
    expect(readDesignTurn({}, [])).toBeNull()
  })
})

describe("designTurnQuestions / designTurnState", () => {
  it("asks which open design only when there is one, and always offers 'none' / 'not named'", () => {
    const alone = designTurnQuestions([])
    expect(Object.keys(alone)).toEqual(["intent", "new_garment"])
    expect((alone.new_garment as any).criteria).toHaveProperty("not_named")
    expect((alone.new_garment as any).criteria).toHaveProperty("trousers")
    expect((alone.new_garment as any).criteria).not.toHaveProperty("pants")

    const two = designTurnQuestions([TROUSERS, SHAWL])
    expect(Object.keys((two.switch_to as any).criteria)).toEqual(["d0", "d1", "none"])
  })

  it("sends garment names and the two messages only — no ids", () => {
    const state = designTurnState({
      lastUserText: "back to the trousers",
      lastAssistantText: "Your shawl is started.",
      activeGarment: "shawl",
      others: [TROUSERS],
    })
    expect(JSON.stringify(state)).not.toContain("des_")
    expect(state).toMatchObject({ designing_now: "shawl", maker_message: "back to the trousers" })
  })
})

describe("judgeDesignTurn", () => {
  const mocked = classify as jest.MockedFunction<typeof classify>
  beforeEach(() => mocked.mockReset())

  it("is null when no classifier serves the scope (off), so the caller keeps its word rules", async () => {
    mocked.mockResolvedValue(null)
    expect(
      await judgeDesignTurn({}, { lastUserText: "now the trousers", activeGarment: "kurta", others: [] })
    ).toBeNull()
    expect(mocked.mock.calls[0][1].scope).toBe("design_chat_intent")
  })

  it("never asks about an empty message", async () => {
    expect(await judgeDesignTurn({}, { lastUserText: "  ", activeGarment: "kurta", others: [] })).toBeNull()
    expect(mocked).not.toHaveBeenCalled()
  })

  it("reads a real answer into an action", async () => {
    mocked.mockResolvedValue({
      model: "m",
      provider: "codiv",
      platformId: "p",
      answers: { intent: pick("new_piece", 1), new_garment: pick("dupatta", 0.99) },
    } as any)
    expect(
      await judgeDesignTurn({}, { lastUserText: "could we do a dupatta to go with it", activeGarment: "kurta", others: [] })
    ).toEqual({ action: "new_piece", product_type: "dupatta" })
  })
})

import { detectNewPieceIntent } from "../design-new-piece-intent"

// #2556: prod transcript, 2026-11-19 — the model faked "Design created ✅" for
// each of these instead of calling start_new_design.
describe("detectNewPieceIntent", () => {
  const kurta = { activeGarment: "kurta" }

  it("starts the trousers when the maker asks for 'the matching trousers'", () => {
    expect(detectNewPieceIntent({ ...kurta, lastUserText: "Now the matching trousers" })).toEqual({
      product_type: "trousers",
      source: "message",
    })
  })

  it("folds synonyms: 'pants' is trousers", () => {
    expect(
      detectNewPieceIntent({ ...kurta, lastUserText: "can you also do matching pants?" })
    ).toEqual({ product_type: "trousers", source: "message" })
  })

  it("does not start a piece for a garment named without asking for more", () => {
    expect(
      detectNewPieceIntent({ ...kurta, lastUserText: "would it look good with trousers?" })
    ).toBeNull()
  })

  it("does not start another design for the garment already being designed", () => {
    expect(
      detectNewPieceIntent({ ...kurta, lastUserText: "now make the kurta longer" })
    ).toBeNull()
  })

  it("does not start a piece one of the other open designs is already for", () => {
    expect(
      detectNewPieceIntent({
        ...kurta,
        openGarments: ["trousers"],
        lastUserText: "now the matching trousers",
      })
    ).toBeNull()
  })

  it("leaves the first garment to the brief when the active design has none yet", () => {
    expect(
      detectNewPieceIntent({ activeGarment: null, lastUserText: "now a kurta please" })
    ).toBeNull()
  })

  it("the '+ Another design' button always starts one, garment or not", () => {
    expect(
      detectNewPieceIntent({
        ...kurta,
        explicit: true,
        lastUserText: "I'd like to start another design — keep my current one saved.",
      })
    ).toEqual({ product_type: null, source: "button" })
    expect(
      detectNewPieceIntent({ activeGarment: null, explicit: true, lastUserText: "" })
    ).toEqual({ product_type: null, source: "button" })
  })

  it("plain text with no garment never starts one", () => {
    expect(detectNewPieceIntent({ ...kurta, lastUserText: "now show me fabrics" })).toBeNull()
  })
})

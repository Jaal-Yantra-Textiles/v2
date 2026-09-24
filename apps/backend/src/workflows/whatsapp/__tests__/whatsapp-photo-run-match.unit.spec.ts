import {
  buildPhotoRunQuestion,
  decidePhotoRun,
  NONE_OF_THESE,
  PHOTO_RUN_MIN_CONFIDENCE,
} from "../whatsapp-photo-run-match"

const runs = [
  { id: "prod_run_A", design: "Luong Shirt" },
  { id: "prod_run_B", design: "Oshen Robe", description: "cotton and silk robe" },
]
const pick = (c: string, confidence: number) => ({ type: "choice" as const, choice: c, confidence, probabilities: {} })

describe("which run is a WhatsApp photo for", () => {
  it("offers every run plus 'none', and says what the photo shows", () => {
    const { state, questions } = buildPhotoRunQuestion(runs, { seen: "a folded striped shirt", caption: null })
    expect(Object.keys((questions.run as any).criteria)).toEqual(["run_1", "run_2", NONE_OF_THESE])
    expect(state).toMatchObject({ photo_shows: "a folded striped shirt" })
  })

  it("guesses the picked run when sure enough", () => {
    expect(decidePhotoRun(pick("run_2", 0.93), runs)).toEqual({ runId: "prod_run_B", confidence: 0.93 })
  })

  it("asks instead when the classifier says none, is unsure, or picks nothing offered", () => {
    expect(decidePhotoRun(pick(NONE_OF_THESE, 0.9), runs).runId).toBeNull()
    expect(decidePhotoRun(pick("run_1", PHOTO_RUN_MIN_CONFIDENCE - 0.01), runs).runId).toBeNull()
    expect(decidePhotoRun(pick("run_9", 0.99), runs).runId).toBeNull()
    expect(decidePhotoRun(undefined, runs).runId).toBeNull()
  })
})

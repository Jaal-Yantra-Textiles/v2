import { outputsText } from "../openrouter"
import type { OpenRouterModel } from "../openrouter"

const model = (id: string, output?: string[]): OpenRouterModel =>
  ({
    id,
    architecture: {
      input_modalities: ["text", "image"],
      ...(output ? { output_modalities: output } : {}),
    },
  } as unknown as OpenRouterModel)

describe("openrouter.outputsText", () => {
  it("keeps vision→text models", () => {
    expect(outputsText(model("qwen/qwen2.5-vl-72b-instruct:free", ["text"]))).toBe(true)
  })

  it("rejects audio/image generators that accept image input (the lyria bug)", () => {
    expect(outputsText(model("google/lyria-3-pro-preview", ["audio"]))).toBe(false)
    expect(outputsText(model("some/image-gen", ["image"]))).toBe(false)
  })

  it("keeps multi-output models that include text", () => {
    expect(outputsText(model("x/multi", ["text", "image"]))).toBe(true)
  })

  it("keeps models that omit output_modalities (free chat models often do)", () => {
    expect(outputsText(model("x/no-output-declared"))).toBe(true)
    expect(outputsText(model("x/empty-output", []))).toBe(true)
  })
})

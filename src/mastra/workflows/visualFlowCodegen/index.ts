// @ts-nocheck - Ignore all TypeScript errors in this file
import { createWorkflow, createStep } from "@mastra/core/workflows"
import { z } from "zod/v4"
import { visualFlowCodegenAgent } from "../../agents"

const inputSchema = z.object({
  prompt: z.string().min(1, "prompt is required"),
  // Optional: Provide any structured context about the flow/node/available variables
  context: z.record(z.any()).optional().default({}),
  // Optional: force the model to produce certain output keys
  desiredOutputKeys: z.array(z.string()).optional(),
  // Optional: allow the model to declare packages it wants to use
  allowExternalPackages: z.boolean().optional().default(false),
})

const outputSchema = z.object({
  code: z.string(),
  packages: z.array(z.string()).default([]),
  outputKeys: z.array(z.string()).default([]),
  notes: z.array(z.string()).default([]),
})

function tryParseJson(text: string): any {
  if (!text) return null
  const trimmed = String(text).trim()

  // raw JSON
  try {
    return JSON.parse(trimmed)
  } catch {}

  // fenced ```json
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim())
    } catch {}
  }

  // first JSON object substring
  const obj = trimmed.match(/\{[\s\S]*\}/)
  if (obj?.[0]) {
    try {
      return JSON.parse(obj[0])
    } catch {}
  }

  return null
}

const generateStep = createStep({
  id: "generate",
  inputSchema,
  outputSchema,
  execute: async ({ inputData }) => {
    const desired = Array.isArray(inputData.desiredOutputKeys) ? inputData.desiredOutputKeys : []

    const instruction = [
      "Generate JavaScript code for a Visual Flow execute_code node.",
      "Return ONLY JSON with keys: code, packages, outputKeys, notes.",
      "The code must be a single snippet that ends with `return { ... }`.",
      "Use $last for previous node output and $input for multi-node access.",
      "Do NOT include markdown.",
      desired.length ? `The returned object MUST include these output keys when sensible: ${desired.join(", ")}` : "",
      "Context (may be empty):",
      JSON.stringify(inputData.context || {}, null, 2),
      "User prompt:",
      String(inputData.prompt || ""),
    ]
      .filter(Boolean)
      .join("\n")

    const resp = await (visualFlowCodegenAgent as any).generate(
      [{ role: "user", content: instruction }],
      {
        format: "mastra",
        toolChoice: "none",
      }
    )

    const parsed = tryParseJson((resp as any)?.text || "") || {}

    const code = typeof parsed.code === "string" ? parsed.code : "return { ok: false, error: 'No code generated' }"
    const packages = Array.isArray(parsed.packages) ? parsed.packages.map(String) : []
    const outputKeys = Array.isArray(parsed.outputKeys) ? parsed.outputKeys.map(String) : []
    const notes = Array.isArray(parsed.notes) ? parsed.notes.map(String) : []

    // Safety: if external packages are disallowed, force packages=[]
    if (!inputData.allowExternalPackages) {
      return { code, packages: [], outputKeys, notes }
    }

    return { code, packages, outputKeys, notes }
  },
})

export const visualFlowCodegenWorkflow = createWorkflow({
  id: "visual-flow-codegen",
  inputSchema,
  outputSchema,
})
  .then(generateStep)
  .commit()

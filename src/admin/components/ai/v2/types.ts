export type UiMessage = {
  id: string
  role: "user" | "assistant"
  content: string
}

export type AiV2RunStatus = "idle" | "running" | "suspended" | "completed" | "error"

import type { UiMessage } from "../types"

export const bubbleClass = (role: UiMessage["role"]) =>
  role === "user"
    ? "ml-auto bg-ui-bg-base border border-ui-border-base"
    : "mr-auto bg-ui-bg-subtle"

export const createLocalId = () => {
  return typeof crypto !== "undefined" && (crypto as any).randomUUID
    ? (crypto as any).randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export const uiMessageToText = (content: any): string => {
  if (typeof content === "string") return content
  if (content == null) return ""
  if (Array.isArray(content)) {
    const parts = content
      .map((p) => {
        if (typeof p === "string") return p
        if (p && typeof p === "object") {
          if (typeof (p as any).text === "string") return (p as any).text
          if (typeof (p as any).content === "string") return (p as any).content
        }
        return ""
      })
      .filter(Boolean)
    if (parts.length) return parts.join("")
  }
  if (typeof content === "object") {
    if (typeof (content as any).text === "string") return (content as any).text
    if (typeof (content as any).content === "string") return (content as any).content
    if (typeof (content as any).message === "string") return (content as any).message
  }
  try {
    return JSON.stringify(content, null, 2)
  } catch {
    return String(content)
  }
}

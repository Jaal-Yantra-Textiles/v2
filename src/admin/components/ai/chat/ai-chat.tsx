/**
 * AI Chat Component
 *
 * A simplified chat interface using the hybrid query resolver.
 * Designed to be Vercel AI SDK compatible.
 */

import { useRef, useEffect } from "react"
import {
  Button,
  Textarea,
  Badge,
  Container,
  Heading,
  Text,
  clx,
} from "@medusajs/ui"
import { Sparkles, ArrowUpMini, XMark, ArrowPath } from "@medusajs/icons"
import { useAiChatCompat, useAiChatStatus, AiChatMessage } from "../../../hooks/api/ai-chat"

// ============================================
// Message Component
// ============================================

function Message({ message }: { message: AiChatMessage }) {
  const isUser = message.role === "user"

  return (
    <div
      className={clx(
        "flex w-full",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      <div
        className={clx(
          "max-w-[80%] rounded-lg px-4 py-3",
          isUser
            ? "bg-ui-bg-interactive text-ui-fg-on-color"
            : "bg-ui-bg-subtle text-ui-fg-base"
        )}
      >
        {isUser ? (
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div className="prose prose-sm max-w-none text-ui-fg-base">
            <MessageContent content={message.content} />
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================
// Message Content (Markdown-like rendering)
// ============================================

function MessageContent({ content }: { content: string }) {
  // Simple markdown-like rendering
  const lines = content.split("\n")

  return (
    <div className="space-y-2">
      {lines.map((line, i) => {
        // Headers
        if (line.startsWith("### ")) {
          return (
            <h4 key={i} className="font-semibold text-ui-fg-base mt-3">
              {line.slice(4)}
            </h4>
          )
        }
        if (line.startsWith("## ")) {
          return (
            <h3 key={i} className="font-semibold text-ui-fg-base mt-4">
              {line.slice(3)}
            </h3>
          )
        }
        if (line.startsWith("# ")) {
          return (
            <h2 key={i} className="font-bold text-ui-fg-base mt-4">
              {line.slice(2)}
            </h2>
          )
        }

        // List items
        if (line.startsWith("- ") || line.startsWith("* ")) {
          return (
            <li key={i} className="ml-4 list-disc text-sm">
              {line.slice(2)}
            </li>
          )
        }

        // Code blocks (inline)
        if (line.includes("`")) {
          const parts = line.split(/(`[^`]+`)/g)
          return (
            <p key={i} className="text-sm">
              {parts.map((part, j) =>
                part.startsWith("`") && part.endsWith("`") ? (
                  <code
                    key={j}
                    className="bg-ui-bg-base px-1 py-0.5 rounded text-xs font-mono"
                  >
                    {part.slice(1, -1)}
                  </code>
                ) : (
                  part
                )
              )}
            </p>
          )
        }

        // Bold
        if (line.includes("**")) {
          const parts = line.split(/(\*\*[^*]+\*\*)/g)
          return (
            <p key={i} className="text-sm">
              {parts.map((part, j) =>
                part.startsWith("**") && part.endsWith("**") ? (
                  <strong key={j}>{part.slice(2, -2)}</strong>
                ) : (
                  part
                )
              )}
            </p>
          )
        }

        // Empty lines
        if (!line.trim()) {
          return <div key={i} className="h-2" />
        }

        // Regular text
        return (
          <p key={i} className="text-sm">
            {line}
          </p>
        )
      })}
    </div>
  )
}

// ============================================
// Loading Indicator
// ============================================

function LoadingIndicator() {
  return (
    <div className="flex items-center gap-2 text-ui-fg-muted">
      <div className="flex gap-1">
        <span className="w-2 h-2 bg-ui-fg-muted rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
        <span className="w-2 h-2 bg-ui-fg-muted rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
        <span className="w-2 h-2 bg-ui-fg-muted rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
      </div>
      <Text size="small" className="text-ui-fg-muted">
        Thinking...
      </Text>
    </div>
  )
}

// ============================================
// Resolution Badge
// ============================================

function ResolutionBadge({
  resolvedQuery,
}: {
  resolvedQuery?: {
    targetEntity: string
    mode: string
    source: string
    confidence: number
  } | null
}) {
  if (!resolvedQuery) return null

  const sourceColors = {
    indexed: "green",
    bm25_llm: "blue",
    fallback: "orange",
  } as const

  return (
    <div className="flex items-center gap-2 text-xs text-ui-fg-muted">
      <Badge
        size="2xsmall"
        color={sourceColors[resolvedQuery.source as keyof typeof sourceColors] || "grey"}
      >
        {resolvedQuery.source}
      </Badge>
      <span>{resolvedQuery.targetEntity}</span>
      <span>{(resolvedQuery.confidence * 100).toFixed(0)}%</span>
    </div>
  )
}

// ============================================
// Main Chat Component
// ============================================

export function AiChat() {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const { data: status } = useAiChatStatus()

  const {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    isLoading,
    error,
    lastResponse,
    clearMessages,
    setInput,
  } = useAiChatCompat({
    resourceId: "ai:chat",
  })

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, isLoading])

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Handle Enter key (Shift+Enter for newline)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="flex flex-col h-full bg-ui-bg-base">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-ui-border-base">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-ui-bg-interactive flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-ui-fg-on-color" />
          </div>
          <div>
            <Heading level="h2" className="text-ui-fg-base">
              AI Chat
            </Heading>
            <Text size="small" className="text-ui-fg-muted">
              Hybrid Query Resolver
            </Text>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {status?.workflow?.available && (
            <Badge size="small" color="green">
              Ready
            </Badge>
          )}
          {messages.length > 0 && (
            <Button
              variant="secondary"
              size="small"
              onClick={clearMessages}
            >
              <XMark className="w-4 h-4" />
              Clear
            </Button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-16 h-16 rounded-full bg-ui-bg-subtle flex items-center justify-center mb-4">
              <Sparkles className="w-8 h-8 text-ui-fg-muted" />
            </div>
            <Heading level="h3" className="text-ui-fg-base mb-2">
              Start a conversation
            </Heading>
            <Text className="text-ui-fg-muted max-w-md">
              Ask about your data, designs, orders, or anything else.
              Uses BM25 + LLM for intelligent query resolution.
            </Text>

            {/* Quick prompts */}
            <div className="flex flex-wrap gap-2 mt-6 max-w-lg justify-center">
              {[
                "Show me designs with specifications",
                "List recent orders",
                "What visual flows exist?",
                "Show production runs",
              ].map((prompt) => (
                <Button
                  key={prompt}
                  variant="secondary"
                  size="small"
                  onClick={() => {
                    setInput(prompt)
                    inputRef.current?.focus()
                  }}
                >
                  {prompt}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message) => (
              <Message key={message.id} message={message} />
            ))}

            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-ui-bg-subtle rounded-lg px-4 py-3">
                  <LoadingIndicator />
                </div>
              </div>
            )}

            {error && (
              <div className="flex justify-start">
                <div className="bg-ui-bg-subtle-hover rounded-lg px-4 py-3 border border-ui-tag-red-border">
                  <Text size="small" className="text-ui-tag-red-text">
                    Error: {error.message}
                  </Text>
                </div>
              </div>
            )}

            {/* Resolution info for last response */}
            {lastResponse?.result?.resolvedQuery && (
              <div className="flex justify-start ml-4">
                <ResolutionBadge resolvedQuery={lastResponse.result.resolvedQuery} />
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="px-6 py-4 border-t border-ui-border-base bg-ui-bg-subtle">
        <form onSubmit={handleSubmit} className="flex gap-3">
          <div className="flex-1 relative">
            <Textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything..."
              className="w-full resize-none pr-12"
              rows={1}
              disabled={isLoading}
            />
          </div>
          <Button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="shrink-0"
          >
            {isLoading ? (
              <ArrowPath className="w-4 h-4 animate-spin" />
            ) : (
              <ArrowUpMini className="w-4 h-4" />
            )}
            Send
          </Button>
        </form>

        {/* Meta info */}
        <div className="flex items-center justify-between mt-2">
          <Text size="xsmall" className="text-ui-fg-muted">
            BM25 + LLM Hybrid Resolver
          </Text>
          {lastResponse?.meta?.durationMs && (
            <Text size="xsmall" className="text-ui-fg-muted">
              {(lastResponse.meta.durationMs / 1000).toFixed(1)}s
            </Text>
          )}
        </div>
      </div>
    </div>
  )
}

export default AiChat

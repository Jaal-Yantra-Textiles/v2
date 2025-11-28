import { useState, useRef, useEffect } from "react"
import { Textarea, Text } from "@medusajs/ui"
import { useHashtagSuggestions, usePopularHashtags } from "../../hooks/api/hashtags"
import { useMentionSuggestions } from "../../hooks/api/mentions"

type CaptionInputProps = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  platform?: "facebook" | "instagram" | "twitter" | "linkedin" | "all"
  platformId?: string
  disabled?: boolean
}

export const CaptionInputWithSuggestions = ({
  value,
  onChange,
  placeholder = "Write your caption...",
  platform = "all",
  platformId,
  disabled = false,
}: CaptionInputProps) => {
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [suggestionType, setSuggestionType] = useState<"hashtag" | "mention" | null>(null)
  const [currentQuery, setCurrentQuery] = useState("")
  const [cursorPosition, setCursorPosition] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Get suggestions based on current query
  const { data: hashtagData } = useHashtagSuggestions(
    currentQuery,
    platform,
    platformId,
    suggestionType === "hashtag" && currentQuery.length > 0
  )
  const { data: mentionData } = useMentionSuggestions(
    currentQuery,
    platform === "all" ? undefined : platform,
    suggestionType === "mention" && currentQuery.length > 0
  )

  // Get popular hashtags for when user types just "#" (only fetch when needed)
  const shouldFetchPopular = suggestionType === "hashtag" && currentQuery.length === 0
  const { data: popularHashtagsData } = usePopularHashtags(
    platform !== "all" ? platform : undefined,
    10,
    shouldFetchPopular
  )

  // Detect if user is typing a hashtag or mention
  useEffect(() => {
    if (!value) {
      setShowSuggestions(false)
      return
    }

    const textarea = textareaRef.current
    if (!textarea) return

    const cursorPos = textarea.selectionStart
    const textBeforeCursor = value.substring(0, cursorPos)
    
    // Find the last word before cursor
    const words = textBeforeCursor.split(/\s/)
    const lastWord = words[words.length - 1]

    if (lastWord.startsWith("#")) {
      // User is typing a hashtag
      setSuggestionType("hashtag")
      setCurrentQuery(lastWord.slice(1)) // Remove #
      setCursorPosition(cursorPos)
      setShowSuggestions(true)
    } else if (lastWord.startsWith("@")) {
      // User is typing a mention
      setSuggestionType("mention")
      setCurrentQuery(lastWord.slice(1)) // Remove @
      setCursorPosition(cursorPos)
      setShowSuggestions(true)
    } else {
      setShowSuggestions(false)
      setSuggestionType(null)
      setCurrentQuery("")
    }
  }, [value])

  const insertSuggestion = (suggestion: string) => {
    const textarea = textareaRef.current
    if (!textarea) return

    const textBeforeCursor = value.substring(0, cursorPosition)
    const textAfterCursor = value.substring(cursorPosition)
    
    // Find the start of the current word (hashtag or mention)
    const words = textBeforeCursor.split(/\s/)
    const lastWord = words[words.length - 1]
    const wordStart = textBeforeCursor.length - lastWord.length
    
    // Build the new text with the suggestion
    const prefix = suggestionType === "hashtag" ? "#" : "@"
    const newText = 
      value.substring(0, wordStart) + 
      prefix + suggestion + 
      " " + 
      textAfterCursor

    onChange(newText)
    setShowSuggestions(false)
    
    // Set cursor position after the inserted suggestion
    setTimeout(() => {
      const newCursorPos = wordStart + prefix.length + suggestion.length + 1
      textarea.setSelectionRange(newCursorPos, newCursorPos)
      textarea.focus()
    }, 0)
  }

  const suggestions = suggestionType === "hashtag" 
    ? (currentQuery.length > 0 
        ? hashtagData?.hashtags || []
        : popularHashtagsData?.hashtags || [])
    : (mentionData?.mentions || [])

  return (
    <div className="relative">
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        rows={4}
        className="w-full"
      />
      
      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute z-50 mt-1 w-full max-h-60 overflow-auto rounded-md border bg-ui-bg-base shadow-lg">
          <div className="p-2">
            <Text size="xsmall" className="text-ui-fg-subtle px-2 py-1">
              {suggestionType === "hashtag" 
                ? (currentQuery.length > 0 ? "Hashtag suggestions" : "Popular hashtags")
                : "Mention suggestions"}
            </Text>
            <div className="mt-1">
              {suggestions.map((item, index) => {
                const displayText = suggestionType === "hashtag" 
                  ? `#${(item as any).tag}`
                  : `@${(item as any).username}`
                const usageCount = (item as any).usage_count || 0
                const displayName = suggestionType === "mention" 
                  ? (item as any).display_name 
                  : null

                return (
                  <button
                    key={index}
                    type="button"
                    onClick={() => {
                      const value = suggestionType === "hashtag" 
                        ? (item as any).tag 
                        : (item as any).username
                      insertSuggestion(value)
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-ui-bg-base-hover rounded-md transition-colors flex items-center justify-between group"
                  >
                    <div className="flex flex-col">
                      <Text size="small" className="text-ui-fg-base">
                        {displayText}
                      </Text>
                      {displayName && (
                        <Text size="xsmall" className="text-ui-fg-subtle">
                          {displayName}
                        </Text>
                      )}
                    </div>
                    <Text size="xsmall" className="text-ui-fg-muted">
                      {usageCount} {usageCount === 1 ? "use" : "uses"}
                    </Text>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        <Text size="xsmall" className="text-ui-fg-subtle">
          💡 Type <code className="px-1 py-0.5 bg-ui-bg-subtle rounded">#</code> for hashtags or <code className="px-1 py-0.5 bg-ui-bg-subtle rounded">@</code> for mentions
        </Text>
      </div>
    </div>
  )
}

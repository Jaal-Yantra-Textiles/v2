---
title: "Hashtags & Mentions UI Implementation"
sidebar_label: "Hashtags UI"
sidebar_position: 8
---

# Hashtags & Mentions UI Implementation

## Overview
The hashtag and mention autocomplete feature has been integrated into the social post creation form, providing real-time suggestions as users type.

## Component: CaptionInputWithSuggestions

### Location
`/src/admin/components/social-posts/caption-input-with-suggestions.tsx`

### Features

1. **Real-Time Detection**
   - Detects when user types `#` for hashtags
   - Detects when user types `@` for mentions
   - Shows suggestions automatically

2. **Smart Suggestions**
   - **Hashtags**: Shows matching hashtags as you type, or popular hashtags when you just type `#`
   - **Mentions**: Shows matching usernames and display names
   - **Usage Count**: Displays how many times each hashtag/mention has been used

3. **Keyboard-Friendly**
   - Click to insert suggestion
   - Automatically adds space after insertion
   - Maintains cursor position

4. **Platform-Aware**
   - Filters suggestions based on selected platform
   - Supports: Facebook, Instagram, Twitter, or "all"

### Usage

```typescript
import { CaptionInputWithSuggestions } from "./caption-input-with-suggestions"

<CaptionInputWithSuggestions
  value={caption}
  onChange={setCaption}
  placeholder="Write your caption..."
  platform="instagram"
/>
```

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `string` | - | Current caption text |
| `onChange` | `(value: string) => void` | - | Callback when text changes |
| `placeholder` | `string` | "Write your caption..." | Placeholder text |
| `platform` | `"facebook" \| "instagram" \| "twitter" \| "all"` | "all" | Platform for filtering suggestions |
| `disabled` | `boolean` | false | Disable input |

## Integration in Create Post Form

The component has been integrated into all caption/message fields in the create social post form:

### Facebook Posts
```typescript
<CaptionInputWithSuggestions
  value={value || ""}
  onChange={onChange}
  placeholder="Say something about this post... Use # for hashtags and @ for mentions"
  platform="facebook"
/>
```

### Instagram Posts
```typescript
<CaptionInputWithSuggestions
  value={value || ""}
  onChange={onChange}
  placeholder="Write a caption... Use # for hashtags and @ for mentions"
  platform="instagram"
/>
```

### FBINSTA Posts (Both Platforms)
```typescript
<CaptionInputWithSuggestions
  value={value || ""}
  onChange={onChange}
  placeholder="Write your message (will be used for both platforms)... Use # for hashtags and @ for mentions"
  platform="all"
/>
```

## User Experience Flow

### Typing a Hashtag

1. User types `#`
2. Dropdown shows popular hashtags
3. User continues typing: `#fash`
4. Dropdown updates to show matching hashtags:
   - `#fashion` (15 uses)
   - `#fashiondesign` (8 uses)
   - `#fashionista` (3 uses)
5. User clicks on `#fashion`
6. Text is inserted: `#fashion ` (with space)
7. Cursor moves after the inserted text

### Typing a Mention

1. User types `@`
2. Dropdown shows popular mentions
3. User continues typing: `@jaal`
4. Dropdown updates to show matching mentions:
   - `@jaalyantra` - Jaal Yantra Textiles (8 uses)
5. User clicks on `@jaalyantra`
6. Text is inserted: `@jaalyantra ` (with space)
7. Cursor moves after the inserted text

## Visual Design

### Suggestion Dropdown

```
┌─────────────────────────────────────┐
│ Hashtag suggestions                 │
├─────────────────────────────────────┤
│ #fashion                    15 uses │
│ #fashiondesign               8 uses │
│ #fashionista                 3 uses │
└─────────────────────────────────────┘
```

### Mention Dropdown

```
┌─────────────────────────────────────┐
│ Mention suggestions                 │
├─────────────────────────────────────┤
│ @jaalyantra                  8 uses │
│ Jaal Yantra Textiles               │
├─────────────────────────────────────┤
│ @kashmir_crafts              5 uses │
│ Kashmir Handmade Crafts            │
└─────────────────────────────────────┘
```

### Helper Text

Below the textarea:
```
💡 Type # for hashtags or @ for mentions
```

## Technical Implementation

### State Management

```typescript
const [showSuggestions, setShowSuggestions] = useState(false)
const [suggestionType, setSuggestionType] = useState<"hashtag" | "mention" | null>(null)
const [currentQuery, setCurrentQuery] = useState("")
const [cursorPosition, setCursorPosition] = useState(0)
```

### Detection Logic

```typescript
useEffect(() => {
  const textarea = textareaRef.current
  const cursorPos = textarea.selectionStart
  const textBeforeCursor = value.substring(0, cursorPos)
  const words = textBeforeCursor.split(/\s/)
  const lastWord = words[words.length - 1]

  if (lastWord.startsWith("#")) {
    setSuggestionType("hashtag")
    setCurrentQuery(lastWord.slice(1))
    setShowSuggestions(true)
  } else if (lastWord.startsWith("@")) {
    setSuggestionType("mention")
    setCurrentQuery(lastWord.slice(1))
    setShowSuggestions(true)
  }
}, [value])
```

### Insertion Logic

```typescript
const insertSuggestion = (suggestion: string) => {
  const textBeforeCursor = value.substring(0, cursorPosition)
  const textAfterCursor = value.substring(cursorPosition)
  const words = textBeforeCursor.split(/\s/)
  const lastWord = words[words.length - 1]
  const wordStart = textBeforeCursor.length - lastWord.length
  
  const prefix = suggestionType === "hashtag" ? "#" : "@"
  const newText = 
    value.substring(0, wordStart) + 
    prefix + suggestion + 
    " " + 
    textAfterCursor

  onChange(newText)
  setShowSuggestions(false)
}
```

## Styling

The component uses Medusa UI components and Tailwind CSS:

- **Dropdown**: `absolute z-50 mt-1 w-full max-h-60 overflow-auto rounded-md border bg-ui-bg-base shadow-lg`
- **Suggestion Item**: `hover:bg-ui-bg-base-hover rounded-md transition-colors`
- **Usage Count**: `text-ui-fg-muted`

## Performance Optimizations

1. **Conditional Fetching**: Suggestions only fetched when needed
   ```typescript
   enabled: suggestionType === "hashtag" && currentQuery.length > 0
   ```

2. **React Query Caching**: Suggestions are cached automatically
3. **Debouncing**: Could be added for better performance (future enhancement)

## Future Enhancements

1. **Keyboard Navigation**: Arrow keys to navigate suggestions
2. **Emoji Picker**: Quick emoji insertion
3. **Character Counter**: Show remaining characters (Instagram: 2200, Twitter: 280)
4. **Hashtag Groups**: Save and insert groups of hashtags
5. **Smart Suggestions**: ML-based suggestions based on post content
6. **Preview**: Show how the post will look on each platform

## Testing

### Manual Testing Checklist

- [ ] Type `#` and see popular hashtags
- [ ] Type `#fash` and see matching hashtags
- [ ] Click on a hashtag and verify it's inserted correctly
- [ ] Type `@` and see popular mentions
- [ ] Type `@jaal` and see matching mentions
- [ ] Click on a mention and verify it's inserted correctly
- [ ] Verify cursor position after insertion
- [ ] Test with different platforms (Facebook, Instagram, FBINSTA)
- [ ] Verify usage counts are displayed
- [ ] Test with empty database (no suggestions)

### Example Test Cases

```typescript
describe("CaptionInputWithSuggestions", () => {
  it("should show hashtag suggestions when typing #", () => {
    // Test implementation
  })
  
  it("should show mention suggestions when typing @", () => {
    // Test implementation
  })
  
  it("should insert suggestion at cursor position", () => {
    // Test implementation
  })
  
  it("should filter suggestions by platform", () => {
    // Test implementation
  })
})
```

## Files Modified

1. `/src/admin/components/social-posts/caption-input-with-suggestions.tsx` (NEW)
   - Main autocomplete component

2. `/src/admin/components/social-posts/create-social-post-component.tsx` (UPDATED)
   - Replaced all `Input` fields for captions/messages with `CaptionInputWithSuggestions`
   - Added import for the new component
   - Updated Facebook, Instagram, and FBINSTA sections

## Related Documentation

- [Hashtags & Mentions Feature](/docs/implementation/social-publishing/hashtags-mentions)
- [Hashtags & Mentions Quick Start](/docs/reference/x-twitter/hashtags-quick-start)
- [Social Posts UI Improvements](/docs/reference/social-api/posts-ui-improvements)

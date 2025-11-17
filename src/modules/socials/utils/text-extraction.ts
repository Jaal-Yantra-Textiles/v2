/**
 * Extract hashtags from text
 * Supports both #hashtag and #️⃣hashtag formats
 */
export function extractHashtags(text: string): string[] {
  if (!text) return []
  
  // Match hashtags: # followed by alphanumeric characters and underscores
  // Supports Unicode characters for international hashtags
  const hashtagRegex = /#[\p{L}\p{N}_]+/gu
  const matches = text.match(hashtagRegex) || []
  
  // Remove # and convert to lowercase for consistency
  const hashtags = matches.map(tag => tag.slice(1).toLowerCase())
  
  // Remove duplicates
  return [...new Set(hashtags)]
}

/**
 * Extract user mentions from text
 * Supports @username format for Instagram, Facebook, and Twitter
 */
export function extractMentions(text: string): string[] {
  if (!text) return []
  
  // Match mentions: @ followed by alphanumeric characters, underscores, and dots
  // Instagram: alphanumeric, underscores, dots (max 30 chars)
  // Twitter: alphanumeric, underscores (max 15 chars)
  // Facebook: varies
  const mentionRegex = /@[\w.]+/g
  const matches = text.match(mentionRegex) || []
  
  // Remove @ symbol
  const mentions = matches.map(mention => mention.slice(1).toLowerCase())
  
  // Remove duplicates
  return [...new Set(mentions)]
}

/**
 * Extract both hashtags and mentions from text
 */
export function extractHashtagsAndMentions(text: string): {
  hashtags: string[]
  mentions: string[]
} {
  return {
    hashtags: extractHashtags(text),
    mentions: extractMentions(text),
  }
}

/**
 * Validate hashtag format
 */
export function isValidHashtag(tag: string): boolean {
  // Remove # if present
  const cleanTag = tag.startsWith('#') ? tag.slice(1) : tag
  
  // Must be 1-100 characters
  if (cleanTag.length < 1 || cleanTag.length > 100) return false
  
  // Must contain only alphanumeric, underscores, and Unicode letters/numbers
  const validPattern = /^[\p{L}\p{N}_]+$/u
  return validPattern.test(cleanTag)
}

/**
 * Validate mention format for a specific platform
 */
export function isValidMention(username: string, platform: 'instagram' | 'twitter' | 'facebook'): boolean {
  // Remove @ if present
  const cleanUsername = username.startsWith('@') ? username.slice(1) : username
  
  switch (platform) {
    case 'instagram':
      // Instagram: 1-30 characters, alphanumeric, underscores, dots
      // Cannot start or end with a dot, cannot have consecutive dots
      if (cleanUsername.length < 1 || cleanUsername.length > 30) return false
      if (cleanUsername.startsWith('.') || cleanUsername.endsWith('.')) return false
      if (cleanUsername.includes('..')) return false
      return /^[\w.]+$/.test(cleanUsername)
      
    case 'twitter':
      // Twitter: 1-15 characters, alphanumeric and underscores only
      if (cleanUsername.length < 1 || cleanUsername.length > 15) return false
      return /^\w+$/.test(cleanUsername)
      
    case 'facebook':
      // Facebook: 5-50 characters, alphanumeric, dots, underscores
      if (cleanUsername.length < 5 || cleanUsername.length > 50) return false
      return /^[\w.]+$/.test(cleanUsername)
      
    default:
      return false
  }
}

/**
 * Format hashtag for display (with #)
 */
export function formatHashtag(tag: string): string {
  const cleanTag = tag.startsWith('#') ? tag.slice(1) : tag
  return `#${cleanTag}`
}

/**
 * Format mention for display (with @)
 */
export function formatMention(username: string): string {
  const cleanUsername = username.startsWith('@') ? username.slice(1) : username
  return `@${cleanUsername}`
}

/**
 * Get hashtag suggestions based on partial input
 */
export function getHashtagSuggestions(
  input: string,
  existingHashtags: string[],
  limit: number = 10
): string[] {
  if (!input) return []
  
  const cleanInput = input.startsWith('#') ? input.slice(1).toLowerCase() : input.toLowerCase()
  
  return existingHashtags
    .filter(tag => tag.toLowerCase().startsWith(cleanInput))
    .slice(0, limit)
}

/**
 * Get mention suggestions based on partial input
 */
export function getMentionSuggestions(
  input: string,
  existingMentions: Array<{ username: string; display_name?: string }>,
  limit: number = 10
): Array<{ username: string; display_name?: string }> {
  if (!input) return []
  
  const cleanInput = input.startsWith('@') ? input.slice(1).toLowerCase() : input.toLowerCase()
  
  return existingMentions
    .filter(mention => 
      mention.username.toLowerCase().startsWith(cleanInput) ||
      mention.display_name?.toLowerCase().includes(cleanInput)
    )
    .slice(0, limit)
}

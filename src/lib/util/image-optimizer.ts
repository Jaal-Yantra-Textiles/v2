// Vercel's image optimizer returns 400 for source URLs whose path contains
// encoded spaces (e.g. S3 keys that came from filenames like "WhatsApp
// Image 2026-04-21.jpeg"). The upstream image is fine — only the optimizer
// rejects it — so we bypass optimization for these specific URLs.
//
// Long-term fix lives at upload time (sanitize S3 keys), but until then
// every <Image> rendering a remote URL should pass `unoptimized={isUnoptimizableImageUrl(src)}`.
export const isUnoptimizableImageUrl = (src?: string | null): boolean => {
  if (!src) return false
  return src.includes("%20") || src.includes(" ")
}

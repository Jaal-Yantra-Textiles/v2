// Sanitize a user-supplied filename so it produces a safe S3 key.
//
// Background: filenames coming from sources like WhatsApp ("WhatsApp Image
// 2026-04-21 at 10.08.28 PM.jpeg") have spaces and other characters that
// become percent-encoded in the resulting URL. Vercel's image optimizer
// then 400s on `/_next/image?url=…%20…` even though the upstream serves
// the file fine. The multipart-upload routes already sanitize at the
// edge — this helper exists so the direct upload path can match.
//
// Output shape: `<safeBase>.<safeExt>` (or just `<safeBase>` when there
// is no extension). Both pieces are restricted to [a-zA-Z0-9-_] to keep
// the resulting URL safe in any path / query context.
export function sanitizeFilename(name: string): string {
  if (!name) return name
  const dot = name.lastIndexOf(".")
  if (dot <= 0) {
    return name.replace(/[^a-zA-Z0-9-_]+/g, "_")
  }
  const base = name.slice(0, dot).replace(/[^a-zA-Z0-9-_]+/g, "_")
  const ext = name.slice(dot + 1).replace(/[^a-zA-Z0-9]+/g, "")
  return ext ? `${base}.${ext}` : base
}

/**
 * Turn a moodboard scene's remote image URLs into real `data:` URIs (#2228).
 *
 * The scene stores image files as `files[id].dataURL = "https://…"` — a URL in
 * the field Excalidraw expects to hold a `data:` URI. Excalidraw then sets that
 * as an `<img>` src, which fails two different ways:
 *
 *   - here in partner-ui the image does not render at all — a generated board
 *     shows Excalidraw's broken-image placeholder where the flats should be;
 *   - in the admin it renders, and a cross-origin image TAINTS the canvas, so
 *     `toBlob` is refused and the export dies with "The operation is insecure".
 *
 * A `data:` URI needs no CORS and never taints, so it fixes rendering and
 * export together.
 *
 * 🔴 Fetched through OUR API, not directly. The CDN sends no
 * `Access-Control-Allow-Origin`, so a browser fetch of the image URL is blocked
 * before it starts; the proxy route is same-API-origin and already carries the
 * partner CORS headers.
 */

/** A file entry as the scene stores it — only `dataURL` matters here. */
type SceneFile = { dataURL?: string; [k: string]: any }

const isRemote = (v: unknown): v is string =>
  typeof v === "string" && /^https?:\/\//i.test(v)

/**
 * Replace every remote file URL with its inlined form.
 *
 * ⚠️ Best-effort by design. A file that cannot be inlined — the host is not on
 * the allow-list, the proxy is down, the image is too big — keeps its original
 * URL, so the board renders exactly as badly as it did before rather than
 * losing the element entirely. Callers get `failed` so they can say so once
 * instead of the canvas silently disagreeing with the export.
 */
export const inlineMoodboardImages = async <T extends SceneFile>(
  files: Record<string, T> | undefined | null,
  fetchDataUrl: (src: string) => Promise<string>
): Promise<{ files: Record<string, T>; inlined: number; failed: number }> => {
  const out: Record<string, T> = { ...(files ?? {}) }
  const remote = Object.entries(out).filter(([, f]) => isRemote(f?.dataURL))

  if (!remote.length) {
    return { files: out, inlined: 0, failed: 0 }
  }

  /**
   * One request per DISTINCT url, not per file. The tech-pack frame registers
   * the front and back flat separately, and a design whose two flats are the
   * same image would otherwise fetch it twice.
   */
  const byUrl = new Map<string, Promise<string | null>>()
  const get = (src: string) => {
    if (!byUrl.has(src)) {
      byUrl.set(
        src,
        fetchDataUrl(src).catch(() => null)
      )
    }
    return byUrl.get(src)!
  }

  let inlined = 0
  let failed = 0
  await Promise.all(
    remote.map(async ([id, file]) => {
      const dataUrl = await get(file.dataURL as string)
      if (dataUrl) {
        out[id] = { ...file, dataURL: dataUrl }
        inlined++
      } else {
        failed++
      }
    })
  )

  return { files: out, inlined, failed }
}

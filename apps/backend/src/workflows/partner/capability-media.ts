/**
 * Attach renderable `media` to capability-sample rows.
 *
 * The row stores `media_file` ids, and an id is not a URL: nothing turning one
 * into the other on the read path is how the partner surface shipped a
 * write-only library (see `resolveMediaFiles` in src/api/partners/media-urls.ts,
 * which exists for exactly that failure).
 *
 * Shared by the list and create capability workflows so both return the SAME
 * shape — two shapes for one row is how a `media` key ends up read as
 * `media_files` on one screen and silently renders nothing.
 */
import { resolveMediaFiles } from "../../api/partners/media-urls"

export const attachCapabilityMedia = async (
  container: any,
  samples: any[]
): Promise<any[]> =>
  Promise.all(
    samples.map(async (s) => ({
      ...s,
      media: await resolveMediaFiles(
        container,
        Array.isArray(s?.media_file_ids) ? s.media_file_ids : []
      ),
    }))
  )

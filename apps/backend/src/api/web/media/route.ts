import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";
import { listAllMediasWorkflow } from "../../../workflows/media/list-all-medias";
import { listAlbumMediaWorkflow } from "../../../workflows/media/list-album-media";

/**
 * Public endpoint to list media files
 * GET /web/media
 *
 * Query parameters:
 * - limit: number (default: 20, max: 100)
 * - random: boolean (default: true) - randomize the order
 * - type: string - filter by media type (image, video, etc.)
 * - album_id: string - return only public media that belong to this album
 *   (walks AlbumMedia → MediaFile and filters by is_public on the file).
 */
export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  try {
    const query = (req.query || {}) as Record<string, any>;
    
    // Parse query parameters
    const limit = Math.min(Number(query.limit) || 20, 100); // Max 100 items
    const random = query.random !== "false"; // Default true
    const type = query.type || undefined;
    const offset = Math.max(Number(query.offset) || 0, 0);
    const seed = typeof query.seed === "string" && query.seed.length ? query.seed : undefined;
    const albumId =
      typeof query.album_id === "string" && query.album_id.length
        ? query.album_id
        : undefined;

    const mulberry32 = (a: number) => {
      return () => {
        let t = (a += 0x6d2b79f5)
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
      }
    }

    const seedToInt = (value: string) => {
      let h = 2166136261
      for (let i = 0; i < value.length; i++) {
        h ^= value.charCodeAt(i)
        h = Math.imul(h, 16777619)
      }
      return h >>> 0
    }

    const shuffleInPlace = <T,>(arr: T[], rand: () => number) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1))
        ;[arr[i], arr[j]] = [arr[j], arr[i]]
      }
      return arr
    }
    
    // Build filters - only public media
    const filters: Record<string, any> = {
      is_public: true,
    };

    // Add type filter if provided
    if (type) {
      filters.type = type;
    }

    let mediaFiles: any[] = []

    if (albumId) {
      // Album-scoped path: walk the AlbumMedia join. We over-fetch
      // (album_media rows × 3) when random=true so the post-shuffle
      // slice still has enough variety, then materialise each row's
      // .media into the same shape as the all-media path.
      const { result } = await listAlbumMediaWorkflow(req.scope).run({
        input: {
          filters: { album: albumId } as any,
          config: {
            take: random ? Math.min((offset + limit) * 3, 500) : limit,
            skip: random ? 0 : offset,
            relations: ["media"],
          },
        },
      });
      const rows = (result as any)?.[0] ?? [];
      mediaFiles = rows
        .map((r: any) => r?.media)
        .filter((m: any) => m && (m.is_public !== false))
        .filter((m: any) => !type || m.file_type === type);
    } else {
      const { result } = await listAllMediasWorkflow(req.scope).run({
        input: {
          filters,
          config: {
            take: random ? Math.min((offset + limit) * 3, 500) : limit,
            skip: random ? 0 : offset,
          },
        },
      });
      mediaFiles = result.media_files || [];
    }
    
    // Randomize if requested
    if (random && mediaFiles.length > 0) {
      const rand = seed ? mulberry32(seedToInt(seed)) : Math.random
      mediaFiles = shuffleInPlace([...mediaFiles], rand).slice(offset, offset + limit);
    } else {
      mediaFiles = mediaFiles.slice(offset, offset + limit);
    }
    
    // Return sanitized public data
    const publicMediaData = mediaFiles.map((media: any) => ({
      id: media.id,
      filename: media.original_name || media.file_name,
      filename_disk: media.file_name, // This is the actual stored filename
      file_path: media.file_path,
      type: media.file_type, // 'image', 'video', 'audio', etc.
      mime_type: media.mime_type,
      filesize: media.file_size,
      width: media.width,
      height: media.height,
      title: media.title,
      description: media.description,
      alt_text: media.alt_text,
      caption: media.caption,
      // Note: URL construction should be done on frontend using NEXT_PUBLIC_AWS_S3 + file_path
    }));
    
    res.status(200).json({
      medias: publicMediaData,
      count: publicMediaData.length,
      total: publicMediaData.length,
    });
  } catch (error) {
    console.error("Error fetching public media:", error);
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "Failed to fetch public media"
    );
  }
};

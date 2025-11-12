import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";
import { listAllMediasWorkflow } from "../../../workflows/media/list-all-medias";

/**
 * Public endpoint to list media files
 * GET /web/media
 * 
 * Query parameters:
 * - limit: number (default: 20, max: 100)
 * - random: boolean (default: true) - randomize the order
 * - type: string - filter by media type (image, video, etc.)
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
    
    // Build filters - only public media
    const filters: Record<string, any> = {
      is_public: true,
    };
    
    // Add type filter if provided
    if (type) {
      filters.type = type;
    }
  
    // Fetch media from workflow
    const { result } = await listAllMediasWorkflow(req.scope).run({
      input: {
        filters,
        config: {
          take: random ? limit * 3 : limit, // Fetch more if randomizing
          skip: 0,
        },
      },
    });
    
    // media_files already contains only media files (not folders or albums)
    let mediaFiles = result.media_files || [];
    
    // Randomize if requested
    if (random && mediaFiles.length > 0) {
      mediaFiles = mediaFiles
        .sort(() => Math.random() - 0.5)
        .slice(0, limit);
    } else {
      mediaFiles = mediaFiles.slice(0, limit);
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
      total: result.media_files_count || result.media_files?.length || 0,
    });
  } catch (error) {
    console.error("Error fetching public media:", error);
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "Failed to fetch public media"
    );
  }
};

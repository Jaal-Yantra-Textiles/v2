import {
  createWorkflow,
  WorkflowResponse,
  transform,
} from "@medusajs/framework/workflows-sdk";
import { listFolderWorkflow } from "./list-folder";
import { listAlbumWorkflow } from "./list-album";
import { listMediaFileWorkflow } from "./list-media-file";
import { listAlbumMediaWorkflow } from "./list-album-media";

export type ListAllMediasInput = {
  filters?: Record<string, any>;
  config?: {
    skip?: number;
    take?: number;
    select?: string[];
    relations?: string[];
  };
};

// Scope filters AND sort keys to fields that actually exist on the target
// entity. MikroORM throws a 400 when asked to filter/order by a missing
// column — so the partner API would surface that as `Failed to list media
// entities`. Dropping unknown keys here lets cross-entity sort values
// (e.g. `file_name:asc` picked while viewing Files) degrade to the entity's
// default order rather than blowing up the whole multi-entity response.
const pickAllowed = <T extends Record<string, any>>(
  obj: T | undefined,
  allowed: Set<string>,
): Record<string, any> => {
  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(obj || {})) {
    if (allowed.has(k)) out[k] = v
  }
  return out
}

const scopeConfig = (
  config: Record<string, any> | undefined,
  allowed: Set<string>,
): Record<string, any> | undefined => {
  if (!config) return config
  const next = { ...config }
  if (next.order !== undefined) {
    if (typeof next.order === "string") {
      // Leave string-form orders to the API route's normalizer; but scrub
      // any key-based string that points at a missing column.
      const raw = next.order.trim()
      const field = raw.startsWith("-")
        ? raw.slice(1)
        : raw.includes(":")
          ? raw.split(":")[0]
          : raw
      if (!allowed.has(field)) {
        delete next.order
      }
    } else if (typeof next.order === "object" && next.order !== null) {
      const scoped = pickAllowed(next.order, allowed)
      if (Object.keys(scoped).length === 0) {
        delete next.order
      } else {
        next.order = scoped
      }
    }
  }
  return next
}

export const listAllMediasWorkflow = createWorkflow(
  "list-all-medias",
  (input: ListAllMediasInput) => {
    // Derive per-entity filters to avoid querying by non-existent fields
    const foldersRes = listFolderWorkflow.runAsStep({
      input: transform({ input }, (data) => {
        // Whitelist only fields that exist on Folder
        const allowedKeys = new Set(["id", "name", "slug", "description", "path", "level", "sort_order", "is_public", "parent_folder_id", "metadata", "created_at", "updated_at"])
        return {
          // `q` is a free-text search key (not a column) — Folder.name is
          // searchable, so keep it for filtering but NOT for order scoping.
          filters: pickAllowed(data.input.filters, new Set([...allowedKeys, "q"])),
          config: scopeConfig(data.input.config, allowedKeys),
        }
      }),
    });

    const albumsRes = listAlbumWorkflow.runAsStep({
      input: transform({ input }, (data) => {
        // Whitelist only fields that exist on Album
        const allowedKeys = new Set(["id", "name", "description", "slug", "is_public", "sort_order", "type", "metadata", "cover_media_id", "created_at", "updated_at"])
        return {
          // Album.name is searchable — keep `q` for filtering, not ordering.
          filters: pickAllowed(data.input.filters, new Set([...allowedKeys, "q"])),
          config: scopeConfig(data.input.config, allowedKeys),
        }
      }),
    });

    const mediaFilesRes = listMediaFileWorkflow.runAsStep({
      input: transform({ input }, (data) => {
        // Whitelist only fields that exist on MediaFile
        const allowedKeys = new Set([
          "id", "file_name", "original_name", "file_path", "file_size", "file_hash",
          "file_type", "mime_type", "extension", "width", "height", "duration",
          "title", "description", "alt_text", "caption", "folder_path", "tags",
          "is_public", "metadata", "folder_id", "created_at", "updated_at"
        ])
        return {
          // MediaFile.file_name is searchable — keep `q` for filtering, not ordering.
          filters: pickAllowed(data.input.filters, new Set([...allowedKeys, "q"])),
          config: scopeConfig(data.input.config, allowedKeys),
        }
      }),
    });

    const albumMediaRes = listAlbumMediaWorkflow.runAsStep({
      input: transform({ input }, (data) => {
        // Whitelist only fields that exist on AlbumMedia (relations by FK supported via Medusa service)
        const allowedKeys = new Set(["sort_order", "title", "description", "album", "media", "created_at", "updated_at"])
        return {
          filters: pickAllowed(data.input.filters, allowedKeys),
          config: scopeConfig(data.input.config, allowedKeys),
        }
      }),
    });

    const result = transform(
      { foldersRes, albumsRes, mediaFilesRes, albumMediaRes },
      (data) => {
        const [folders = [], folders_count = 0] = (data.foldersRes as any) || [];
        const [albums = [], albums_count = 0] = (data.albumsRes as any) || [];
        const [media_files = [], media_files_count = 0] = (data.mediaFilesRes as any) || [];
        const [album_media = [], album_media_count = 0] = (data.albumMediaRes as any) || [];

        return {
          folders,
          folders_count,
          albums,
          albums_count,
          media_files,
          media_files_count,
          album_media,
          album_media_count,
        };
      }
    );

    return new WorkflowResponse(result);
  }
);

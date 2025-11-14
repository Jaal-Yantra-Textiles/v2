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

export const listAllMediasWorkflow = createWorkflow(
  "list-all-medias",
  (input: ListAllMediasInput) => {
    // Derive per-entity filters to avoid querying by non-existent fields
    const foldersRes = listFolderWorkflow.runAsStep({
      input: transform({ input }, (data) => {
        const raw = { ...(data.input.filters || {}) }
        // Whitelist only fields that exist on Folder
        const allowedKeys = new Set(["id", "name", "slug", "description", "path", "level", "sort_order", "is_public", "parent_folder_id", "metadata"])
        const filtered: Record<string, any> = {}
        for (const [k, v] of Object.entries(raw)) {
          if (allowedKeys.has(k)) filtered[k] = v
        }
        return {
          filters: filtered,
          config: data.input.config,
        }
      }),
    });

    const albumsRes = listAlbumWorkflow.runAsStep({
      input: transform({ input }, (data) => {
        const raw = { ...(data.input.filters || {}) }
        // Whitelist only fields that exist on Album
        const allowedKeys = new Set(["id", "name", "description", "slug", "is_public", "sort_order", "type", "metadata", "cover_media_id"])
        const filtered: Record<string, any> = {}
        for (const [k, v] of Object.entries(raw)) {
          if (allowedKeys.has(k)) filtered[k] = v
        }
        return {
          filters: filtered,
          config: data.input.config,
        }
      }),
    });

    const mediaFilesRes = listMediaFileWorkflow.runAsStep({
      input: transform({ input }, (data) => {
        const raw = { ...(data.input.filters || {}) }
        // Whitelist only fields that exist on MediaFile
        const allowedKeys = new Set([
          "id", "file_name", "original_name", "file_path", "file_size", "file_hash",
          "file_type", "mime_type", "extension", "width", "height", "duration",
          "title", "description", "alt_text", "caption", "folder_path", "tags",
          "is_public", "metadata", "folder_id", "created_at", "updated_at"
        ])
        const filtered: Record<string, any> = {}
        for (const [k, v] of Object.entries(raw)) {
          if (allowedKeys.has(k)) filtered[k] = v
        }
        return {
          filters: filtered,
          config: data.input.config,
        }
      }),
    });

    const albumMediaRes = listAlbumMediaWorkflow.runAsStep({
      input: transform({ input }, (data) => {
        const raw = { ...(data.input.filters || {}) }
        // Whitelist only fields that exist on AlbumMedia
        const allowedKeys = new Set(["sort_order", "title", "description", "album", "media"]) // relations by FK supported via Medusa service
        const filtered: Record<string, any> = {}
        for (const [k, v] of Object.entries(raw)) {
          if (allowedKeys.has(k)) filtered[k] = v
        }
        return {
          filters: filtered,
          config: data.input.config,
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

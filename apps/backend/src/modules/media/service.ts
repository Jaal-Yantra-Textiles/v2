import Album from "./models/album";
import MediaFile from "./models/media_file";
import AlbumMedia from "./models/album-media";
import Folder from "./models/folder";
import MediaComment from "./models/media-comment";
import { MedusaService } from "@medusajs/framework/utils";

class MediaService extends MedusaService({
  Album,
  MediaFile,
  AlbumMedia,
  Folder,
  MediaComment,
}) {
  constructor() {
    super(...arguments)
  }
}

export default MediaService;

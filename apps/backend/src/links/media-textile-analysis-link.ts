import { defineLink } from "@medusajs/framework/utils"

import MediaModule from "../modules/media"
import TextileAnalysisModule from "../modules/textile-analysis"

/**
 * A media file and what a vision model saw in it.
 *
 * `isList` on the analysis side: one image can be analysed more than once — by
 * the internal extractor and by the storefront reference path, or again by a
 * newer model later. That is a row per analysis, which is precisely what
 * columns on `MediaFile` could never have expressed.
 *
 * ⚠️ The table name is declared. Medusa derives link tables from both module
 * names, and `media_file_textile_analysis_textile_analysis` style derivations
 * have already blown past Postgres's 63-character identifier limit in this
 * codebase once — the payout-submission link, where the join was simply
 * untraversable until the name was pinned.
 */
export default defineLink(
  {
    linkable: MediaModule.linkable.mediaFile,
    isList: false,
    filterable: ["id", "file_name", "file_type", "folder_path"],
  },
  {
    linkable: TextileAnalysisModule.linkable.textileAnalysis,
    isList: true,
    filterable: ["id", "source", "cloth_type", "pattern", "fabric_weight", "primary_color"],
  },
  {
    database: {
      table: "media_file_textile_analysis",
    },
  }
)

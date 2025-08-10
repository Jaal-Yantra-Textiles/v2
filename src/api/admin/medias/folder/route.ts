import {
    MedusaRequest,
    MedusaResponse,
  } from "@medusajs/framework/http";
  import { MedusaError } from "@medusajs/framework/utils";
  import { createFolderWorkflow } from "../../../../workflows/media/create-folder";
import { FolderRequest } from "../validator";
import { getFolderWorkflow } from "../../../../workflows/media/get-folder";

  
  export const POST = async (
    req: MedusaRequest<FolderRequest>,
    res: MedusaResponse
  ) => {
    const folderData = req.validatedBody;
  
    try {
      // Run the create folder workflow
      const slug = folderData.name.toLowerCase().replace(/\s+/g, "-")
      const { result, errors } = await createFolderWorkflow(req.scope).run({
        input: {
          ...folderData,
          // Generate slug from name
          slug,
          default_sort_order: 0,
          // Respect provided is_public, otherwise default to true
          default_is_public: typeof folderData.is_public === "boolean" ? folderData.is_public : true,
          // Seed path/level; workflow recalculates when parent_folder_id is present
          path: `/${slug}`,
          level: 0,
        },
      });
  
      if (errors.length > 0) {
        console.error("Errors occurred during folder creation:", errors);
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          `Failed to create folder: ${errors.map(e => e.error?.message || "Unknown error").join(", ")}`
        );
      }
  
      res.status(201).json({
        message: "Folder created successfully",
        folder: result,
      });
    } catch (error) {
      console.error("Error creating folder:", error);
      throw error;
    }
  };
  
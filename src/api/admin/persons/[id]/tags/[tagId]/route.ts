import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { TagAllowedFields } from "../helpers";
import deletePersonTagsWorkflow from "../../../../../../workflows/persons/delete-person-tags";
import { DeleteTagForPerson } from "../validators";

export const DELETE = async (
    req: MedusaRequest<DeleteTagForPerson> & {
      remoteQueryConfig?: {
        fields?: TagAllowedFields[];
      };
    },
    res: MedusaResponse,
  ) => {
  
    const personId = req.params.id;
    const tagId = req.params.tagId;
    try {
      const { result, errors } = await deletePersonTagsWorkflow.run({
        input: {
          person_id: personId,
          id: tagId
        },
      });
  
      if (errors.length > 0) {
        console.warn("Error reported at", errors);
        throw errors;
      }
  
      res.status(204).json({ tags: result, deleted: true });
    } catch (error) {
      throw error;
    }
  };
import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { listRawMaterialCategoriesWorkflow } from "../../../../workflows/raw-materials/list-raw-material-category";
import { CreateMaterialTypeType, ReadRawMaterialCategoriesType } from "./validators";
import { createRawMaterialCategoryWorkflow } from "../../../../workflows/raw-materials/create-raw-material-category";

export const GET = async (
  req: MedusaRequest<{}, ReadRawMaterialCategoriesType>,
  res: MedusaResponse
) => {
  try {
    // Extract validated query parameters 
    const { filters = {}, config = {}, page = 1, limit = 10 } = req.validatedQuery;

    // Transform pagination params to match the workflow input format
    const skip = (page - 1) * limit;
    
    // Call the workflow with properly formatted input
    const { result, errors } = await listRawMaterialCategoriesWorkflow(req.scope).run({
      input: {
        filters,
        config: {
          ...config,
          skip,
          take: limit
        }
      },
    });


    if (errors && errors.length > 0) {
      console.warn("Error reported at", errors);
      throw errors;
    }

    const { categories, count } = result;

    // Return the result with pagination metadata
    res.status(200).json({
      categories,
      count,
      page,
      limit,
      offset: skip,
      // Add pagination metadata
      pagination: {
        page,
        pageCount: Math.ceil(count / limit),
        pageSize: limit,
        numItems: count
      }
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};


export const POST = async (
  req: MedusaRequest<CreateMaterialTypeType>,
  res: MedusaResponse
) => {


  const { result, errors } = await createRawMaterialCategoryWorkflow(req.scope).run({
    input: {
      ...req.validatedBody
    },
  });

  if (errors && errors.length > 0) {
    console.warn("Error reported at", errors);
    return res.status(400).json({ error: errors[0] });
  }

  res.status(200).json(result);
};

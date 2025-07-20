import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { createStoresWorkflow } from "@medusajs/medusa/core-flows";
import { CreateStoreRequest } from "./validators";



// POST /admin/stores - Create a new store
export async function POST(
  req: MedusaRequest<CreateStoreRequest>,
  res: MedusaResponse
) {
  const storeData = req.validatedBody;

    // Use the createStoresWorkflow to create the store
    const { result } = await createStoresWorkflow(req.scope).run({
      input: {
        stores: [storeData]
      }
    });

    const createdStore = result[0];

    res.status(201).json({
      store: createdStore,
      message: "Store created successfully"
    });
}

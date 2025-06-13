import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { fetchAllCategoriesPerSiteWorkflow } from "../../../../../../workflows/website/website-page/fetch-all-categories-per-site";

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { id: websiteId } = req.params; // id here is the websiteId

  if (!websiteId) {
    return res.status(400).json({ message: "Website ID is required" });
  }

  try {
    const workflow = fetchAllCategoriesPerSiteWorkflow(req.scope);
    const { result: categories } = await workflow.run({
      input: { websiteId: websiteId }, // Pass websiteId to the workflow
    });

    return res.status(200).json({ categories });
  } catch (error) {
    console.error("Error fetching blog categories by website ID:", error);
    // Consider more specific error handling based on workflow errors
    return res.status(500).json({ message: "Internal server error" });
  }
}

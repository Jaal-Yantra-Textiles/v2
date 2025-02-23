

import { Design } from "./validators";
import { MedusaContainer } from "@medusajs/framework";

export type DesignAllowedFields = "*" | keyof Design;

export const refetchDesign = async (
  designId: string,
  container: MedusaContainer,
  fields: DesignAllowedFields[] = ["*"]
) => {
  console.log(fields)
  const query = container.resolve("query")
  const { data: design } = await query.graph({
    entity: "designs",
    filters: {
      id: designId
    },
    fields: fields
  })

  return design[0]
};

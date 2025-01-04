import { MedusaContainer } from "@medusajs/framework/types";
import { refetchEntity } from "@medusajs/framework";
import { MedusaError } from "@medusajs/framework/utils";

export const refetchPersonType = async (
  personTypeId: string | string[],
  container: MedusaContainer
): Promise<void> => {
  const ids = Array.isArray(personTypeId) ? personTypeId : [personTypeId];

  for (const id of ids) {
    const exists = await refetchEntity(
      "person_type",
      id,
      container,
      ["id"]
    );

    if (!exists) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `PersonType with id "${id}" not found`
      );
    }
  }
}

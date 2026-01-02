import { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { FORMS_MODULE } from "../../../modules/forms"

export type FormAllowedFields = string[]

export const refetchForm = async (
  id: string,
  scope: MedusaContainer,
  fields: FormAllowedFields = ["*", "fields.*"]
) => {
  const query = scope.resolve(FORMS_MODULE)
  
  const forms = await query.retrieveForm(id, {
    relations: ['fields']
  })

  if (!forms) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      'Form with id "' + id + '" not found'
    )
  }

  return forms
}

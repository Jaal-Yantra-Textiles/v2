import {
  WorkflowData,
  WorkflowResponse,
  createWorkflow,
  createStep,
  StepResponse,
} from "@medusajs/framework/workflows-sdk"
import { GroupPersonsForBatchStepOutput } from "../steps/group-persons-for-batch"
import { PERSON_MODULE } from "../../../../modules/person"
import { PERSON_TYPE_MODULE } from "../../../../modules/persontype"
import PersonService from "../../../../modules/person/service"
import PersonTypeService from "../../../../modules/persontype/service"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { LinkDefinition } from "@medusajs/framework/types"

export const batchPersonsWorkflowId = "batch-persons"
/**
 * This workflow creates and updates persons in batch.
 * 
 * @example
 * const result = await batchPersonsWorkflow(container).run({
 *   input: {
 *     create: [
 *       {
 *         first_name: "Jane",
 *         last_name: "Doe",
 *         email: "jane@example.com",
 *       }
 *     ],
 *     update: [
 *       {
 *         id: "per_123",
 *         first_name: "John",
 *         last_name: "Smith",
 *       }
 *     ]
 *   }
 * })
 */


export const batchPersonsStep = createStep(
  "batch-persons-step",
  async (input: GroupPersonsForBatchStepOutput, { container }) => {
    const personService: PersonService = container.resolve(PERSON_MODULE)
    
    // Process person creations
    const createPromises = input.create.map(async (personData) => {
      try {
        const person = await personService.createPeople(personData)
        
        // Process related entities if needed
        if (personData.addresses?.length) {
          for (const addressData of personData.addresses) {
            await personService.createAddresses({
              ...addressData,
              person_id: person.id,
            })
          }
        }
        
        if (personData.contact_details?.length) {
          for (const contactData of personData.contact_details) {
            await personService.createContactDetails({
              ...contactData,
              person_id: person.id,
            })
          }
        }
        
        if (personData.tags?.length) {
          for (const tagData of personData.tags) {
            if (tagData.id || tagData.value) {
              // Create new tag and link to person
              await personService.createTags({
                name: tagData.value || "Imported tag",
                person_id: person.id,
              })
            }
          }
        }
        
        if (personData.person_types?.length) {
          // Fetch all person types to get their IDs
          const personTypeService = container.resolve(PERSON_TYPE_MODULE) as PersonTypeService
          
          // Extract all the type names from personData.person_types
          const typeNames = personData.person_types
            .map(type => typeof type === 'string' ? type : (type.name || ''))
            .filter(name => name) // Remove empty names
          
          // Fetch person types with names in our list
          const [existingTypes] = await personTypeService.listAndCountPersonTypes({
            name: {
              in: typeNames
            }
          })
          
          // Create a map of type name to ID for easy lookup
          const typeNameToIdMap = new Map(
            existingTypes.map(type => [type.name.toLowerCase(), type.id])
          )
          
          // Use the link service for person types
          const remoteLink = container.resolve(ContainerRegistrationKeys.LINK)
          const links: LinkDefinition[] = []
          
          for (const typeData of personData.person_types) {
            // Handle different formats of person type data
            let typeId: string | undefined = undefined;
            let typeName: string | undefined = undefined;
            
            // Case 1: Type data is a string (just the type name)
            if (typeof typeData === 'string') {
              typeName = typeData;
              typeId = typeData ? typeNameToIdMap.get(typeData.toLowerCase()) : undefined;
            }
            // Case 2: Type data is an object with id
            else if (typeData && typeData.id) {
              typeId = typeData.id;
            }
            // Case 3: Type data is an object with name
            else if (typeData && typeData.name) {
              typeName = typeData.name;
              typeId = typeName ? typeNameToIdMap.get(typeName.toLowerCase()) : undefined;
            }
            
            // If we found a valid type ID, create the link
            if (typeId) {
              links.push({
                [PERSON_MODULE]: {
                  person_id: person.id
                },
                [PERSON_TYPE_MODULE]: {
                  person_type_id: typeId
                },
                data: {
                  person_id: person.id,
                  person_type_id: typeId
                }
              });
            } else if (typeName) {
              // Log that we couldn't find this person type
              console.log(`Warning: Could not find person type with name '${typeName}'`);
            }
          }
          
          if (links.length > 0) {
            await remoteLink.create(links as LinkDefinition[])
          }
        }
        
        return { success: true, id: person.id }
      } catch (error) {
        return { 
          success: false, 
          error: error.message,
          data: personData,
        }
      }
    })
    
    // Process person updates
    const updatePromises = input.update.map(async (personData) => {
      try {
        const { id, ...updateData } = personData
        
        // Use appropriate selector for updating people
        await personService.updatePeople({
          selector: { id: id },
          data: updateData
        })
        
        // Process related entities if needed
        if (personData.addresses?.length) {
          // Find all addresses for this person
          const existingAddresses = await personService.listAddresses({ person_id: id })
          
          // Delete each address individually
          for (const address of existingAddresses) {
            await personService.deleteAddresses(address.id)
          }
          
          // Add new addresses
          for (const addressData of personData.addresses) {
            await personService.createAddresses({
              ...addressData,
              person_id: id,
            })
          }
        }
        
        if (personData.contact_details?.length) {
          // First find all contact details for this person
          const existingContacts = await personService.listContactDetails({ person_id: id })
          
          // Delete each contact individually
          for (const contact of existingContacts) {
            await personService.deleteContactDetails(contact.id)
          }
          
          // Add new contact details
          for (const contactData of personData.contact_details) {
            await personService.createContactDetails({
              ...contactData,
              person_id: id,
            })
          }
        }
        
        if (personData.tags?.length) {
          // First find all tags for this person
          const existingTags = await personService.listTags({ person_id: id })
          
          // Delete each tag individually
          for (const tag of existingTags) {
            await personService.deleteTags(tag.id)
          }
          
          // Add new tags
          for (const tagData of personData.tags) {
            if (tagData.value) {
              // Create new tag and link to person
              await personService.createTags({
                name: tagData.value,
                person_id: id,
              })
            }
          }
        }

        if (personData.person_types?.length) {
          // Use the link service for person types as shown in associate-person-types workflow
          const remoteLink = container.resolve(ContainerRegistrationKeys.LINK)
          
          // First, get all existing links for this person
          const existingLinks = await remoteLink.list({
            selector: {
              [PERSON_MODULE]: {
                person_id: id
              }
            }
          })
          
          // Delete all existing links
          for (const link of existingLinks) {
            await remoteLink.dismiss(link as any)
          }
          
          // Create new links
          const links: LinkDefinition[] = []
          for (const typeData of personData.person_types) {
            if (typeData.id) {
              links.push({
                [PERSON_MODULE]: {
                  person_id: id
                },
                [PERSON_TYPE_MODULE]: {
                  person_type_id: typeData.id
                },
                data: {
                  person_id: id,
                  person_type_id: typeData.id
                }
              })
            }
          }
          
          if (links.length > 0) {
            await remoteLink.create(links as LinkDefinition[])
          }
        }
        
        return { success: true, id }
      } catch (error) {
        return { 
          success: false, 
          error: error.message,
          data: personData,
        }
      }
    })
    
    const [createdResults, updatedResults] = await Promise.all([
      Promise.all(createPromises),
      Promise.all(updatePromises),
    ])
    
    return new StepResponse({
      created: createdResults,
      updated: updatedResults,
      stats: {
        created: createdResults.filter(r => r.success).length,
        createdFailed: createdResults.filter(r => !r.success).length,
        updated: updatedResults.filter(r => r.success).length,
        updatedFailed: updatedResults.filter(r => !r.success).length,
      },
    })
  }
)

/**
 * Main workflow for batch processing persons
 */
export const batchPersonsWorkflow = createWorkflow(
  batchPersonsWorkflowId,
  (input: WorkflowData<GroupPersonsForBatchStepOutput>) => {
    // Return the workflow response
    const batchPersons = batchPersonsStep(input);
    return new WorkflowResponse(batchPersons)
  }
)
